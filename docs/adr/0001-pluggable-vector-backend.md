# ADR 0001: Pluggable vector backend (Qdrant | local JSON)

- Status: accepted
- Date: 2026-08

## Context

The demo must run in three environments with identical behavior:

1. A reviewer laptop with zero infrastructure (no Docker, no keys).
2. CI, where tests must be deterministic and offline.
3. A real deployment with a proper vector database.

Retrieval quality requirements (re-ranking, summary rescue, thresholding) must
be backend-independent.

## Decision

Define a narrow `VectorStore` contract:

```ts
interface VectorStore {
  readonly kind: "qdrant" | "local";
  search(vector: number[], limit: number, scoreThreshold: number): Promise<ScoredPoint[]>;
  upsert(points: VectorPoint[]): Promise<number>;
  count(): Promise<number>;
}
```

Two implementations:

- **QdrantVectorStore** — REST client against a Qdrant collection.
- **LocalVectorStore** — a JSON file with brute-force cosine similarity.

`getVectorStore(provider)` resolves the backend from provider settings
(`vectorBackend: "qdrant"` + a configured URL selects Qdrant; anything else
falls back to local). The retrieval pipeline never branches on backend.

## Consequences

- The whole system runs end-to-end offline, which is what makes the demo
  self-contained for reviewers.
- Local search is O(n) per query — fine for a demo-scale index, wrong for
  production scale. The contract is the migration seam.
- Both backends honor deterministic point IDs, so re-indexing overwrites
  instead of duplicating on either one.
- Threshold semantics live in the backends (Qdrant's `score_threshold`, a
  filter in the local store), keeping `searchMemories` backend-agnostic.
