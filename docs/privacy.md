# Privacy & Sanitization

This repository is the **public, sanitized** version of a private project. It
exists to demonstrate the agent architecture in a portfolio context. This file
documents what was removed, what was preserved, and why — both so reviewers
understand the provenance and so the boundary stays maintained.

## What was removed

- All personal data: names, conversations, journal content, life details,
  relationships, and anything identifying real people.
- The private project's domain framing, terminology, and naming — including
  any framing related to the private project's personal context.
- All credentials, endpoints, and environment-specific configuration
  (replaced by `.env.example` placeholders).
- Private repository history: this repo was created fresh, not forked, so no
  commit history carries private content.

## What was preserved (the point of the demo)

- The **architecture**: layered prompt stack with token budgeting, semantic
  retrieval with re-ranking and summary rescue, a validated tool loop,
  pluggable vector backends, scheduled check-ins, maintenance cycles,
  deterministic rebuildable indexing.
- The **safety mechanisms**: path guards, automatic backups, redacted secrets,
  reviewable memory edits, bounded autonomy with logs and kill switches.
- The **honesty mechanisms**: labeled mock mode, typed streaming events,
  retrieval inspector, documented known limits.

## Sanitization mapping

Private-project concepts were renamed to neutral engineering terms
(e.g. memory "rooms", "agent stack", "check-ins", "maintenance cycle"), and
all starter content was rewritten as generic demo material. No private text
survives anywhere in the tree.

## Production practices kept in the public code

- API keys are stored server-side and redacted (`••••••••`) in every response.
- Workspace exports deliberately exclude provider settings.
- Memory writes create backups before overwriting.
- File paths are validated against a strict allowlist regex.
