---
name: ui-development
description: Implement or refine GPBW components and styles using existing UI foundations, local style ownership, and explicit responsive behavior. Use for CSS, visual layout, component composition, modals, widths, heights, wrapping, overflow, or scrolling; do not use for business logic or runtime timing bugs.
---

# UI Development

## Inspect before choosing a tool

1. Read the owning component and its adjacent `*.style.ts`, `*.styles.ts`, or equivalent stylesheet.
2. Locate the existing shared component, token, style helper, layout primitive, or responsive utility that solves the same kind of problem.
3. Inspect its definition and at least one current consumer before using or extending it; do not infer an API from its name.
4. Keep project-specific locations in `$gpbw-project` repository pointers instead of duplicating them here.

Reuse an established component or helper when its semantics match. A location pointer is enough: inspect the current implementation at task time rather than copying a stale usage guide into this skill.

## Component and style ownership

- The component that owns layout owns its composition, sizing contract, and responsive mode.
- Keep local visual behavior in the adjacent style file when only one owner needs it.
- Promote a primitive only after a second real consumer establishes shared semantics.
- Keep business rules and data normalization outside style helpers and presentational components.
- Preserve existing design tokens, spacing scales, typography, and component variants before adding literals or parallel abstractions.

## Responsive decisions

Classify every responsive change before implementation:

- **Scale:** the same property changes continuously with available space. Prefer existing fluid helpers, CSS constraints, `min`/`max`/`clamp`, wrapping, and local container behavior.
- **Mode switch:** layout or interaction changes at a breakpoint or container boundary. Use an established responsive boundary or media/container query only when the mode change is real.

- Identify the layout owner and the single scroll owner before editing overflow.
- Use shared breakpoint behavior only when multiple owners need the same mode.
- Check relevant narrow, intermediate, and stable desktop widths; common probes include 320, 375, 430, 768, and 1024 pixels, but only when they exercise this component.

## Avoid

- Copying fixed design-frame dimensions into responsive UI.
- Adding resize listeners when CSS expresses the behavior.
- Creating a new helper or component without checking existing foundations and consumers.
- Global CSS or global responsive configuration for one local component.
- Nested scroll owners, unbounded fixed widths, or overflow fixes that hide an ownership error.
- Visual fallback branches for states the component contract declares impossible.
