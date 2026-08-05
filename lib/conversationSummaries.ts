import { randomUUID } from "node:crypto";
import { getConversation, listMessages } from "./conversations";
import { getDb, nowIso } from "./db";
import { createEmbedding } from "./embeddings";
import { pointIdForSummary } from "./indexing";
import { generateText } from "./mockModel";
import { isMockProvider } from "./providers";
import { estimateTokens } from "./tokens";
import type { ChatMessage, ConversationSummary, ProviderSettings } from "./types";
import { upsertVectorPoints } from "./vectorStore";

export const MAX_MESSAGES_FOR_SUMMARY = 180;
export const MAX_MESSAGE_CHARS = 2000;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeDate(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return DATE_RE.test(trimmed) ? trimmed : null;
}

export function summaryKeyForWindow(startDate?: string, endDate?: string): string {
  const start = normalizeDate(startDate);
  const end = normalizeDate(endDate);
  if (!start && !end) return "all";
  return `${start ?? "…"}..${end ?? "…"}`;
}

interface SummaryRow {
  id: string;
  conversation_id: string;
  summary_key: string;
  start_date: string | null;
  end_date: string | null;
  summary: string;
  message_count: number;
  last_message_id: string | null;
  created_at: string;
  updated_at: string;
}

function rowToSummary(row: SummaryRow): ConversationSummary {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    summaryKey: row.summary_key,
    startDate: row.start_date,
    endDate: row.end_date,
    summary: row.summary,
    messageCount: row.message_count,
    lastMessageId: row.last_message_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getConversationSummary(
  conversationId: string,
  summaryKey = "all",
): ConversationSummary | null {
  const row = getDb()
    .prepare(`SELECT * FROM conversation_summaries WHERE conversation_id = ? AND summary_key = ?`)
    .get(conversationId, summaryKey) as SummaryRow | undefined;
  return row ? rowToSummary(row) : null;
}

export function saveConversationSummary(input: {
  conversationId: string;
  summaryKey: string;
  summary: string;
  messageCount: number;
  lastMessageId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
}): ConversationSummary {
  const db = getDb();
  const existing = getConversationSummary(input.conversationId, input.summaryKey);
  const id = existing?.id ?? randomUUID();
  const now = nowIso();
  db.prepare(
    `INSERT INTO conversation_summaries
       (id, conversation_id, summary_key, start_date, end_date, summary, message_count, last_message_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(conversation_id, summary_key) DO UPDATE SET
       start_date = excluded.start_date,
       end_date = excluded.end_date,
       summary = excluded.summary,
       message_count = excluded.message_count,
       last_message_id = excluded.last_message_id,
       updated_at = excluded.updated_at`,
  ).run(
    id,
    input.conversationId,
    input.summaryKey,
    input.startDate ?? null,
    input.endDate ?? null,
    input.summary,
    input.messageCount,
    input.lastMessageId ?? null,
    existing?.createdAt ?? now,
    now,
  );
  return getConversationSummary(input.conversationId, input.summaryKey)!;
}

function clipMessage(content: string): string {
  return content.length > MAX_MESSAGE_CHARS ? `${content.slice(0, MAX_MESSAGE_CHARS)}…` : content;
}

function selectWindow(messages: ChatMessage[], startDate?: string, endDate?: string): ChatMessage[] {
  const start = normalizeDate(startDate);
  const end = normalizeDate(endDate);
  const filtered = messages.filter((m) => {
    const day = m.createdAt.slice(0, 10);
    if (start && day < start) return false;
    if (end && day > end) return false;
    return true;
  });
  return filtered.slice(-MAX_MESSAGES_FOR_SUMMARY);
}

/** Deterministic extractive summary used in offline/mock mode. */
export function extractiveSummary(messages: ChatMessage[], windowLabel: string): string {
  const userTurns = messages.filter((m) => m.role === "user");
  const assistantTurns = messages.filter((m) => m.role === "assistant");
  const topics = userTurns
    .slice(-8)
    .map((m) => clipMessage(m.content).split("\n")[0].slice(0, 120));

  const lines: string[] = [
    "# Thread Summary",
    "",
    `## Date range`,
    windowLabel,
    "",
    "## What happened",
    `${messages.length} messages exchanged (${userTurns.length} user, ${assistantTurns.length} assistant).`,
    ...topics.map((t) => `- User raised: ${t}`),
    "",
    "## Decisions",
    "- (extractive summary — no generative model configured)",
    "",
    "## Open loops",
    "- (review the thread for unresolved items)",
  ];
  return lines.join("\n");
}

async function generativeSummary(
  provider: ProviderSettings,
  messages: ChatMessage[],
  windowLabel: string,
): Promise<string> {
  const transcript = messages
    .map((m) => `[${m.createdAt}] ${m.role.toUpperCase()}: ${clipMessage(m.content)}`)
    .join("\n");
  const text = await generateText(provider, [
    {
      role: "system",
      content:
        "You write durable conversation summaries for retrieval. Be specific, factual, and compact. Use exactly these sections: # Thread Summary, ## Date range, ## What happened, ## Decisions, ## Open loops.",
    },
    {
      role: "user",
      content: `Summarize this conversation window (${windowLabel}):\n\n${transcript}`,
    },
  ]);
  return text.trim() || extractiveSummary(messages, windowLabel);
}

export interface SummarizeOptions {
  startDate?: string;
  endDate?: string;
}

export async function summarizeConversation(
  provider: ProviderSettings,
  conversationId: string,
  options: SummarizeOptions = {},
): Promise<ConversationSummary | null> {
  const conversation = getConversation(conversationId);
  if (!conversation) throw new Error(`Conversation not found: ${conversationId}`);

  const all = listMessages(conversationId, 1000);
  const windowed = selectWindow(all, options.startDate, options.endDate);
  if (windowed.length === 0) return null;

  const start = normalizeDate(options.startDate);
  const end = normalizeDate(options.endDate);
  const firstDay = windowed[0].createdAt.slice(0, 10);
  const lastDay = windowed[windowed.length - 1].createdAt.slice(0, 10);
  const windowLabel = `${start ?? firstDay} → ${end ?? lastDay}`;

  const text = isMockProvider(provider)
    ? extractiveSummary(windowed, windowLabel)
    : await generativeSummary(provider, windowed, windowLabel);

  return saveConversationSummary({
    conversationId,
    summaryKey: summaryKeyForWindow(options.startDate, options.endDate),
    summary: text,
    messageCount: windowed.length,
    lastMessageId: windowed[windowed.length - 1]?.id ?? null,
    startDate: start,
    endDate: end,
  });
}

/**
 * Summarize a conversation, then embed and upsert the summary into the
 * vector index so it can be retrieved (and rescued) in later turns.
 */
export async function summarizeAndIndexConversation(
  provider: ProviderSettings,
  conversationId: string,
  options: SummarizeOptions = {},
): Promise<ConversationSummary | null> {
  const summary = await summarizeConversation(provider, conversationId, options);
  if (!summary) return null;

  const indexText = summary.summary.slice(0, 8000);
  const vector = await createEmbedding(provider, indexText);
  await upsertVectorPoints(provider, [
    {
      id: pointIdForSummary(conversationId, summary.summaryKey),
      vector,
      payload: {
        type: "conversation_summary",
        conversationId,
        summaryKey: summary.summaryKey,
        text: indexText,
        messageCount: summary.messageCount,
        source: "summary",
        timestamp: summary.updatedAt,
        indexed_at: nowIso(),
        token_estimate: estimateTokens(indexText),
      },
    },
  ]);
  return summary;
}
