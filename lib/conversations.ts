import { randomUUID } from "node:crypto";
import { getDb, nowIso } from "./db";
import type { ChatMessage, ChatRole, Conversation } from "./types";

type ConversationRow = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  metadata_json: string | null;
  created_at: string;
};

function rowToConversation(row: ConversationRow): Conversation {
  return { id: row.id, title: row.title, createdAt: row.created_at, updatedAt: row.updated_at };
}

function rowToMessage(row: MessageRow): ChatMessage {
  let metadata: Record<string, unknown> | null = null;
  if (row.metadata_json) {
    try {
      metadata = JSON.parse(row.metadata_json) as Record<string, unknown>;
    } catch {
      metadata = null;
    }
  }
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role as ChatRole,
    content: row.content,
    createdAt: row.created_at,
    metadata,
  };
}

export function listConversations(limit = 50) {
  const safeLimit = Math.max(1, Math.min(Math.floor(limit), 200));
  const rows = getDb()
    .prepare("SELECT * FROM conversations ORDER BY updated_at DESC LIMIT ?")
    .all(safeLimit) as ConversationRow[];
  return rows.map(rowToConversation);
}

export function getConversation(id: string) {
  const row = getDb().prepare("SELECT * FROM conversations WHERE id = ?").get(id) as ConversationRow | undefined;
  return row ? rowToConversation(row) : null;
}

export function createConversation(title?: string) {
  const createdAt = nowIso();
  const conversation: Conversation = {
    id: randomUUID(),
    title: title?.trim() || `Conversation ${new Date().toLocaleDateString("en-CA")}`,
    createdAt,
    updatedAt: createdAt,
  };
  getDb()
    .prepare("INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)")
    .run(conversation.id, conversation.title, conversation.createdAt, conversation.updatedAt);
  return conversation;
}

export function touchConversation(id: string) {
  getDb().prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(nowIso(), id);
}

export function addMessage(input: {
  conversationId: string;
  role: ChatRole;
  content: string;
  metadata?: Record<string, unknown> | null;
}) {
  const message: ChatMessage = {
    id: randomUUID(),
    conversationId: input.conversationId,
    role: input.role,
    content: input.content,
    createdAt: nowIso(),
    metadata: input.metadata ?? null,
  };
  getDb()
    .prepare("INSERT INTO messages (id, conversation_id, role, content, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(
      message.id,
      message.conversationId,
      message.role,
      message.content,
      message.metadata ? JSON.stringify(message.metadata) : null,
      message.createdAt,
    );
  touchConversation(input.conversationId);
  return message;
}

export function getMessage(id: string) {
  const row = getDb().prepare("SELECT * FROM messages WHERE id = ?").get(id) as MessageRow | undefined;
  return row ? rowToMessage(row) : null;
}

export function listMessages(conversationId: string, limit = 200) {
  const safeLimit = Math.max(1, Math.min(Math.floor(limit), 1000));
  const rows = getDb()
    .prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, rowid ASC LIMIT ?")
    .all(conversationId, safeLimit) as MessageRow[];
  return rows.map(rowToMessage);
}
