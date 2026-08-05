export type ChatRole = "system" | "user" | "assistant" | "tool";

export type ProviderSettings = {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  modelId: string;
  apiFormat: "openai-compatible";
  temperature: number;
  topP: number;
  maxTokens: number;
  contextWindowTokens: number;
  historyMessageLimit: number;
  presencePenalty?: number | null;
  frequencyPenalty?: number | null;
  seed?: number | null;
  embeddingModel?: string | null;
  embeddingBaseUrl?: string | null;
  embeddingApiKey?: string | null;
  vectorBackend: "qdrant" | "local";
  qdrantUrl?: string | null;
  qdrantApiKey?: string | null;
  qdrantCollection?: string | null;
  retrievalTopK: number;
  retrievalScoreThreshold: number;
  retrievalTokenBudget: number;
  autoIndexCadence: number;
  toolsEnabled: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ChatMessage = {
  id: string;
  conversationId: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  metadata?: Record<string, unknown> | null;
};

export type Conversation = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type MemoryFile = {
  path: string;
  name: string;
  content: string;
  updatedAt: string;
};

export type PendingFileEditStatus = "pending" | "accepted" | "rejected";

export type PendingFileEdit = {
  id: string;
  path: string;
  oldContent: string;
  proposedContent: string;
  reason: string;
  status: PendingFileEditStatus;
  createdAt: string;
  resolvedAt?: string | null;
};

export type RetrievedMemory = {
  id: string;
  score: number;
  text: string;
  source?: string | null;
  speaker?: string | null;
  timestamp?: string | null;
  payload?: Record<string, unknown>;
};

export type CheckInRecurrence = "none" | "daily" | "weekly";
export type CheckInStatus = "pending" | "processing" | "fired" | "cancelled";

export type CheckIn = {
  id: string;
  conversationId: string;
  title: string;
  intent: string;
  fallbackMessage: string;
  dueAt: string;
  timezone: string;
  recurrence: CheckInRecurrence;
  status: CheckInStatus;
  occurrenceCount: number;
  createdAt: string;
  updatedAt: string;
  firedAt: string | null;
  lastError: string | null;
};

export type ConversationSummary = {
  id: string;
  conversationId: string;
  summaryKey: string;
  startDate: string | null;
  endDate: string | null;
  summary: string;
  messageCount: number;
  lastMessageId: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Server-sent events streamed by /api/chat to the client. */
export type ChatStreamEvent =
  | { type: "status"; message: string }
  | { type: "meta"; conversationId: string; retrieved: RetrievedMemory[] }
  | { type: "token"; content: string }
  | { type: "tool"; name: string; ok: boolean; detail?: string }
  | { type: "done"; messageId: string }
  | { type: "error"; message: string };
