---
name: pull-request-authoring
description: Create or update a pull request title and body from the actual branch, commits, and diff. Use when preparing PR content or reporting validation and runtime notes; do not use for implementing the code change itself.
---

# Pull Request Authoring

- Derive the title and description from the actual code changes or commit set, not template filler.
- If the branch contains exactly one clear ticket, prefix the title with it. Do not invent or guess a ticket.
- Replace all template comments with concrete context.
- Use `## Summary`, `## Why`, and `## Test Evidence`; add `## Runtime Notes` when migration, fallback, rollout, timing, streaming, or other runtime-sensitive behavior matters.
- In `Test Evidence`, list exact commands and outcomes. Prefer affected tests first, followed by relevant typecheck, lint, build, and manual verification.
- State explicitly when a broader check was not run or is failing for an unrelated reason.
- Call out local changes intentionally excluded from the pull request.

