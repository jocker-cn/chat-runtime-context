---
name: gpbw-project
description: Apply GPBW AI Agent Chat UI repository conventions for configuration, services, Zustand state, i18n, capabilities, charts, markdown tokens, ownership, and tests. Use for implementation or debugging in this codebase; do not use as a generic engineering workflow.
---

# GPBW Project

Start from the nearest repository owner and narrow the edit only after the behavior boundary is clear.

## Route the task

- Read [references/repository-map.md](references/repository-map.md) when locating owners, entry points, tests, or the fund-selection flow.
- Read [references/application-conventions.md](references/application-conventions.md) when changing configuration, services, Zustand state, i18n, or `runtimeKeyValueStore`.
- Read [references/capability-registry.md](references/capability-registry.md) for `core/capability` registration, lazy resolution, decorators, conditions, precedence, or capability tests.
- Read [references/chart-data-ui.md](references/chart-data-ui.md) for chart services, ECharts lifecycle, tooltip models, line-chart composition, range controls, or fund controls.
- Read [references/markdown-inline-tokens.md](references/markdown-inline-tokens.md) for matcher-to-transform configuration, market-owned inline rendering, citations, tags, or the inline-token pipeline.
- For components, styling, responsive behavior, modal sizing, wrapping, overflow, or scroll ownership, use `$ui-development`.
- For business rules, data transformations, required fields, defaults, validation boundaries, or fallback behavior, use `$logic-development`.
- For Core chat runtime, use `$core-frame-runtime-design` instead of loading application conventions that are unrelated to Core.
- For architecture, migration, or multi-owner changes, also use `$design-implementation-principles`.

## Constraints

- Prefer an established repository path over a parallel implementation.
- Keep application-specific behavior out of generic Core layers.
- Validate the owner that changed and report exact evidence at completion.
