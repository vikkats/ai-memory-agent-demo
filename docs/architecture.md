# Architecture Notes

This document describes the public demo architecture for an AI memory-agent dashboard. It intentionally avoids private prompts, real user data, production secrets, and personal memory files.

## Product model

The application is organized around four core surfaces:

1. **Conversation workspace** — the main chat interface.
2. **Memory panel** — retrieved context shown to the user.
3. **Provider settings** — model/provider configuration.
4. **Background check-ins** — scheduled agent actions with logs and controls.

## Context pipeline

A typical generation flow looks like this:

```txt
User message
  ↓
Recent conversation history
  ↓
Expanded retrieval query
  ↓
Vector search over memory store
  ↓
Prompt assembly
  ↓
Model provider call
  ↓
Assistant response
  ↓
Optional indexing / logging
```

## Memory layers

### Core files

Stable documents that define product behavior, UX principles, and agent operating rules.

Examples:

- `core/product-principles.md`
- `core/agent-behavior.md`
- `core/memory-policy.md`

### Conversation history

Recent turns are kept in the active context window so the model can respond naturally to the current conversation.

### Vector retrieval

Older notes, files, and selected conversation summaries can be embedded and stored in a vector database such as Qdrant.

Retrieved items should include metadata:

- source
- timestamp
- score
- memory type
- editability

## Retrieval UX principles

Memory-aware systems need inspectability. The user should be able to answer:

- What did the assistant retrieve?
- Why was this context considered relevant?
- Is this memory stale?
- Can I edit, pin, or exclude it?
- Did the assistant use private or sensitive context?

## Multimodal path

For vision-capable models, uploaded images can be sent directly in the latest user message.

For blind models, a separate vision adapter can convert images into notes before the main model answers.

```txt
Image upload
  ↓
Local / remote image reference
  ↓
Vision-capable model OR vision adapter
  ↓
Visual notes injected into latest user message
  ↓
Main response
```

## Scheduled check-ins

Background autonomy is treated as a reviewable system, not invisible magic.

A scheduled check-in can decide between:

- send a check-in
- write a private note
- run memory maintenance
- do nothing

Controls should include:

- cooldowns
- silence windows
- logs
- disable switch
- dry-run mode
- visible reasoning summary

## Privacy boundaries

Public demos should never include:

- real API keys
- private production URLs
- real conversation exports
- personal identity files
- intimate or sensitive prompts
- private community references
- screenshots with identifying information

This repository uses fake sample data only.
