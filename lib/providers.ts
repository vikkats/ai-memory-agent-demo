import { randomUUID } from "node:crypto";
import { getDb, nowIso } from "./db";
import type { ProviderSettings } from "./types";

type ProviderRow = {
  id: string;
  name: string;
  base_url: string;
  api_key: string;
  model_id: string;
  api_format: string;
  temperature: number;
  top_p: number;
  max_tokens: number;
  context_window_tokens: number;
  history_message_limit: number;
  presence_penalty: number | null;
  frequency_penalty: number | null;
  seed: number | null;
  embedding_model: string | null;
  embedding_base_url: string | null;
  embedding_api_key: string | null;
  vector_backend: string;
  qdrant_url: string | null;
  qdrant_api_key: string | null;
  qdrant_collection: string | null;
  retrieval_top_k: number;
  retrieval_score_threshold: number;
  retrieval_token_budget: number;
  auto_index_cadence: number;
  tools_enabled: number;
  is_active: number;
  created_at: string;
  updated_at: string;
};

export const MOCK_BASE_URL = "mock://local";

/**
 * The demo ships with a deterministic offline model so the full pipeline
 * (retrieval, prompt stack, tool loop, check-ins) runs with zero API keys.
 * Point baseUrl at any OpenAI-compatible endpoint to switch to a real model.
 */
export function isMockProvider(provider: Pick<ProviderSettings, "baseUrl" | "apiKey">) {
  return provider.baseUrl.startsWith("mock://") || !provider.apiKey.trim();
}

function rowToProvider(row: ProviderRow): ProviderSettings {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    apiKey: row.api_key,
    modelId: row.model_id,
    apiFormat: "openai-compatible",
    temperature: row.temperature,
    topP: row.top_p,
    maxTokens: row.max_tokens,
    contextWindowTokens: row.context_window_tokens,
    historyMessageLimit: row.history_message_limit,
    presencePenalty: row.presence_penalty,
    frequencyPenalty: row.frequency_penalty,
    seed: row.seed,
    embeddingModel: row.embedding_model,
    embeddingBaseUrl: row.embedding_base_url,
    embeddingApiKey: row.embedding_api_key,
    vectorBackend: row.vector_backend === "qdrant" ? "qdrant" : "local",
    qdrantUrl: row.qdrant_url,
    qdrantApiKey: row.qdrant_api_key,
    qdrantCollection: row.qdrant_collection,
    retrievalTopK: row.retrieval_top_k,
    retrievalScoreThreshold: row.retrieval_score_threshold,
    retrievalTokenBudget: row.retrieval_token_budget,
    autoIndexCadence: row.auto_index_cadence,
    toolsEnabled: row.tools_enabled === 1,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Never serialize real keys back to the client. */
export function redactProvider(provider: ProviderSettings): ProviderSettings {
  return {
    ...provider,
    apiKey: provider.apiKey ? "••••••••" : "",
    embeddingApiKey: provider.embeddingApiKey ? "••••••••" : null,
    qdrantApiKey: provider.qdrantApiKey ? "••••••••" : null,
  };
}

export function listProviders() {
  const rows = getDb().prepare("SELECT * FROM providers ORDER BY created_at ASC").all() as ProviderRow[];
  return rows.map(rowToProvider);
}

export function getProvider(id: string) {
  const row = getDb().prepare("SELECT * FROM providers WHERE id = ?").get(id) as ProviderRow | undefined;
  return row ? rowToProvider(row) : null;
}

export function getActiveProvider() {
  const row = getDb().prepare("SELECT * FROM providers WHERE is_active = 1 ORDER BY updated_at DESC LIMIT 1").get() as
    | ProviderRow
    | undefined;
  if (row) return rowToProvider(row);

  const seeded = seedDefaultProvider();
  return seeded;
}

export function setActiveProvider(id: string) {
  const database = getDb();
  const updatedAt = nowIso();
  database.prepare("UPDATE providers SET is_active = 0, updated_at = ?").run(updatedAt);
  const result = database.prepare("UPDATE providers SET is_active = 1, updated_at = ? WHERE id = ?").run(updatedAt, id);
  return Number(result.changes ?? 0) > 0;
}

export function upsertProvider(input: Partial<ProviderSettings> & { name: string }) {
  const database = getDb();
  const existing = input.id ? getProvider(input.id) : null;
  const updatedAt = nowIso();
  const provider: ProviderSettings = {
    id: existing?.id ?? randomUUID(),
    name: input.name.trim(),
    baseUrl: input.baseUrl ?? existing?.baseUrl ?? MOCK_BASE_URL,
    // A redacted key coming back from the UI means "unchanged".
    apiKey:
      input.apiKey && input.apiKey !== "••••••••" ? input.apiKey : (existing?.apiKey ?? input.apiKey ?? ""),
    modelId: input.modelId ?? existing?.modelId ?? "offline-demo-model",
    apiFormat: "openai-compatible",
    temperature: input.temperature ?? existing?.temperature ?? 0.7,
    topP: input.topP ?? existing?.topP ?? 0.95,
    maxTokens: input.maxTokens ?? existing?.maxTokens ?? 1200,
    contextWindowTokens: input.contextWindowTokens ?? existing?.contextWindowTokens ?? 131072,
    historyMessageLimit: input.historyMessageLimit ?? existing?.historyMessageLimit ?? 80,
    presencePenalty: input.presencePenalty ?? existing?.presencePenalty ?? null,
    frequencyPenalty: input.frequencyPenalty ?? existing?.frequencyPenalty ?? null,
    seed: input.seed ?? existing?.seed ?? null,
    embeddingModel: input.embeddingModel ?? existing?.embeddingModel ?? null,
    embeddingBaseUrl: input.embeddingBaseUrl ?? existing?.embeddingBaseUrl ?? null,
    embeddingApiKey:
      input.embeddingApiKey && input.embeddingApiKey !== "••••••••"
        ? input.embeddingApiKey
        : (existing?.embeddingApiKey ?? null),
    vectorBackend: input.vectorBackend ?? existing?.vectorBackend ?? "local",
    qdrantUrl: input.qdrantUrl ?? existing?.qdrantUrl ?? null,
    qdrantApiKey:
      input.qdrantApiKey && input.qdrantApiKey !== "••••••••"
        ? input.qdrantApiKey
        : (existing?.qdrantApiKey ?? null),
    qdrantCollection: input.qdrantCollection ?? existing?.qdrantCollection ?? null,
    retrievalTopK: input.retrievalTopK ?? existing?.retrievalTopK ?? 8,
    retrievalScoreThreshold: input.retrievalScoreThreshold ?? existing?.retrievalScoreThreshold ?? 0.25,
    retrievalTokenBudget: input.retrievalTokenBudget ?? existing?.retrievalTokenBudget ?? 4000,
    autoIndexCadence: input.autoIndexCadence ?? existing?.autoIndexCadence ?? 1,
    toolsEnabled: input.toolsEnabled ?? existing?.toolsEnabled ?? true,
    isActive: existing?.isActive ?? false,
    createdAt: existing?.createdAt ?? updatedAt,
    updatedAt,
  };

  database
    .prepare(`
      INSERT INTO providers (
        id, name, base_url, api_key, model_id, api_format, temperature, top_p,
        max_tokens, context_window_tokens, history_message_limit,
        presence_penalty, frequency_penalty, seed,
        embedding_model, embedding_base_url, embedding_api_key,
        vector_backend, qdrant_url, qdrant_api_key, qdrant_collection,
        retrieval_top_k, retrieval_score_threshold, retrieval_token_budget,
        auto_index_cadence, tools_enabled, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        base_url = excluded.base_url,
        api_key = excluded.api_key,
        model_id = excluded.model_id,
        temperature = excluded.temperature,
        top_p = excluded.top_p,
        max_tokens = excluded.max_tokens,
        context_window_tokens = excluded.context_window_tokens,
        history_message_limit = excluded.history_message_limit,
        presence_penalty = excluded.presence_penalty,
        frequency_penalty = excluded.frequency_penalty,
        seed = excluded.seed,
        embedding_model = excluded.embedding_model,
        embedding_base_url = excluded.embedding_base_url,
        embedding_api_key = excluded.embedding_api_key,
        vector_backend = excluded.vector_backend,
        qdrant_url = excluded.qdrant_url,
        qdrant_api_key = excluded.qdrant_api_key,
        qdrant_collection = excluded.qdrant_collection,
        retrieval_top_k = excluded.retrieval_top_k,
        retrieval_score_threshold = excluded.retrieval_score_threshold,
        retrieval_token_budget = excluded.retrieval_token_budget,
        auto_index_cadence = excluded.auto_index_cadence,
        tools_enabled = excluded.tools_enabled,
        updated_at = excluded.updated_at
    `)
    .run(
      provider.id,
      provider.name,
      provider.baseUrl,
      provider.apiKey,
      provider.modelId,
      provider.apiFormat,
      provider.temperature,
      provider.topP,
      provider.maxTokens,
      provider.contextWindowTokens,
      provider.historyMessageLimit,
      provider.presencePenalty,
      provider.frequencyPenalty,
      provider.seed,
      provider.embeddingModel,
      provider.embeddingBaseUrl,
      provider.embeddingApiKey,
      provider.vectorBackend,
      provider.qdrantUrl,
      provider.qdrantApiKey,
      provider.qdrantCollection,
      provider.retrievalTopK,
      provider.retrievalScoreThreshold,
      provider.retrievalTokenBudget,
      provider.autoIndexCadence,
      provider.toolsEnabled ? 1 : 0,
      provider.isActive ? 1 : 0,
      provider.createdAt,
      provider.updatedAt,
    );

  return provider;
}

function seedDefaultProvider() {
  const existing = listProviders();
  if (existing.length > 0) {
    setActiveProvider(existing[0].id);
    return getProvider(existing[0].id);
  }

  const provider = upsertProvider({
    name: process.env.AGENT_PROVIDER_NAME || "Offline demo model",
    baseUrl: process.env.AGENT_PROVIDER_BASE_URL || MOCK_BASE_URL,
    apiKey: process.env.AGENT_PROVIDER_API_KEY || "",
    modelId: process.env.AGENT_PROVIDER_MODEL_ID || "offline-demo-model",
    embeddingModel: process.env.AGENT_EMBEDDING_MODEL_ID || null,
    embeddingBaseUrl: process.env.AGENT_EMBEDDING_BASE_URL || null,
    embeddingApiKey: process.env.AGENT_EMBEDDING_API_KEY || null,
    vectorBackend: process.env.AGENT_QDRANT_URL ? "qdrant" : "local",
    qdrantUrl: process.env.AGENT_QDRANT_URL || null,
    qdrantApiKey: process.env.AGENT_QDRANT_API_KEY || null,
    qdrantCollection: process.env.AGENT_QDRANT_COLLECTION || "agent_memories",
  });
  setActiveProvider(provider.id);
  return getProvider(provider.id);
}
