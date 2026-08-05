import { createHash } from "node:crypto";
import { getDb, nowIso } from "./db";
import { createEmbedding } from "./embeddings";
import { listMemoryFiles } from "./memory";
import { getVectorStore, type VectorPoint } from "./vectorStore";
import { listMessages } from "./conversations";
import { getActiveProvider } from "./providers";
import { getWatcherConversationId } from "./appSettings";
import type { ChatMessage, ProviderSettings } from "./types";

/**
 * Indexing layer. Point IDs are deterministic (sha256 of a stable key), so
 * re-indexing the same content overwrites the same vector point instead of
 * accumulating duplicates — the index stays rebuildable from the archive.
 */

function sha256(text: string) {
  return createHash("sha256").update(text).digest("hex");
}

export function pointIdForMemoryChunk(path: string, chunkIndex: number) {
  return sha256(`memory-file:${path}:${chunkIndex}`).slice(0, 32);
}

export function pointIdForMessage(messageId: string) {
  return sha256(`conversation-message:${messageId}`).slice(0, 32);
}

export function pointIdForSummary(conversationId: string, summaryKey: string) {
  return sha256(`conversation-summary:${conversationId}:${summaryKey}`).slice(0, 32);
}

const CHUNK_SIZE_CHARS = 1600;
const CHUNK_OVERLAP_CHARS = 200;

function chunkText(text: string) {
  const clean = text.trim();
  if (clean.length <= CHUNK_SIZE_CHARS) return [clean];

  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    const end = Math.min(start + CHUNK_SIZE_CHARS, clean.length);
    chunks.push(clean.slice(start, end));
    if (end === clean.length) break;
    start = end - CHUNK_OVERLAP_CHARS;
  }
  return chunks.filter((chunk) => chunk.trim().length > 0);
}

function roomForPath(path: string) {
  return path.split("/")[0] ?? "memory";
}

export async function indexMemoryFiles(paths?: string[], provider?: ProviderSettings) {
  const activeProvider = provider ?? getActiveProvider();
  if (!activeProvider) throw new Error("No active provider configured.");

  const files = await listMemoryFiles();
  const targets = paths?.length ? files.filter((file) => paths.includes(file.path)) : files;
  const store = getVectorStore(activeProvider);
  const points: VectorPoint[] = [];

  for (const file of targets) {
    const chunks = chunkText(file.content);
    for (let index = 0; index < chunks.length; index += 1) {
      const text = chunks[index];
      const vector = await createEmbedding(activeProvider, `${file.path}\n${text}`);
      points.push({
        id: pointIdForMemoryChunk(file.path, index),
        vector,
        payload: {
          type: "memory_file",
          room: roomForPath(file.path),
          path: file.path,
          source: file.path,
          text,
          chunkIndex: index,
          chunkCount: chunks.length,
          content_hash: sha256(text),
          updated_at: file.updatedAt,
          timestamp: file.updatedAt,
          indexed_at: nowIso(),
        },
      });
    }
  }

  const upserted = await store.upsert(points);
  return { backend: store.kind, files: targets.length, chunks: points.length, upserted };
}

function speakerForRole(role: ChatMessage["role"]) {
  if (role === "user") return "user";
  if (role === "assistant") return "assistant";
  return role;
}

export async function indexConversationMessages(conversationId: string, messages: ChatMessage[], provider?: ProviderSettings) {
  const activeProvider = provider ?? getActiveProvider();
  if (!activeProvider) throw new Error("No active provider configured.");

  const store = getVectorStore(activeProvider);
  const watchConversationId = getWatcherConversationId();
  const points: VectorPoint[] = [];

  for (const message of messages) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    const text = message.content.trim();
    if (!text) continue;

    const vector = await createEmbedding(activeProvider, text);
    points.push({
      id: pointIdForMessage(message.id),
      vector,
      payload: {
        type: "conversation_message",
        conversationId,
        messageId: message.id,
        speaker: speakerForRole(message.role),
        text,
        timestamp: message.createdAt,
        isWatchThread: watchConversationId === conversationId,
        indexed_at: nowIso(),
      },
    });
  }

  const upserted = await store.upsert(points);

  getDb()
    .prepare(`
      INSERT INTO conversation_index_state (conversation_id, last_indexed_message_id, completed_turns_since_index, updated_at)
      VALUES (?, ?, 0, ?)
      ON CONFLICT(conversation_id) DO UPDATE SET
        last_indexed_message_id = excluded.last_indexed_message_id,
        completed_turns_since_index = 0,
        updated_at = excluded.updated_at
    `)
    .run(conversationId, messages.at(-1)?.id ?? null, nowIso());

  return { backend: store.kind, messages: points.length, upserted };
}

/**
 * Cadence-gated auto-indexing: after each completed turn we bump a counter;
 * only every N turns do fresh messages actually get embedded. Keeps chat
 * latency low while the index stays warm.
 */
export async function maybeAutoIndexConversation(conversationId: string, provider?: ProviderSettings) {
  const activeProvider = provider ?? getActiveProvider();
  if (!activeProvider) return { indexed: false, reason: "no-provider" };

  const cadence = Math.max(1, activeProvider.autoIndexCadence || 1);
  const database = getDb();
  const state = database
    .prepare("SELECT * FROM conversation_index_state WHERE conversation_id = ?")
    .get(conversationId) as { last_indexed_message_id: string | null; completed_turns_since_index: number } | undefined;

  const turnsSince = (state?.completed_turns_since_index ?? 0) + 1;

  if (turnsSince < cadence) {
    database
      .prepare(`
        INSERT INTO conversation_index_state (conversation_id, last_indexed_message_id, completed_turns_since_index, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(conversation_id) DO UPDATE SET
          completed_turns_since_index = conversation_index_state.completed_turns_since_index + 1,
          updated_at = excluded.updated_at
      `)
      .run(conversationId, state?.last_indexed_message_id ?? null, turnsSince, nowIso());
    return { indexed: false, reason: `cadence (${turnsSince}/${cadence})` };
  }

  const allMessages = listMessages(conversationId, 1000);
  const lastIndexedId = state?.last_indexed_message_id;
  const cutoff = lastIndexedId ? allMessages.findIndex((message) => message.id === lastIndexedId) : -1;
  const fresh = allMessages.slice(cutoff + 1);
  if (!fresh.length) return { indexed: false, reason: "nothing-new" };

  const result = await indexConversationMessages(conversationId, fresh, activeProvider);
  return { indexed: true, ...result };
}
