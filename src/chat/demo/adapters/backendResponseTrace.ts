import type { ResponseTraceEntry, ResponseTraceEvent } from "../../../features/ai-response-trace";
import type { BackendMessage } from "./backendMessage";

/** Only this demo integration knows its backend's event names and streaming boundaries. */
export function projectBackendResponseTrace(events: readonly ResponseTraceEvent[]): ResponseTraceEntry[] {
  const entries: ResponseTraceEntry[] = [];
  const streams = new Map<string, ResponseTraceEntry>();
  const calls = new Map<string, ResponseTraceEntry>();
  for (const observed of events) {
    const raw = observed.event as typeof observed.event & { source?: string; event?: unknown; message?: unknown };
    // RUN_* frames duplicate the original backend frames; keep transport errors if no backend error was received.
    if (raw.type === "RUN_ERROR" && !entries.some((entry) => entry.event === "error")) {
      entries.push({ id: String(observed.sequence), event: raw.type, content: raw.message, startedAt: observed.receivedAt, details: raw });
    }
    if (raw.type !== "RAW" || raw.source !== "copilot-backend") continue;
    const payload = raw.event;
    const message = payload && typeof payload === "object" ? payload as BackendMessage : undefined;
    const name = typeof message?.event === "string" ? message.event : "RAW";
    const id = message?.message?.id ?? "unknown";
    const add = (event: string = name, content: unknown = message?.message ?? payload): ResponseTraceEntry => {
      const entry = { id: String(observed.sequence), event, content, startedAt: observed.receivedAt, details: [observed] };
      entries.push(entry);
      return entry;
    };
    const streamName = name.startsWith("thinking_") ? "thinking"
      : name === "streaming" || name.startsWith("streaming_") ? "streaming" : undefined;
    if (streamName) {
      const key = `${streamName}:${id}`;
      let entry = streams.get(key);
      if (!entry) {
        entry = add(streamName, "");
        streams.set(key, entry);
      } else (entry.details as ResponseTraceEvent[]).push(observed);
      if (name === "thinking_delta" || name === "streaming") entry.content = String(entry.content) + (message?.message?.content ?? "");
      if (name.endsWith("_completed")) {
        entry.endedAt = observed.receivedAt;
        streams.delete(key);
      }
    } else if (name === "function_call") {
      calls.set(id, add());
    } else if (name === "tool_result") {
      const call = calls.get(id);
      if (call) {
        call.endedAt = observed.receivedAt;
        calls.delete(id);
      }
      // A result frame is an instant observation, not another tool execution interval.
      const entry = add(name, message?.message?.content ?? message);
      entry.endedAt = observed.receivedAt;
    } else {
      const entry = add(name, message?.error ?? message?.message ?? payload);
      // Single backend notifications have no measured execution interval.
      if (["run_started", "completed", "error"].includes(name)) entry.endedAt = observed.receivedAt;
    }
  }
  return entries;
}
