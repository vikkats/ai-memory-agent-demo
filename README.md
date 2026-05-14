# AI Memory Agent Demo

A portfolio-friendly prototype for a configurable AI companion / agent dashboard with persistent memory, multimodal input, provider switching, scheduled check-ins, and transparent retrieval controls.

This repository is a **sanitized public demo** based on a private experimental project. It keeps the product architecture and UX patterns while removing personal data, private prompts, production URLs, API keys, and real memory files.

## Why this project exists

Most chat interfaces treat conversations as disposable. This prototype explores what happens when an AI agent has:

- configurable model providers
- persistent memory files
- vector search over past context
- multimodal input support
- visible memory controls
- scheduled background check-ins
- a gallery for generated or uploaded images
- a UI designed for long-running continuity instead of one-off prompts

The goal is not to build another chatbot. The goal is to design a **memory-aware agent workspace** where users can inspect, shape, and manage the context that influences the assistant.

## Core features

### Provider-agnostic model settings

The app is designed around provider flexibility. A user can configure:

- base URL
- API key
- model ID
- temperature
- top-p
- max tokens
- context window
- optional penalties
- optional embedding provider
- optional vision provider

This makes the app adaptable to OpenAI-compatible providers, hosted model gateways, local models, and future model switches.

### Persistent memory architecture

The demo models three memory layers:

1. **Core files** — stable identity, product behavior, UX rules, and operating principles.
2. **Conversation history** — recent chat state and selected long-running threads.
3. **Vector retrieval** — semantic search over indexed context using a Qdrant-like vector store.

The public demo uses fake sample data only.

### Transparent retrieval

The product idea is that memory should not feel magical or hidden. Users should be able to understand what context was retrieved and why.

Potential UX surfaces:

- retrieved memory cards
- source labels
- timestamps
- score/debug view
- memory edit proposals
- pinned memories
- excluded memories

### Multimodal support

The private project supports image upload workflows. This public demo keeps the UI concept:

- upload image
- preview image in chat
- send image to a vision-capable model
- optionally use a separate vision adapter for blind models
- store generated/uploaded images in a gallery

### Scheduled check-ins

The app includes a conceptual background watcher that can periodically decide whether to:

- send a check-in
- write a private note
- do nothing
- run a maintenance task

In this public version, this is framed as a **scheduled agent check-in** feature rather than a personal heartbeat system.

## UX focus

This project is especially useful as a UX/product case study because it touches several difficult design questions:

- How much memory should an AI agent expose to users?
- How can users trust retrieved context?
- How do we prevent stale or irrelevant memories from steering replies?
- How do we design long-running continuity without making the app feel heavy?
- How should background autonomy be controlled, logged, and reviewed?
- How do we support model/provider changes without forcing users to rebuild everything?

## Tech stack

The demo is structured around:

- Next.js / React
- TypeScript
- SQLite-style local persistence
- Qdrant-style vector retrieval
- OpenAI-compatible provider abstraction
- modular runtime tools
- local-first memory files

This public repository includes a simplified implementation and product scaffold rather than the full private production app.

## Repository structure

```txt
app/
  page.tsx                 Demo dashboard UI
  layout.tsx               App shell
components/
  ChatMockup.tsx           Portfolio-safe chat interface mockup
  MemoryPanel.tsx          Transparent memory/retrieval panel
  ProviderSettings.tsx     Model configuration mockup
  GalleryMockup.tsx        Image gallery concept
lib/
  sampleData.ts            Fake memories, messages, and provider data
  types.ts                 Shared demo types
docs/
  architecture.md          System design overview
  ux-case-study.md         UX/product framing
  privacy.md               Sanitization and privacy notes
```

## Running locally

```bash
npm install
npm run dev
```

Then open:

```txt
http://localhost:3000
```

## Environment variables

This public demo does not require real API keys. See `.env.example` for placeholder names.

Never commit real API keys, database URLs, private prompts, or personal memory files.

## Portfolio framing

Suggested description:

> Designed and prototyped an AI memory-agent dashboard with provider switching, persistent memory architecture, vector retrieval, multimodal input concepts, scheduled agent check-ins, and transparent memory controls. Built as a privacy-conscious UX/product exploration for long-running AI interactions.

## Status

Public sanitized demo. Private production code and personal data are intentionally excluded.
