---
name: analysis-first-collaboration
description: Diagnose observed or runtime behavior before editing, then iterate through small reversible changes and focused validation. Use when the user is still discovering the target state, wants explanation first, or is steering through short feedback loops.
---

# Analysis-First Collaboration

Separate current facts, likely causes, and optional next moves.

## Loop

1. Start from one concrete anchor: a file, symbol, failing test, log, or visible behavior.
2. State one falsifiable hypothesis about the owner of the behavior.
3. Identify one cheap check that could disconfirm it.
4. Explain the current behavior before proposing edits when the user is still exploring.
5. Make the smallest change that tests the direction, validate it, then keep, refine, redirect, or revert.

For PoCs, keep UTs and adjustments limited to core behavior; when integrating into production code, meet the project's test coverage requirements.

Do not lock implementation scope while the failing boundary is unclear. Tighten the plan promptly when the user narrows the request or asks to pause implementation.

Passing tests are evidence, not final proof, when observed runtime behavior contradicts them.
