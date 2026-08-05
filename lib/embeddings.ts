import { createHash } from "node:crypto";
import type { ProviderSettings } from "./types";
import { isMockProvider } from "./providers";

export const LOCAL_EMBEDDING_DIMS = 256;

function embeddingsUrl(baseUrl: string) {
  let trimmed = baseUrl.replace(/\/+$/, "");

  // Be forgiving if a user pastes a chat completions endpoint instead of the API root.
  trimmed = trimmed.replace(/\/chat\/completions$/i, "");

  if (trimmed.endsWith("/embeddings")) return trimmed;
  if (trimmed.endsWith("/v1")) return `${trimmed}/embeddings`;
  return `${trimmed}/v1/embeddings`;
}

function tokenize(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Deterministic local embedding: hashed token buckets, L2-normalized.
 * Not a semantic model — it makes the entire retrieval pipeline (indexing,
 * vector search, ranking, budgets) fully exercisable offline and in tests.
 * Swap in a real embedding model via provider settings for production use.
 */
export function createLocalEmbedding(text: string, dims = LOCAL_EMBEDDING_DIMS) {
  const vector = new Array<number>(dims).fill(0);
  const tokens = tokenize(text);

  for (const token of tokens) {
    const hash = createHash("sha256").update(token).digest();
    const bucket = hash.readUInt32BE(0) % dims;
    const sign = hash.readUInt8(4) % 2 === 0 ? 1 : -1;
    vector[bucket] += sign;
  }

  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => value / norm);
}

export function usesLocalEmbeddings(provider: ProviderSettings) {
  return isMockProvider(provider) || !provider.embeddingModel || !(provider.embeddingApiKey || provider.apiKey);
}

export async function createEmbedding(provider: ProviderSettings, input: string, options?: { signal?: AbortSignal }) {
  if (usesLocalEmbeddings(provider)) {
    return createLocalEmbedding(input);
  }

  const baseUrl = provider.embeddingBaseUrl || provider.baseUrl;
  const apiKey = provider.embeddingApiKey || provider.apiKey;
  const model = provider.embeddingModel!;

  const response = await fetch(embeddingsUrl(baseUrl), {
    method: "POST",
    signal: options?.signal,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, input }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Embedding request failed: ${response.status} ${response.statusText}${detail ? ` — ${detail}` : ""}`);
  }

  const json = await response.json();
  const vector = json.data?.[0]?.embedding;
  if (!Array.isArray(vector)) {
    throw new Error("Embedding response did not include data[0].embedding.");
  }

  return vector as number[];
}

export function cosineSimilarity(a: number[], b: number[]) {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
