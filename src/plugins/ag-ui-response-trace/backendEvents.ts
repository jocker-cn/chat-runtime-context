import type { ResponseTraceEntry, ResponseTraceStore } from "../../features/ai-response-trace";
// This is the current backend's RAW payload contract, confined to this event handler.
type BackendMessage = {
  event?: unknown;
  message?: { id?: string; content?: string; name?: string; arguments?: unknown };
  error?: string;
};

type Frame = { receivedAt: number; payload: unknown };

/** The demo reports its native protocol. The reusable recorder has no lifecycle or protocol adapter. */
export function createBackendEventReporter(store: ResponseTraceStore) {
  let currentResponse: string | undefined;
  let sequence = 0;
  let hasError = false;
  const streams = new Map<string, ResponseTraceEntry>();
  const calls = new Map<string, ResponseTraceEntry>();

  return (responseId: string, payload: unknown, receivedAt = Date.now()) => {
    if (currentResponse !== responseId) {
      currentResponse = responseId;
      sequence = 0;
      hasError = false;
      streams.clear();
      calls.clear();
    }
    const message = payload && typeof payload === "object" ? payload as BackendMessage : undefined;
    const type = typeof message?.event === "string" ? message.event : "unknown";
    // The SDK may repeat the same native backend error through its error callback.
    if (type === "error") { if (hasError) return; hasError = true; }
    const id = message?.message?.id ?? "unknown";
    const frame: Frame = { receivedAt, payload: structuredClone(payload) };
    const add = (eventType = type, content: unknown = message?.message ?? payload): ResponseTraceEntry =>
      ({ id: String(++sequence), type: eventType, name: eventType, content, startedAt: receivedAt, details: [frame] });
    const streamType = ["thinking_started", "thinking_delta", "thinking_completed"].includes(type) ? "thinking"
      : ["streaming_started", "streaming", "streaming_completed"].includes(type) ? "streaming" : undefined;
    let entry: ResponseTraceEntry;
    if (streamType) {
      const key = `${streamType}:${id}`;
      const previous = streams.get(key);
      entry = previous ?? add(streamType, "");
      if (previous) (entry.details as Frame[]).push(frame);
      streams.set(key, entry);
      if (type === "thinking_delta" || type === "streaming") entry.content = String(entry.content) + (message?.message?.content ?? "");
      if (type.endsWith("_completed")) {
        entry.endedAt = receivedAt;
        streams.delete(key);
      }
    } else if (type === "function_call") {
      entry = add();
      calls.set(id, entry);
    } else if (type === "tool_result") {
      const call = calls.get(id);
      if (call) {
        call.endedAt = receivedAt;
        store.report(responseId, call);
        calls.delete(id);
      }
      entry = add(type, message?.message?.content ?? message);
      entry.endedAt = receivedAt;
    } else {
      entry = add(type, message?.error ?? message?.message ?? payload);
      if (["run_started", "completed", "error"].includes(type)) entry.endedAt = receivedAt;
    }
    store.report(responseId, entry);
  };
}
