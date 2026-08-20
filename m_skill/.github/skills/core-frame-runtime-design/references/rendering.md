# Rendering Rules

- Public custom rendering starts with `useBranchMessages(branchId)`, which reads a branch `MessageReader` and applies its selector.
- The composed flow is `ChatRuntimeView -> TurnView -> BranchView -> useBranchRenderState -> FrameListView`; the final two are internal and should not become barrel exports.
- `FrameListView` groups adjacent messages and passes `{ message, context }` to cards selected by `FrameRenderer`.
- Keep Frame names as render terminology unless a requested task explicitly changes the public API.
- Cards own visual composition. Use `MessageRenderContext`, extension hooks, and narrow subscriptions for high-frequency UI.
- Do not expose snapshot internals through public hooks or make cards parse transport-specific backend events.

