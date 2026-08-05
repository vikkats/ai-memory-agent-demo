# UX Case Study: making an agent's memory inspectable

## Problem

Most "AI memory" demos are black boxes: the model says it remembers, the user
has to take its word for it. For an agent whose entire value proposition is
durable memory and bounded autonomy, *trust is the product* — and trust comes
from inspection, not assertion.

The design goal: every claim the system makes about memory must be checkable
in the UI within one click.

## Key decisions

### 1. The retrieval inspector is a first-class UI element, not a debug panel

Every assistant answer carries a `⌕ N retrieved` toggle that expands the exact
memories used for that turn: raw vector score, re-ranked score, source path,
and whether the item was pulled in by summary rescue. If the agent "remembers"
something, the user can see the receipt.

**Shipped in:** `components/ChatClient.tsx` (RetrievalInspector), SSE `meta`
event carrying full ranked payloads.

### 2. Memory is plain Markdown the user can edit — with guardrails

Files on disk beat a database blob for inspectability: users can read, diff,
and back up memory with ordinary tools. The UI adds the two guardrails that
make direct editing safe: automatic timestamped backups on every write, and a
proposal queue so the *agent's* significant edits require human accept/reject.

**Shipped in:** `lib/memory.ts` (backups, safe-path guard),
`lib/pendingEdits.ts`, `components/MemoryBrowser.tsx`.

### 3. Autonomy is visible, logged, and has an off switch

Scheduled check-ins and the maintenance cycle are the moments an agent acts
*without* being asked — exactly where trust is most fragile. Both lanes write
their reasoning into inspectable places: check-in deliveries land in the
conversation with structured metadata; maintenance journals what it did into
`journal/` and a status blob on the Settings page. Every background action has
a cooldown, a dedupe mechanism, or a kill switch.

**Shipped in:** `lib/checkIns.ts`, `lib/maintenance.ts`,
`components/CheckInManager.tsx`, `components/SettingsForm.tsx`.

### 4. Offline mode is honest, not theatrical

The demo runs with zero API keys — but instead of canned chat responses, the
mock model sits at the driver contract and exercises the real pipeline. The UI
labels every mock answer and the status strip says "offline mock model" up
front. A reviewer never has to wonder whether they're seeing the real
architecture or a staged demo: it's the real architecture with a deterministic
model.

**Shipped in:** `lib/mockModel.ts`, `docs/adr/0002-offline-mock-model.md`,
status badges in `components/StatusStrip.tsx` and message metadata.

### 5. Streaming is structural, not cosmetic

The SSE stream carries typed events — `status`, `meta`, `tool`, `token`,
`done`, `error` — so the UI can show *what the system is doing* ("Retrieving
semantic memory…", "Tool: search_memory ✓") rather than a spinner. Retrieval
results arrive before the first token, so the inspector is populated while the
answer is still typing.

**Shipped in:** `app/api/chat/route.ts`, `lib/chatEngine.ts`,
`readSseStream` in `components/ChatClient.tsx`.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Inspector exposes internals that confuse non-technical users | Scores are formatted compactly and collapsed by default; prose stays primary |
| Direct file editing lets users break the agent stack | Backups on every write; core files documented with load order in `core/START_HERE.md` |
| Mock mode misread as the product's real quality | Badges on every mock answer + explicit docs about what mock demonstrates |
| Background autonomy feels spooky | Everything logged, reversible, and gated; dedupe prevents double-delivery |

## Next improvements

- Diff view for pending edit proposals (old vs. proposed side by side).
- Retrieval quality harness: fixed query set with expected sources, run in CI.
- Per-memory "forget this" action that removes both the archive entry and its
  vector points.
