/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addAssistantErrorMessage } from "../../../src/core";
import { FakeSocket } from "./backendSocketMock";
import { createExtensionPocRuntime, type ExtensionPocRuntimeController } from "../../../src/chat/demo/extension-poc/extensionPocRuntime";
import {createInitialChatHistory} from "../../../src/chat/demo/extension-poc/chatHistory";

const controllers: ExtensionPocRuntimeController[] = [];
beforeEach(() => vi.stubGlobal("WebSocket", FakeSocket));
afterEach(async () => {
  await Promise.allSettled(controllers.splice(0).map((controller) => controller.dispose()));
  vi.unstubAllGlobals();
  FakeSocket.instances = [];
});

async function startChat() {
  const controller = createExtensionPocRuntime();
  controllers.push(controller);
  const handle = await controller.runtime.send("Question");
  await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(2));
  const [a, b] = FakeSocket.instances;
  a!.open(); b!.open();
  return { controller, handle, a: a!, b: b! };
}

describe("extension-poc branch errors", () => {
  it.each(["backend", "disconnect", "parse"])("owns %s failures in A's original branch without stopping B", async (failure) => {
    const { controller, handle, a, b } = await startChat();
    a.message({ event: "thinking_delta", message: { content: "Working on rollback." } });
    a.message({ event: "streaming_started", message: { id: "partial-a" } });
    a.message({ event: "streaming", message: { id: "partial-a", content: "Partial answer" } });
    if (failure === "backend") a.message({ event: "error", error: "Insufficient Balance" });
    if (failure === "disconnect") { a.onerror?.(); a.end(); }
    if (failure === "parse") a.onmessage?.({ data: "not-json" });
    await vi.waitFor(() => expect(controller.runtime.getSnapshot().branchesById[handle.branchIds[0]!]!.status).toBe("error"));
    const snapshot = controller.runtime.getSnapshot();
    const messages = snapshot.branchesById[handle.branchIds[0]!]!.messageReader.getMessages();
    expect(snapshot.turnIds).toEqual([handle.turnId]);
    expect(snapshot.branchesById[handle.branchIds[1]!]!.status).toBe("running");
    expect(messages).toContainEqual(expect.objectContaining({ id: "partial-a", content: "Partial answer" }));
    const errors = messages.filter((message) => message.role === "activity" && message.activityType === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ content: { phase: "error", thinkingText: "Working on rollback." } });
    expect(messages.some((message) => message.role === "activity" && message.activityType === "thinking")).toBe(false);
    b.message({ event: "completed" });
    await vi.waitFor(() => expect(controller.runtime.getSnapshot().status).toBe("error"));
    expect(controller.runtime.getSnapshot().branchesById[handle.branchIds[1]!]!.status).toBe("completed");
    expect(controller.runtime.getSnapshot().turnIds).toHaveLength(1);
  });

  it("replaces Processing with error before any response arrives", async () => {
    const { controller, handle, a, b } = await startChat();
    a.message({ event: "error", error: "Unavailable" });
    b.message({ event: "completed" });
    await vi.waitFor(() => expect(controller.runtime.getSnapshot().status).toBe("error"));
    expect(controller.runtime.getSnapshot().branchesById[handle.branchIds[0]!]!.messageReader.getMessages()).toEqual([
      expect.objectContaining({ role: "activity", activityType: "error", content: { message: "Unavailable", phase: "error", thinkingText: "" } }),
    ]);
  });

  it("defers external errors until both agents settle and preserves the old standalone error API", async () => {
    const { controller, handle, a, b } = await startChat();
    const first = controller.submitBranchError(handle.branchIds[0]!, { content: { message: "External A error" } });
    const second = controller.submitBranchError(handle.branchIds[1]!, { content: { message: "External B error" } });
    a.message({ event: "completed" });
    await vi.waitFor(() => expect(controller.runtime.getSnapshot().branchesById[handle.branchIds[0]!]!.status).toBe("completed"));
    expect(controller.runtime.getSnapshot().turnIds).toHaveLength(1);
    b.message({ event: "completed" });
    await Promise.all([first, second]);
    const snapshot = controller.runtime.getSnapshot();
    expect(snapshot.turnIds).toHaveLength(3);
    for (const [index, sourceId] of ["agent-a", "agent-b"].entries()) {
      const turn = snapshot.turnsById[snapshot.turnIds[index + 1]!]!;
      expect(turn.inputMessage).toBeUndefined();
      expect(turn.branchIds).toHaveLength(1);
      const branch = snapshot.branchesById[turn.branchIds[0]!]!;
      expect(branch.sourceId).toBe(sourceId);
      expect(branch.messageReader.getMessages()).toEqual([
        expect.objectContaining({ activityType: "error", content: { message: `External ${index === 0 ? "A" : "B"} error` } }),
      ]);
    }
    expect(a.sent).toHaveLength(1);
    expect(b.sent).toHaveLength(1);
    await addAssistantErrorMessage(controller.runtime, { content: { message: "Standalone error" } }, "agent-a");
    expect(controller.runtime.getSnapshot().turnIds).toHaveLength(4);
  });

  it("rejects unknown targets and cancels pending submissions when disposed", async () => {
    const { controller, handle } = await startChat();
    await expect(controller.submitBranchError("unknown", { content: { message: "No" } })).rejects.toThrow("Unknown Agent branch");
    const pending = controller.submitBranchError(handle.branchIds[0]!, { content: { message: "Late" } });
    const rejection = expect(pending).rejects.toThrow("cancelled");
    await controller.dispose();
    await rejection;
  });

  it("does not turn user cancellation into error messages", async () => {
    const { controller, handle } = await startChat();
    await controller.runtime.cancel();
    for (const id of handle.branchIds) {
      const branch = controller.runtime.getSnapshot().branchesById[id]!;
      expect(branch.status).toBe("cancelled");
      expect(branch.messageReader.getMessages().some((message) => message.role === "activity" && message.activityType === "error")).toBe(false);
      const ref = controller.resolveResponseTrace({ turnId: handle.turnId, branchId: id })!;
      await vi.waitFor(() => expect(controller.responseTraces.getSnapshot(ref).status).toBe("ready"));
      expect(controller.responseTraces.getSnapshot(ref).record?.outcome).toBe("cancelled");
    }
  });
});

describe("extension-poc session runtime", () => {
  it("records original events outside message filtering and resolves each branch's own finalized trace", async () => {
    const { controller, handle, a, b } = await startChat();
    a.message({ event: "thinking_started", message: { id: "think-a" } });
    a.message({ event: "thinking_delta", message: { id: "think-a", content: "Before tool" } });
    a.message({ event: "thinking_completed", message: { id: "think-a" } });
    a.message({ event: "function_call", message: { id: "call-a", name: "sum", arguments: { numbers: [1, 2] } } });
    a.message({ event: "tool_result", message: { id: "call-a", content: '{"sum":3,"extra":{"preserved":true}}' } });
    a.message({ event: "messages_snapshot", messages: [] });
    a.message({ event: "streaming_started", message: { id: "final-a" } });
    a.message({ event: "streaming", message: { id: "final-a", content: "Three" } });
    const context = { turnId: handle.turnId, branchId: handle.branchIds[0]! };
    await vi.waitFor(() => expect(controller.resolveResponseTrace(context)).toBeDefined());
    const ref = controller.resolveResponseTrace(context)!;
    expect(controller.responseTraces.getSnapshot(ref).record).toBeUndefined();
    a.message({ event: "streaming_completed", message: { id: "final-a" } });
    a.message({ event: "completed" });
    await vi.waitFor(() => expect(controller.responseTraces.getSnapshot(ref).status).toBe("ready"));
    const record = controller.responseTraces.getSnapshot(ref).record!;
    expect(record.entries.find((entry) => entry.event === "thinking")?.content).toBe("Before tool");
    expect(record.entries.find((entry) => entry.event === "tool_result")?.content).toContain('"preserved":true');
    const messages = controller.runtime.getSnapshot().branchesById[context.branchId]!.messageReader.getMessages();
    expect(messages.some((message) => message.role === "tool")).toBe(false);
    expect(record.entries.filter((entry) => entry.event === "tool_result")).toHaveLength(1);
    expect(record.outcome).toBe("completed");
    const refB = controller.resolveResponseTrace({ turnId: handle.turnId, branchId: handle.branchIds[1]! })!;
    expect(refB.sourceId).toBe("agent-b");
    expect(controller.responseTraces.getSnapshot(refB).status).toBe("recording");
    b.message({ event: "completed" });
    await vi.waitFor(() => expect(controller.responseTraces.getSnapshot(refB).status).toBe("ready"));
    expect(controller.responseTraces.getSnapshot(refB).record?.entries.some((entry) => entry.event === "function_call")).toBe(false);
  });

  it("restores A's history and initializes both mock agents with the full transcript", async () => {
    const history = createInitialChatHistory();
    const controller = createExtensionPocRuntime({history});
    controllers.push(controller);
    const snapshot = controller.runtime.getSnapshot();
    expect(snapshot.turnIds).toHaveLength(2);
    expect(Object.values(snapshot.branchesById).map((branch) => branch.sourceId)).toEqual(["agent-a", "agent-a"]);
    await controller.runtime.send("Continue");
    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(2));
    for (const socket of FakeSocket.instances) socket.open();
    await vi.waitFor(() => expect(FakeSocket.instances.every((socket) => socket.sent.length === 1)).toBe(true));
    for (const socket of FakeSocket.instances) {
      const request = JSON.parse(socket.sent[0]!);
      expect(request.input.messages.slice(0, history.length)).toEqual(history);
      socket.message({event: "completed"});
    }
  });

  it("changes the next dispatch's sources without cancelling an active B or rebuilding sockets", async () => {
    const { controller, handle, a, b } = await startChat();
    controller.setSecondaryAgentEnabled(false);
    expect(controller.runtime.getSnapshot().branchesById[handle.branchIds[1]!]!.status).toBe("running");
    a.message({ event: "completed" });
    b.message({ event: "completed" });
    await vi.waitFor(() => expect(controller.runtime.getSnapshot().status).not.toBe("running"));

    controller.queue.enqueue({ text: "Only A", referencedMessageId: "original-answer" });
    await vi.waitFor(() => expect(a.sent).toHaveLength(2));
    expect(b.sent).toHaveLength(1);
    const snapshot = controller.runtime.getSnapshot();
    const turn = snapshot.turnsById[snapshot.turnIds.at(-1)!]!;
    expect(turn.inputMessage).toMatchObject({ content: "Only A", referencedMessageId: "original-answer" });
    expect(turn.branchIds.map((id) => snapshot.branchesById[id]!.sourceId)).toEqual(["agent-a"]);
    a.message({ event: "completed" });
    await vi.waitFor(() => expect(controller.runtime.getSnapshot().status).not.toBe("running"));

    controller.setSecondaryAgentEnabled(true);
    controller.queue.enqueue({ text: "Both again" });
    await vi.waitFor(() => expect(b.sent).toHaveLength(2));
    expect(a.sent).toHaveLength(3);
    expect(FakeSocket.instances).toHaveLength(2);
    a.message({ event: "completed" });
    b.message({ event: "completed" });
  });

});

