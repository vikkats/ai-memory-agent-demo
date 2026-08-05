# Architecture

This document describes how the agent runtime actually works — the request path,
the memory layers, the background lanes, and the invariants the design protects.

## Overview

```
                 ┌──────────────────────── UI (Next.js) ────────────────────────┐
                 │  Chat (+retrieval inspector)  Memory  Check-ins  Settings    │
                 └───────────────┬──────────────────────────────────────────────┘
                                 │  REST + SSE
                 ┌───────────────▼──────────────────────────────────────────────┐
                 │                    API routes (app/api/*)                     │
                 └───────────────┬──────────────────────────────────────────────┘
                                 │
   ┌─────────────────────────────┼─────────────────────────────────┐
   │                             │                                 │
   ▼                             ▼                                 ▼
 chat engine (lib/chatEngine)  memory files (lib/memory)      background lanes
   · retrieval (lib/retrieval)   · rooms: core/journal/         · check-ins
   · prompt stack (lib/prompt)     notes/projects/scratchpad    · maintenance
   · tool loop (lib/toolLoop)     · backups + safe paths        (scripts/watcher)
   · auto-index (lib/indexing)   · pending edits (reviewable)
                                 │
                 ┌───────────────▼────────────────┐
                 │  SQLite (better-sqlite3, WAL)   │  conversations, messages,
                 │                                 │  providers, check-ins,
                 │  Vector store (pluggable)       │  summaries, index state
                 │  qdrant | local JSON            │
                 └─────────────────────────────────┘
```

## The chat turn, step by step

`runChatTurn` (lib/chatEngine.ts) is an async generator that yields SSE events
as the turn progresses:

1. **Persist the user message** immediately — the archive is append-first, so a
   crash mid-turn never loses user input.
2. **Build the retrieval query** from the latest user turn plus a short tail of
   the previous assistant reply (context-dependent queries embed better).
3. **Retrieve** top-K semantic memories from the vector backend (over-fetch 24,
   re-rank, cut to K).
4. **Re-rank** with type/source boosts and apply **summary rescue** (see below).
5. **Assemble the prompt stack** (see below) and trim history to the remaining
   token budget, always keeping the newest message.
6. **Run the tool loop**: the model may call up to 6 tools per turn; every call
   is argument-validated, executed against real workspace capabilities, clipped
   to 30k chars, and fed back. After the cap, one final pass runs with tools
   disabled.
7. **Stream the final answer** as small token chunks over SSE.
8. **Persist the assistant message** with metadata: provider/model, mock flag,
   retrieved IDs, retrieval errors, and the full tool-call audit list.
9. **Auto-index** the conversation if the per-provider cadence gate says it's
   due (every N turns), so the index stays warm without slowing chat down.

## Memory layers

| Layer | Storage | Latency | Scope | Mutability |
|---|---|---|---|---|
| Agent stack (core/*.md) | Markdown files | injected every prompt | identity, behavior, principles, live state | edited directly or via reviewed proposals |
| Journal (journal/*.md) | Markdown files | retrieved on demand | dated continuity log | append-only via tool |
| Rooms (notes/, projects/, scratchpad/) | Markdown files | retrieved on demand | durable facts, active work, scratch | edited directly or via proposals |
| Semantic index | Qdrant or local JSON | per-turn retrieval | chunks of files, messages, summaries | rebuilt from archive any time |
| Conversation archive | SQLite | per-turn history trim | full raw history | append-only |
| Thread summaries | SQLite + indexed | retrieved + rescued | compressed windows of threads | regenerated on demand |

The **invariant**: vectors are a *rebuildable index*, never the archive. Raw
messages and Markdown files are the source of truth. That's why vector point
IDs are deterministic:

```
point_id = sha256("memory-file:{path}:{chunkIndex}")[:32]
point_id = sha256("conversation-message:{messageId}")[:32]
point_id = sha256("conversation-summary:{conversationId}:{summaryKey}")[:32]
```

Re-indexing the same content overwrites the same points — no duplicate drift,
and the entire index can be rebuilt from disk + SQLite after any failure.

## Prompt stack

`buildSystemPrompt` assembles, under explicit token budgets:

```
system shell (6-line operating contract)
Agent Stack (core/*.md under a budget; skipped files are reported, not dropped silently)
current local time (workspace timezone)
[RETRIEVED SEMANTIC MEMORY] (re-ranked, formatted under the retrieval budget)
```

Budgets derive from the provider config: `contextWindowTokens − maxTokens
(reply reserve) − retrieval budget − shell cost`, with floors so a misconfigured
provider degrades gracefully instead of producing empty prompts.

## Retrieval re-ranking & summary rescue

Raw cosine scores are boosted by what the memory *is*:

- conversation summary **+0.16**
- watch-thread message **+0.08**, watch-thread summary extra **+0.06**
- core file **+0.07**, projects **+0.05**, notes **+0.04**, journal **+0.03**
- isolated non-watch message **−0.025**

Then **summary rescue**: if no conversation summary survives the top-K cut but
one exists with raw score ≥ 0.2, it swaps in for the weakest non-summary.
Rationale: summaries compress whole threads; losing them to message fragments
hurts long-range continuity disproportionately. Rescued items are flagged
(`summaryRescued: true`) and visible in the UI inspector.

## Tool loop contract

- Tool definitions are name-sanitised (deduped with suffixes, ≤64 chars).
- Arguments are parsed, then validated against each tool's JSON schema
  (required fields, primitive types, enums). Failures are returned *to the
  model* as `{ ok: false, error }` tool results — never thrown across the loop.
- Results are clipped at 30k characters.
- Per-turn cap: 6 calls. When hit, the loop runs one final pass with an empty
  tool list so the model must answer from what it has.
- The runtime surface: `read_memory_file`, `list_memory_files`,
  `append_journal_entry`, `create_memory_draft`, `edit_memory_file`,
  `propose_memory_edit`, `search_memory`, `get_current_time`,
  `summarize_conversation`.

## Background lanes

### Check-ins (lib/checkIns.ts)

Agent-initiated scheduled messages.

- **Atomic claiming**: `pending → processing` inside a transaction, so two
  watcher processes can't deliver the same item.
- **Stale recovery**: items stuck in `processing` for 15+ minutes are returned
  to `pending` (crash recovery).
- **Occurrence dedupe**: deliveries are keyed `${checkInId}:${dueAt}` in message
  metadata; a retried cycle skips already-delivered occurrences.
- **Recurrence**: after delivery, `daily`/`weekly` items are rescheduled;
  `none` items are marked `fired`.
- **Fallback messages**: with a live provider the message is generated with
  full prompt context; offline (or on model failure) the pre-written fallback
  is delivered. A check-in must never fail silently.

### Maintenance cycle (lib/maintenance.ts)

Keeps the workspace fresh between conversations:

1. Refresh `core/live_state.md` from recent activity (mock template offline,
   generative with a live model) — with backup.
2. Append a journal entry describing what the cycle did.
3. Optionally summarize + index the active thread.
4. Re-index every file it touched (deterministic IDs → overwrite, not dupes).

Guards: global enable flag (`AGENT_MAINTENANCE_ENABLED`), cooldown interval
(default 6h, clamped 15m–1w), and a change guard (skips when the active thread
hasn't changed since the last run). Every run persists a status blob readable
from the Settings page.

## Data model (SQLite, WAL)

`providers`, `app_settings`, `conversations`, `messages` (JSON metadata),
`pending_file_edits`, `conversation_summaries`, `check_ins`,
`conversation_index_state`. Foreign keys are enforced; messages cascade with
their conversation.

## Security posture

- Provider/embedding/Qdrant API keys are stored server-side only and replaced
  with `••••••••` in every API response; a redacted key in an update payload
  means "unchanged".
- Memory file paths are validated against `^[a-zA-Z0-9_\-/]+\.md$` and reject
  `..` — no path traversal.
- Workspace export (`/api/export`) deliberately excludes provider settings.
- Every memory overwrite creates a timestamped backup first.

## Known limits (honest list)

- Local embeddings are deterministic hash buckets — good enough to demo the
  pipeline offline, not a substitute for a real embedding model.
- The mock model is heuristic by design; it demonstrates the *architecture*
  (retrieval → tools → grounded answer), not generation quality.
- SQLite + a JSON vector store are single-node choices; the provider/vector
  contracts are the seam where a real deployment scales out.
