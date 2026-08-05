# ADR 0002: Offline mock model + local embeddings

- Status: accepted
- Date: 2026-08

## Context

A portfolio reviewer should be able to `npm install && npm run dev` and see the
*entire* agent pipeline working — retrieval, prompt assembly, the tool loop,
check-ins, maintenance — without signing up for anything.

The risk with "mock mode" in demos is that it becomes a UI-level fake: canned
responses that bypass the real code paths, proving nothing about the
architecture.

## Decision

Implement the mock at the **driver level**, not the UI level:

- `ModelDriver` is the single contract the chat engine, check-ins, maintenance,
  and summarization all call: `(messages, tools) → { text, toolCalls,
  assistantMessage }`.
- `resolveModelDriver(provider)` returns the real OpenAI-compatible driver when
  a provider is configured, and a deterministic heuristic mock otherwise
  (`baseUrl` starting with `mock://` or an empty API key).
- The mock routes recognizable intents through the *real* tool loop ("what
  time" → `get_current_time`, "remember" → `search_memory`, "summarize" →
  `summarize_conversation`) and answers by quoting actual tool results.
- Embeddings get the same treatment: `createEmbedding` calls a real endpoint
  when configured, else a deterministic local embedding (SHA-256 hashed token
  buckets, 256 dims, L2-normalized) so vector math works offline.

## Consequences

- Every code path that matters is exercised offline: prompt budgeting,
  retrieval + re-ranking, tool validation, SSE streaming, indexing cadence,
  check-in delivery, maintenance steps.
- The mock is honest: every mock answer is labeled, the UI shows a "mock"
  badge, and the docs state plainly what it can and can't demonstrate.
- Local embeddings reward token overlap but understand nothing semantic —
  acceptable for demo-scale, and the docs say so explicitly.
- Switching to a real deployment is a Settings-page change (base URL + key),
  not a code change.
