import type { BaseEvent } from "@ag-ui/client";
import type { ResponseTraceEntry, ResponseTraceStore } from "../../features/ai-response-trace";

/** Standard AG-UI event handling is confined to this plugin. */
export function reportAgUiEvents(store: ResponseTraceStore, responseId: string,
  events: readonly { event: BaseEvent; receivedAt: number }[]): void {
  const streams = new Map<string, ResponseTraceEntry>();
  const tools = new Map<string, ResponseTraceEntry>();
  let sequence = 0;
  for (const observed of events) {
    const event = observed.event as BaseEvent & Record<string, unknown>;
    const at = observed.receivedAt;
    const add = (type: string, content: unknown, name = type): ResponseTraceEntry =>
      ({ id: String(++sequence), type, name, content, startedAt: at, details: [observed] });
    let entry: ResponseTraceEntry;
    const stream = /^(TEXT_MESSAGE|REASONING_MESSAGE)_(START|CONTENT|END)$/.exec(event.type);
    if (stream) {
      const key = `${stream[1]}:${String(event.messageId)}`;
      const previous = streams.get(key);
      entry = previous ?? add(stream[1]!, "");
      if (previous) (entry.details as unknown[]).push(observed);
      streams.set(key, entry);
      if (stream[2] === "CONTENT") entry.content = String(entry.content) + String(event.delta ?? "");
      if (stream[2] === "END") { entry.endedAt = at; streams.delete(key); }
    } else if (event.type === "TOOL_CALL_START") {
      entry = add("TOOL_CALL", "", String(event.toolCallName ?? "TOOL_CALL"));
      tools.set(String(event.toolCallId), entry);
    } else if (event.type === "TOOL_CALL_ARGS" || event.type === "TOOL_CALL_END") {
      const call = tools.get(String(event.toolCallId));
      if (!call) { entry = add(event.type, event); }
      else {
        entry = call;
        if (event.type === "TOOL_CALL_ARGS") entry.content = String(entry.content) + String(event.delta ?? "");
        (entry.details as unknown[]).push(observed);
      }
    } else if (event.type === "TOOL_CALL_RESULT") {
      const call = tools.get(String(event.toolCallId));
      if (call) { call.endedAt = at; store.report(responseId, call); tools.delete(String(event.toolCallId)); }
      entry = add(event.type, event.content);
      entry.endedAt = at;
    } else if (event.type === "ACTIVITY_SNAPSHOT") {
      const key = `activity:${String(event.messageId)}`;
      const previous = streams.get(key);
      entry = previous ?? add(event.type, event.content, String(event.activityType ?? event.type));
      entry.content = event.content;
      if (previous) (entry.details as unknown[]).push(observed);
      streams.set(key, entry);
    } else {
      entry = add(event.type, event.type === "RUN_ERROR" ? event.message : event, event.type === "RUN_ERROR" ? "error" : event.type);
      if (["RUN_STARTED", "RUN_FINISHED", "RUN_ERROR"].includes(event.type)) entry.endedAt = at;
    }
    store.report(responseId, entry);
  }
}
