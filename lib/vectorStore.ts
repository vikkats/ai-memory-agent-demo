import fs from "node:fs/promises";
import { DATA_DIR, LOCAL_VECTOR_PATH } from "./paths";
import type { ProviderSettings } from "./types";
import { cosineSimilarity } from "./embeddings";

/**
 * Pluggable vector backends. Qdrant for real deployments; a JSON-file store
 * with cosine similarity for offline development, CI, and this demo.
 * Both honor the same contract so the retrieval pipeline never changes.
 */

export type VectorPoint = {
  id: string;
  vector: number[];
  payload: Record<string, unknown>;
};

export type ScoredPoint = {
  id: string;
  score: number;
  payload: Record<string, unknown>;
};

export interface VectorStore {
  readonly kind: "qdrant" | "local";
  search(vector: number[], limit: number, scoreThreshold: number): Promise<ScoredPoint[]>;
  upsert(points: VectorPoint[]): Promise<number>;
  count(): Promise<number>;
}

/* ------------------------------- Qdrant -------------------------------- */

class QdrantVectorStore implements VectorStore {
  readonly kind = "qdrant" as const;

  constructor(
    private baseUrl: string,
    private apiKey: string | null,
    private collection: string,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  private headers() {
    return {
      "content-type": "application/json",
      ...(this.apiKey ? { "api-key": this.apiKey } : {}),
    };
  }

  async search(vector: number[], limit: number, scoreThreshold: number) {
    const response = await fetch(
      `${this.baseUrl}/collections/${encodeURIComponent(this.collection)}/points/search`,
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          vector,
          limit,
          score_threshold: scoreThreshold,
          with_payload: true,
          with_vector: false,
        }),
      },
    );

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Qdrant search failed: ${response.status} ${response.statusText}${detail ? ` — ${detail}` : ""}`);
    }

    const json = (await response.json()) as { result?: Array<{ id: string | number; score?: number; payload?: Record<string, unknown> }> };
    return (Array.isArray(json.result) ? json.result : []).map((point) => ({
      id: String(point.id),
      score: Number(point.score ?? 0),
      payload: point.payload ?? {},
    }));
  }

  async upsert(points: VectorPoint[]) {
    if (!points.length) return 0;

    const response = await fetch(
      `${this.baseUrl}/collections/${encodeURIComponent(this.collection)}/points?wait=true`,
      {
        method: "PUT",
        headers: this.headers(),
        body: JSON.stringify({
          points: points.map((point) => ({ id: point.id, vector: point.vector, payload: point.payload })),
        }),
      },
    );

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Qdrant upsert failed: ${response.status} ${response.statusText}${detail ? ` — ${detail}` : ""}`);
    }

    await response.json().catch(() => null);
    return points.length;
  }

  async count() {
    const response = await fetch(`${this.baseUrl}/collections/${encodeURIComponent(this.collection)}`, {
      headers: this.headers(),
    });
    if (!response.ok) return 0;
    const json = (await response.json()) as { result?: { points_count?: number } };
    return Number(json.result?.points_count ?? 0);
  }
}

/* --------------------------- Local JSON store --------------------------- */

type LocalVectorFile = {
  points: VectorPoint[];
};

class LocalVectorStore implements VectorStore {
  readonly kind = "local" as const;

  private async readFile(): Promise<LocalVectorFile> {
    try {
      const raw = await fs.readFile(LOCAL_VECTOR_PATH, "utf8");
      const parsed = JSON.parse(raw) as LocalVectorFile;
      return { points: Array.isArray(parsed.points) ? parsed.points : [] };
    } catch {
      return { points: [] };
    }
  }

  private async writeFile(data: LocalVectorFile) {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(LOCAL_VECTOR_PATH, JSON.stringify(data), "utf8");
  }

  async search(vector: number[], limit: number, scoreThreshold: number) {
    const { points } = await this.readFile();
    return points
      .map((point) => ({
        id: point.id,
        score: cosineSimilarity(vector, point.vector),
        payload: point.payload,
      }))
      .filter((point) => point.score >= scoreThreshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  async upsert(points: VectorPoint[]) {
    if (!points.length) return 0;
    const data = await this.readFile();
    const byId = new Map(data.points.map((point) => [point.id, point] as const));
    for (const point of points) byId.set(point.id, point);
    await this.writeFile({ points: [...byId.values()] });
    return points.length;
  }

  async count() {
    const data = await this.readFile();
    return data.points.length;
  }
}

/* ------------------------------ Resolution ------------------------------ */

export function getVectorStore(provider: ProviderSettings): VectorStore {
  if (provider.vectorBackend === "qdrant" && provider.qdrantUrl) {
    return new QdrantVectorStore(provider.qdrantUrl, provider.qdrantApiKey ?? null, provider.qdrantCollection || "agent_memories");
  }
  return new LocalVectorStore();
}

export async function upsertVectorPoints(provider: ProviderSettings, points: VectorPoint[]) {
  return getVectorStore(provider).upsert(points);
}
