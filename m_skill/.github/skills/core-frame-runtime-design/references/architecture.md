# Core Architecture

## Purpose

- Core provides provider-agnostic chat runtime and transport-independent queue primitives.
- Core owns snapshots and lifecycle, source orchestration, message-reader wiring, generic queue state and scheduling, selector hooks, and generic render primitives.
- Core does not own market behavior, request payload shape, visual layout, backend-specific event semantics, application session handling, market cards, or renderer/card registration.

## Layer ownership

- `chat/contracts/`: `ChatRuntime`, snapshots, turns, branches, `MessageReader`, and branch-selection contracts.
- `chat/runtime/`: send, cancel, reset, select, lifecycle, branch status, history initialization, and shared-reader branch isolation.
- `chat/source/`: `AnswerSource`, source events and context, message stores, and AG-UI bridging through `AgUiAgentSource`.
- `chat/context/`: React providers and public selector hooks over runtime snapshots and branches.
- `chat/frame/` and `chat/view/`: AG-UI message rendering, adjacent grouping, render context, `FrameRenderer`, internal `FrameListView`, and composed views.
- `queue/`: generic queue contracts, `SubmissionQueue`, `QueueScheduler`, selection policies, and queue React bindings.
- `chat/queue/`: only the `QueueDispatchTarget` adapter for `ChatRuntime`.
- `streaming/` and `react/`: top-level Core modules; `internal/` is shared implementation detail, not public API.
- Template and application code: runtime construction, request parameters, session handling, market cards, and renderer or card registration.

Keep public imports deliberate. Internal implementation should not leak through barrel exports.

