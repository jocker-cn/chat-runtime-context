# Queue and Source Rules

## Queue

- Keep `SubmissionQueue` payload-agnostic. Chat-specific conversion and runtime status mapping belong in `createChatRuntimeQueueTarget()`.
- Preserve item transitions: `queued -> dispatching -> removed|failed|queued`. Only failed items retry; claimed items cannot be edited or removed.
- A scheduler instance dispatches one item at a time, honors `scheduledAt`, and waits for `running` or `blocked` targets. Do not claim serialization across scheduler instances.
- A dispatch succeeds when `runtime.send()` accepts and starts the turn, not when the answer completes.
- `pause()` does not abort an in-flight dispatch. Disposing a scheduler releases its claimed item but does not clear the queue or call `runtime.cancel()`.
- Keep retry, error blocking, and selection policy explicit instead of embedding application rules in queue internals.

## Sources and AG-UI

- `AnswerSource` implementations own transport or agent behavior, input-to-agent parameters, cancellation, deletion, and disposal.
- `AgUiAgentSource` is the AG-UI bridge. Keep AG-UI-specific assumptions there rather than in runtime or cards.
- Completion and errors use `ChatSourceEvent`; cancellation uses `AbortSignal`, optional source cancellation, and a direct branch `cancelled` transition.
- Compare mode uses independent source or agent instances unless a shared source is intentionally designed for concurrency.

