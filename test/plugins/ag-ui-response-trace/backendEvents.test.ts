import { describe, expect, it } from "vitest";
import { createResponseTraceStore } from "../../../src/features/ai-response-trace";
import { createBackendEventReporter } from "../../../src/plugins/ag-ui-response-trace/backendEvents";

function recording() {
  const store = createResponseTraceStore();
  const report = createBackendEventReporter(store);
  let at = 100;
  return { store, report, receive: (payload: unknown) => report("response", payload, at++) };
}

describe("native backend events handled by the AG-UI response trace plugin", () => {
  it("reports streaming groups and unknown native payloads directly without AG-UI RAW events", () => {
    const { store, receive } = recording();
    receive({ event: "thinking_started", message: { id: "first" } });
    receive({ event: "thinking_delta", message: { id: "first", content: "Before" }, extra: { notInSchema: 42 } });
    receive({ event: "thinking_delta", message: { id: "first", content: " tool" } });
    receive({ event: "thinking_completed", message: { id: "first" } });
    receive({ event: "function_call", message: { id: "call", name: "sum", arguments: { numbers: [2, 3] } } });
    receive({ event: "tool_result", message: { id: "call", content: '{"sum":5}' }, providerField: "keep" });
    receive({ event: "thinking_started", message: { id: "second" } });
    receive({ event: "thinking_delta", message: { id: "second", content: "After" } });
    receive({ event: "thinking_completed", message: { id: "second" } });
    receive({ event: "thinking_custom", newField: { preserve: true } });
    receive(null);
    const entries = store.getSnapshot("response")!.entries;
    expect(entries.filter((entry) => entry.type === "thinking").map((entry) => entry.content)).toEqual(["Before tool", "After"]);
    expect(entries.filter((entry) => entry.type === "thinking").map((entry) => entry.endedAt! - entry.startedAt)).toEqual([3, 2]);
    const call = entries.find((entry) => entry.type === "function_call")!;
    expect(call.endedAt! - call.startedAt).toBe(1);
    expect(entries.find((entry) => entry.type === "tool_result")?.content).toBe('{"sum":5}');
    expect(JSON.stringify(entries)).toContain('"providerField":"keep"');
    expect(JSON.stringify(entries)).toContain('"notInSchema":42');
    expect(entries.find((entry) => entry.type === "thinking_custom")?.content).toEqual({ event: "thinking_custom", newField: { preserve: true } });
    expect(entries.find((entry) => entry.type === "unknown")?.content).toBeNull();
  });

  it("pairs same-name calls by ID and leaves absent durations unset", () => {
    const { store, receive } = recording();
    for (const id of ["a", "b", "missing"]) receive({ event: "function_call", message: { id, name: "same", arguments: {} } });
    receive({ event: "tool_result", message: { id: "b", content: "plain text" } });
    receive({ event: "tool_result", message: { id: "a", content: '{"answer":1}' } });
    const entries = store.getSnapshot("response")!.entries;
    expect(entries.filter((entry) => entry.type === "function_call").map((entry) => entry.endedAt === undefined ? undefined : entry.endedAt - entry.startedAt)).toEqual([4, 2, undefined]);
    expect(entries.filter((entry) => entry.type === "tool_result").map((entry) => entry.content)).toEqual(["plain text", '{"answer":1}']);
  });

  it("keeps partial content after an error event and resets aggregation for another response", () => {
    const { store, receive, report } = recording();
    receive({ event: "streaming", message: { id: "a", content: "partial" } });
    receive({ event: "error", error: "offline" });
    receive({ event: "error", error: "offline" });
    expect(store.getSnapshot("response")?.entries.map((entry) => entry.type)).toEqual(["streaming", "error"]);
    report("another-response", { event: "streaming", message: { id: "a", content: "new" } }, 200);
    expect(store.getSnapshot("another-response")?.entries[0]?.content).toBe("new");
    expect(store.getSnapshot("response")?.entries[0]?.content).toBe("partial");
  });
});
