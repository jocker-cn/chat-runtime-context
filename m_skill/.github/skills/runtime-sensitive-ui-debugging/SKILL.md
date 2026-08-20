---
name: runtime-sensitive-ui-debugging
description: Diagnose interactive UI where timing, render stability, flicker, focus, streaming, weak-network behavior, or reference stability matters as much as static correctness. Use for runtime behavior; do not use for a purely visual style mismatch.
---

# Runtime-Sensitive UI Debugging

Trace the observed behavior end to end before choosing the fix boundary.

## Separate the states

- Data state
- Visual state
- Render state
- Transport or source state
- History, draft, and final state when the flow has phases

## Check by level

- Interaction: transient loading, repeated renders, focus, scroll movement, height changes, delayed final events, and partial content.
- State and flow: selector width, reference stability, ownership of temporary placeholders, and preservation across clear, retry, or replacement.
- Architecture: unnecessary object creation, render propagation, accidental global replacement, and owner-level update frequency.

Use focused tests near the owner, then verify the actual event order when timing matters. If test output and observed behavior disagree, inspect the runtime boundary rather than treating the test as final proof.

