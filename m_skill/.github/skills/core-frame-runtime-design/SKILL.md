---
name: core-frame-runtime-design
description: Work on provider-agnostic Core chat runtime, AG-UI message flow, AnswerSource and MessageReader, Frame rendering, branch or turn snapshots, submission queues, schedulers, or chat queue integration. Do not use for application-only UI or service behavior.
---

# Core Frame Runtime Design

Core is a portable runtime and rendering layer, not an application feature. Keep backend payload meaning, market behavior, business layout, and application composition outside Core.

## Read by concern

- Read [references/architecture.md](references/architecture.md) for package purpose, layer ownership, and public boundaries.
- Read [references/runtime-and-messages.md](references/runtime-and-messages.md) for turns, branches, `MessageReader`, local messages, errors, filters, and compare mode.
- Read [references/rendering.md](references/rendering.md) for `FrameRenderer`, `FrameListView`, composed views, and card ownership.
- Read [references/queue-and-sources.md](references/queue-and-sources.md) for `SubmissionQueue`, schedulers, `AnswerSource`, AG-UI bridges, cancellation, and dispatch semantics.

## Non-negotiable boundaries

- Use AG-UI `Message` as the message contract and keep Frame-named render primitives.
- Do not parse backend events in generic runtime or render layers.
- Do not mutate runtime snapshots or readers to manufacture UI state.
- Do not reintroduce retired `FrameCommit[]`, `FrameStore`, `ProtocolAdapter`, `MessageParser`, or `createCoreRuntime` APIs.
- Keep the change portable enough for Core to become a standalone package.

