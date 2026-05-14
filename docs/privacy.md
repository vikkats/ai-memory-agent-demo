# Privacy and Sanitization Notes

This repository is a public portfolio demo. It is not a dump of a private production project.

## What was removed

The public version excludes:

- real API keys
- environment secrets
- private production URLs
- real user conversations
- real memory files
- personal identity documents
- private community references
- private screenshots
- deployment logs
- sensitive prompts

## What was preserved

The public version keeps the general product and system design ideas:

- configurable AI provider settings
- vector-memory architecture
- transparent retrieval UX
- multimodal input concepts
- scheduled background check-ins
- image gallery concept
- privacy-first framing

## Why sanitization matters

AI memory systems can contain highly sensitive personal context. A responsible public demo should demonstrate architecture and UX thinking without exposing private data.

## Safe demo data

All sample data in this repository is fictional and created only to demonstrate interface behavior.

## Recommended production practices

- Keep secrets in environment variables.
- Never commit `.env` files.
- Avoid indexing raw private conversations without user review.
- Prefer summaries or user-approved memories for long-term storage.
- Add deletion and exclusion controls.
- Log background agent actions.
- Make memory retrieval visible and inspectable.
