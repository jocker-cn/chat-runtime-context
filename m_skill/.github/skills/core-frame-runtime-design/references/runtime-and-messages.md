# Runtime and Message Rules

- Runtime state is turn and branch metadata plus message readers. Message content comes from AG-UI `Message[]`.
- Sources publish updates through `MessageReader` and `ChatSourceEvent`; runtime code must not parse backend payloads directly.
- `sendLocalMessage()` adds one message as a tracked turn without starting a backend run. Use `placement: 'input'` for user-side messages and `placement: 'branch'` for answer-side messages. A multi-source runtime requires an explicit source branch ID.
- `AnswerSource.addLocalMessage()` is synchronous: its reader must expose the appended message before the method returns. Do not mutate readers or snapshots from a card or page.
- Recoverable error turns belong in `core/chat/operations/errorMessages.ts`. Use `addUserErrorMessage()` or `addAssistantErrorMessage()`, then `clearErrorMessagesBeforeSend()` before a replacement submission. Clear only consecutive terminal error turns.
- `CompareChatRuntime` shares the same owner for single and compare flows. `SingleAgentRuntime` remains a thin one-source wrapper.
- One runtime accepts one active turn. Branches inside that turn may run concurrently. `send()` returns after runs start, not when answers finish.
- Branch filtering, selection, cancellation, and deletion stay in runtime or source owners, not view components.
- Domain fields belong in AG-UI message fields, metadata, source metadata, card interpretation, or extension state.

When a visible error follows a run stop, wait until the runtime is no longer running before adding the local assistant error. If a queued replacement exists, do not add a competing error turn.

