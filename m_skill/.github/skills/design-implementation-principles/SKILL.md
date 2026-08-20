---
name: design-implementation-principles
description: Design architecture, migrations, refactors, or multi-owner runtime behavior with explicit ownership, stable boundaries, and incremental delivery. Do not use for a simple local edit that already has one clear owner.
---

# Design and Implementation Principles

## Architecture

- Design from ownership first and implementation second.
- Keep generic layers generic and domain layers domain-specific.
- Prefer explicit serializable contracts over implicit object shapes.
- Transform input at the boundary where raw data enters.
- Do not generalize from one special case without another real consumer.
- Treat established internal contracts as invariants; do not add defensive branches inside every consumer.
- Introduce a new runtime seam only when behavior has independent ownership, lifecycle, timing, transport semantics, or a staged replacement requirement. Keep an ordinary field, transform, or local conditional with its current owner.
- Encapsulate necessary runtime complexity at the owning boundary instead of scattering conditionals across consumers.

## Delivery

- Start with the smallest correct vertical slice.
- Use nearby working patterns before inventing a new abstraction.
- Keep helpers local until reuse is demonstrated.
- Prefer data-driven behavior over component timing or hidden side effects.
- When splitting is necessary, move one verified boundary at a time.
- Do not introduce extensibility, compatibility, or recovery paths unless the current requirement or repository evidence needs them.
- For a staged replacement, prove the existing and new paths at the changed boundary before switching consumers; stop after the requested path is stable unless cleanup is in scope.

## Validation

- Validate the layer that owns the behavior.
- Test pure transforms without UI or transport.
- Test source or transport bridges without full runtime rendering when possible.
- Use runtime or manual checks for streaming, timing, focus, flicker, and loading behavior.

Avoid big-bang rewrites, single-use shared abstractions, hidden cross-layer dependencies, and UI code that parses backend transport details.
