import type { ProviderSettings, RetrievedMemory } from "./types";
import { createEmbedding } from "./embeddings";
import { getVectorStore } from "./vectorStore";
import { estimateTokens } from "./tokens";

/**
 * Retrieval pipeline: embed the expanded query, search the vector backend,
 * re-rank with type/source boosts, and guarantee summary representation
 * ("summary rescue") so high-level context is not crowded out by fragments.
 */

type RankedMemory = RetrievedMemory & {
  rankScore: number;
};

const SUMMARY_RESCUE_MIN_RAW_SCORE = 0.2;

function extractText(payload: Record<string, unknown>) {
  const candidates = [
    payload.text,
    payload.content,
    payload.message,
    payload.memory,
    payload.chunk,
    payload.document,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }

  return "";
}

function extractString(payload: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function payloadString(memory: RetrievedMemory, key: string) {
  const value = memory.payload?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function payloadBoolean(memory: RetrievedMemory, key: string) {
  const value = memory.payload?.[key];
  return typeof value === "boolean" ? value : null;
}

export function memoryType(memory: RetrievedMemory) {
  return payloadString(memory, "type") ?? payloadString(memory, "kind") ?? payloadString(memory, "room") ?? "memory";
}

function isConversationSummary(memory: RetrievedMemory) {
  return memoryType(memory) === "conversation_summary";
}

function boostedScore(memory: RetrievedMemory) {
  const type = memoryType(memory);
  const room = payloadString(memory, "room");
  const path = payloadString(memory, "path") ?? payloadString(memory, "source");
  const isWatchThread = payloadBoolean(memory, "isWatchThread") === true;
  const isSummary = type === "conversation_summary";
  const isConversationMessage = type === "conversation_message";

  let boost = 0;

  if (isSummary) boost += 0.16;
  if (isConversationMessage && isWatchThread) boost += 0.08;
  if (isSummary && isWatchThread) boost += 0.06;
  if (room === "core" || path?.startsWith("core/")) boost += 0.07;
  if (room === "projects" || path?.startsWith("projects/")) boost += 0.05;
  if (room === "notes" || path?.startsWith("notes/")) boost += 0.04;
  if (room === "journal" || path?.startsWith("journal/")) boost += 0.03;

  // Tiny penalty for isolated non-watch conversation messages so summaries
  // and durable files win ties.
  if (isConversationMessage && !isWatchThread) boost -= 0.025;

  return memory.score + boost;
}

function withRank(memory: RetrievedMemory): RankedMemory {
  const rankScore = boostedScore(memory);
  return {
    ...memory,
    rankScore,
    payload: {
      ...memory.payload,
      rawScore: memory.score,
      rankScore,
    },
  };
}

function sortRanked(memories: RankedMemory[]) {
  return [...memories].sort((a, b) => b.rankScore - a.rankScore || b.score - a.score);
}

function withSummaryRescueFlag(memory: RankedMemory): RankedMemory {
  return {
    ...memory,
    payload: {
      ...memory.payload,
      summaryRescued: true,
    },
  };
}

/**
 * If no conversation summary survives the top-K cut but a decent one exists
 * just below it, swap out the weakest non-summary. Summaries compress whole
 * threads; losing them to message fragments hurts long-range continuity.
 */
export function rescueBestSummary(memories: RankedMemory[], limit: number) {
  const ranked = sortRanked(memories);
  const selected = ranked.slice(0, limit);
  if (selected.some(isConversationSummary)) return selected;

  const bestSummary = ranked.find(
    (memory) => isConversationSummary(memory) && memory.score >= SUMMARY_RESCUE_MIN_RAW_SCORE,
  );

  if (!bestSummary) return selected;
  if (selected.some((memory) => memory.id === bestSummary.id)) return selected;

  if (selected.length < limit) {
    return sortRanked([...selected, withSummaryRescueFlag(bestSummary)]);
  }

  const replacementIndex = [...selected]
    .map((memory, index) => ({ memory, index }))
    .filter(({ memory }) => !isConversationSummary(memory))
    .sort((a, b) => a.memory.rankScore - b.memory.rankScore)[0]?.index;

  if (replacementIndex === undefined) return selected;

  const rescued = [...selected];
  rescued[replacementIndex] = withSummaryRescueFlag(bestSummary);
  return sortRanked(rescued);
}

export async function searchMemories(
  provider: ProviderSettings,
  query: string,
  options?: { signal?: AbortSignal },
): Promise<RetrievedMemory[]> {
  if (!query.trim()) return [];

  const vector = await createEmbedding(provider, query, options);
  const store = getVectorStore(provider);
  // Over-fetch, then re-rank and cut to the configured top-K.
  const fetchLimit = Math.max(provider.retrievalTopK || 8, 24);
  const results = await store.search(vector, fetchLimit, provider.retrievalScoreThreshold ?? 0.25);

  const memories = results
    .map((point): RetrievedMemory | null => {
      const payload = point.payload ?? {};
      const text = extractText(payload);
      if (!text) return null;

      return {
        id: point.id,
        score: point.score,
        text,
        speaker: extractString(payload, ["speaker", "role", "author"]),
        source: extractString(payload, ["source", "file", "path"]) ?? store.kind,
        timestamp: extractString(payload, ["timestamp", "created_at", "updated_at"]),
        payload,
      };
    })
    .filter((memory): memory is RetrievedMemory => memory !== null);

  const ranked = memories.map(withRank);
  return rescueBestSummary(ranked, provider.retrievalTopK || 8);
}

function labelForMemory(memory: RetrievedMemory) {
  const type = memoryType(memory);
  if (type === "conversation_summary") return "Retrieved conversation summary";
  if (type === "conversation_message") return "Retrieved past conversation message";

  const room = payloadString(memory, "room");
  const path = payloadString(memory, "path") ?? payloadString(memory, "source");

  if (room === "journal" || path?.startsWith("journal/")) return "Retrieved journal entry";
  if (room === "core" || path?.startsWith("core/")) return "Retrieved core memory";
  if (room && room !== "memory") return `Retrieved ${room} note`;
  return "Retrieved semantic memory";
}

function metadataLines(memory: RetrievedMemory) {
  const type = memoryType(memory);
  const rankScore = typeof memory.payload?.rankScore === "number" ? memory.payload.rankScore : null;
  const summaryRescued = memory.payload?.summaryRescued === true;
  const lines = [
    `score: ${memory.score.toFixed(3)}`,
    rankScore !== null ? `rankScore: ${rankScore.toFixed(3)}` : null,
    summaryRescued ? "summaryRescued: yes" : null,
    `type: ${type}`,
    memory.source ? `source: ${memory.source}` : null,
    memory.timestamp ? `time: ${memory.timestamp}` : null,
  ];

  const conversationTitle = payloadString(memory, "conversationTitle");
  const path = payloadString(memory, "path");
  if (conversationTitle) lines.push(`conversation: ${conversationTitle}`);
  if (path) lines.push(`path: ${path}`);

  return lines.filter(Boolean).join(" | ");
}

export function formatRetrievedMemories(memories: RetrievedMemory[], tokenBudget: number) {
  if (!memories.length) return "";

  const blocks: string[] = [];
  let used = 0;

  for (const memory of memories) {
    const block = [`### ${labelForMemory(memory)}`, metadataLines(memory), "", memory.text].join("\n");
    const cost = estimateTokens(block);
    if (used + cost > tokenBudget && blocks.length > 0) break;
    blocks.push(block);
    used += cost;
  }

  return blocks.join("\n\n---\n\n");
}
