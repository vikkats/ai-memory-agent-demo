import { StatusStrip } from "@/components/StatusStrip";

const FLOW = `
 user message
      │
      ▼
 ┌──────────────────────────────────────────────────────┐
 │ 1. persist user turn            (SQLite messages)     │
 │ 2. retrieve semantic memory     (vector backend)      │
 │ 3. re-rank + summary rescue     (boosts, top-K cut)   │
 │ 4. assemble prompt stack        (shell → agent stack  │
 │                                  → time → retrieval   │
 │                                  → trimmed history)   │
 │ 5. model + tool loop            (validated calls,     │
 │                                  per-turn cap)        │
 │ 6. stream answer (SSE)                                │
 │ 7. persist assistant turn       (tool usage metadata) │
 │ 8. cadence-gated auto-indexing                        │
 └──────────────────────────────────────────────────────┘

 background lanes:  check-in watcher  ·  maintenance cycle
`;

const FEATURES = [
  {
    href: "/chat",
    title: "Chat with retrieval inspector",
    body: "Every answer shows exactly which memories were retrieved, their raw scores, re-ranked scores, and whether summary rescue pulled a thread summary into the context.",
  },
  {
    href: "/memory",
    title: "Inspectable, editable memory",
    body: "Memory lives in Markdown rooms (core / journal / notes / projects / scratchpad). Edits create timestamped backups; proposals need human accept/reject.",
  },
  {
    href: "/checkins",
    title: "Scheduled check-ins",
    body: "The agent can reach out on a schedule: atomic claiming, stale-claim recovery, occurrence dedupe, and daily/weekly recurrence.",
  },
  {
    href: "/settings",
    title: "Pluggable providers + vectors",
    body: "Any OpenAI-compatible endpoint. Qdrant or a local JSON vector store behind one contract. Keys are redacted server-side and never serialized back.",
  },
  {
    href: "/settings",
    title: "Maintenance cycle",
    body: "A background cycle refreshes live state, journals what it did, optionally summarizes the active thread, and re-indexes what it touched — with cooldown and change guards.",
  },
  {
    href: "/chat",
    title: "Runs fully offline",
    body: "A deterministic mock model and local embeddings implement the same driver/store contracts, so the whole pipeline works with zero API keys.",
  },
];

export default function OverviewPage() {
  return (
    <div>
      <section className="hero">
        <h1>A memory-augmented agent you can actually inspect</h1>
        <p>
          Not a chat mockup: a working agent runtime with layered prompt assembly, semantic
          retrieval over a rebuildable vector index, a validated tool loop, scheduled
          background behavior, and full audit trails — everything visible in the UI.
        </p>
        <StatusStrip />
      </section>

      <section className="panel">
        <h2>What happens in one chat turn</h2>
        <pre className="flow-diagram">{FLOW}</pre>
      </section>

      <section>
        <h2>Subsystems</h2>
        <div className="feature-cards">
          {FEATURES.map((feature) => (
            <a key={feature.title} className="feature-card" href={feature.href}>
              <h3>{feature.title}</h3>
              <p>{feature.body}</p>
            </a>
          ))}
        </div>
      </section>
    </div>
  );
}
