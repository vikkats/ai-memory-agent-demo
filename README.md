# AI Memory Agent Demo

A **runnable, sanitized demo** of a memory-augmented agent system — built to
showcase the architecture of a larger private project without exposing any of
its personal content (see `docs/privacy.md`).

This is not a chat mockup. It's a working agent runtime: layered prompt
assembly under token budgets, semantic retrieval over a rebuildable vector
index, a validated tool loop, scheduled agent-initiated check-ins, and a
maintenance cycle — all inspectable in the UI, and all runnable **fully
offline** thanks to a deterministic mock model and local embeddings that
implement the same contracts as the real backends.

## Why it exists

Portfolio piece. The private original stores personal data and can't be shown;
this repo preserves the engineering — the parts that make agent memory
trustworthy: inspectable retrieval, reviewable writes, bounded autonomy, and
honest failure modes.

## Quick start

```bash
npm install
npm run init        # seed SQLite schema + starter memory files
npm run dev         # http://localhost:3000
```

No API keys needed. The default "Offline demo model" exercises the real
pipeline end-to-end. Try:

- *"What do you remember about my preferences?"* → mock routes through the real
  `search_memory` tool; expand `⌕ N retrieved` on the answer to see the
  retrieval inspector.
- *"What time is it?"* → routes through `get_current_time`.
- *"Summarize this conversation"* → generates, persists, and indexes a thread
  summary.
- Settings → **Run maintenance (force)** → watch it refresh `core/live_state.md`,
  journal its run, and re-index what it touched.
- Check-ins → schedule one a minute out → **Run cycle now** → it lands in the
  conversation.

To go live, point the provider at any OpenAI-compatible endpoint in Settings
(base URL + API key + model ID), and optionally switch the vector backend to
Qdrant.

Optional background watcher (maintenance + check-in cycles on an interval):

```bash
npm run watcher
```

## What one chat turn does

```
user message
     │
     ▼
1. persist user turn            (SQLite)
2. retrieve semantic memory     (pluggable vector backend)
3. re-rank + summary rescue     (type/source boosts, top-K cut)
4. assemble prompt stack        (shell → agent stack → time → retrieval → trimmed history)
5. model + tool loop            (schema-validated calls, 6/turn cap, 30k-char clip)
6. stream answer over SSE       (status / meta / tool / token / done events)
7. persist assistant turn       (provider, retrieval IDs, tool-call audit)
8. cadence-gated auto-indexing
```

## Memory layers

| Layer | Storage | How it's used |
|---|---|---|
| Agent stack (`core/*.md`) | Markdown | injected into every prompt under a token budget |
| Journal (`journal/*.md`) | Markdown | dated continuity log, append-only |
| Rooms (`notes/`, `projects/`, `scratchpad/`) | Markdown | durable facts and active work, retrieved on demand |
| Semantic index | Qdrant **or** local JSON store | per-turn retrieval; **rebuildable** from the archive |
| Conversation archive | SQLite (WAL) | raw history, append-only |
| Thread summaries | SQLite + indexed | compressed thread windows, rescued into retrieval |

Vector point IDs are deterministic (`sha256` of stable keys), so re-indexing
overwrites instead of duplicating — the index is a rebuildable projection,
never the source of truth.

## Background lanes

- **Check-ins** — agent-initiated scheduled messages with atomic claiming,
  stale-claim recovery, occurrence dedupe, and daily/weekly recurrence.
  Offline mode delivers the pre-written fallback; a live model writes the
  message with full context.
- **Maintenance cycle** — refreshes `core/live_state.md`, journals its own
  run, optionally summarizes + indexes the active thread, and re-indexes
  touched files. Guarded by an enable flag, a cooldown, and a change guard.

## Repo layout

```
app/            Next.js UI + API routes (SSE chat, memory, check-ins, settings, export)
components/     chat client (+retrieval inspector), memory browser, check-in manager, settings
lib/            the agent runtime (see docs/architecture.md for the tour)
scripts/        init (seed) + watcher (background cycles)
tests/          node:test suites for budgeting, the tool loop, and re-ranking
docs/           architecture deep-dive, ADRs, UX case study, privacy notes
```

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | start the dev server |
| `npm run build` | production build |
| `npm run init` | seed schema + starter memory files |
| `npm run watcher` | background maintenance + check-in cycles |
| `npm run typecheck` | strict TypeScript check |
| `npm test` | node:test suites |

## Stack

Next.js (App Router) · React 19 · TypeScript strict · better-sqlite3 (WAL) ·
OpenAI-compatible chat completions with native tool calling · Qdrant (optional)
· tsx · node:test

> The interesting engineering here isn't the chat — it's everything around the
> chat: how memory is stored, retrieved, ranked, edited, audited, and kept
> honest. Start at `docs/architecture.md`.

## Status

Sanitized public demo of a private system. Actively maintained as a portfolio
piece; see `docs/ux-case-study.md` for the design rationale and
`docs/adr/` for the load-bearing decisions.
