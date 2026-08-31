/** @vitest-environment jsdom */

import type { RunAgentInput } from "@ag-ui/client";
import { EventType } from "@ag-ui/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SocketAdapterAgent,
  WebSocketBackendTransport,
  type SocketDisconnectEvent,
} from "../../../src/chat/demo/adapters/socketAdapter";
import { AgUiAgentSource, SingleAgentRuntime } from "../../../src/core";

describe("WebSocketBackendTransport disconnects", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    FakeWebSocket.instances = [];
  });

  it("sends one cancel per run and retains the Socket for the next run", () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const agent = new SocketAdapterAgent(new WebSocketBackendTransport("ws://localhost/test"));
    const first = agent.run(runInput("first")).subscribe();
    const socket = FakeWebSocket.instances[0]!;
    socket.emitOpen();

    agent.abortRun();
    agent.abortRun();

    expect(first.closed).toBe(true);
    expect(socket.sent.map((payload) => JSON.parse(payload))).toEqual([
      { event: "run", input: runInput("first") },
      { event: "cancel", threadId: "thread", runId: "first" },
    ]);
    expect(socket.closeCalls).toEqual([]);

    const second = agent.run(runInput("second")).subscribe();
    agent.abortRun();
    agent.abortRun();

    expect(second.closed).toBe(true);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(JSON.parse(socket.sent.at(-1)!)).toEqual({
      event: "cancel", threadId: "thread", runId: "second",
    });
    expect(socket.sent).toHaveLength(4);
  });

  it("discards an unsent run when cancelled before the Socket opens", () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const agent = new SocketAdapterAgent(new WebSocketBackendTransport("ws://localhost/test"));
    agent.run(runInput("queued")).subscribe();
    const socket = FakeWebSocket.instances[0]!;

    agent.abortRun();
    socket.emitOpen();

    expect(socket.sent).toEqual([]);
    expect(socket.closeCalls).toEqual([]);
    const next = agent.run(runInput("next")).subscribe();
    expect(socket.sent.map((payload) => JSON.parse(payload))).toEqual([
      { event: "run", input: runInput("next") },
    ]);
    next.unsubscribe();
  });

  it.each(["completed", "error"])("does not cancel after a normal %s event", (event) => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const agent = new SocketAdapterAgent(new WebSocketBackendTransport("ws://localhost/test"));
    const subscription = agent.run(runInput("finished")).subscribe();
    const socket = FakeWebSocket.instances[0]!;
    socket.emitOpen();
    socket.emitMessage(JSON.stringify({ event }));

    agent.abortRun();

    expect(subscription.closed).toBe(true);
    expect(socket.sent).toHaveLength(1);
  });

  it("does not send cancellation on ordinary subscription teardown", () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const agent = new SocketAdapterAgent(new WebSocketBackendTransport("ws://localhost/test"));
    const subscription = agent.run(runInput("detached")).subscribe();
    const socket = FakeWebSocket.instances[0]!;
    socket.emitOpen();
    subscription.unsubscribe();
    agent.abortRun();
    expect(socket.sent).toHaveLength(1);
  });

  it("ignores tagged late messages from a cancelled run on the reused Socket", () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const agent = new SocketAdapterAgent(new WebSocketBackendTransport("ws://localhost/test"));
    agent.run(runInput("old")).subscribe();
    const socket = FakeWebSocket.instances[0]!;
    socket.emitOpen();
    agent.abortRun();
    const onNext = vi.fn();
    const next = agent.run(runInput("new")).subscribe(onNext);
    onNext.mockClear();

    socket.emitMessage(JSON.stringify({ event: "completed", runId: "old" }));
    socket.emitMessage(JSON.stringify({ event: "completed", runId: "new", threadId: "other" }));
    expect(onNext).not.toHaveBeenCalled();
    expect(next.closed).toBe(false);

    socket.emitMessage(JSON.stringify({ event: "completed", runId: "new", threadId: "thread" }));
    expect(next.closed).toBe(true);
    expect(onNext).toHaveBeenCalledWith(expect.objectContaining({ type: EventType.RUN_FINISHED }));
  });

  it("supports a backend-specific cancellation payload", () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const transport = new WebSocketBackendTransport("ws://localhost/test", {
      serializeCancel: (input) => JSON.stringify({ action: "stop", id: input.runId }),
    });
    const agent = new SocketAdapterAgent(transport);
    agent.run(runInput("custom")).subscribe();
    const socket = FakeWebSocket.instances[0]!;
    socket.emitOpen();
    agent.abortRun();
    expect(JSON.parse(socket.sent.at(-1)!)).toEqual({ action: "stop", id: "custom" });
  });

  it("stops locally and reports a failed cancellation through the subscription error channel", () => {
    const cancel = vi.fn(() => { throw new Error("cancel send failed"); });
    const disconnect = vi.fn();
    const agent = new SocketAdapterAgent({ run: () => disconnect, cancel });
    const onError = vi.fn();
    const subscription = agent.run(runInput("failed")).subscribe({ error: onError });

    agent.abortRun();
    agent.abortRun();

    expect(cancel).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(subscription.closed).toBe(true);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "cancel send failed" }));
  });

  it("cancels before asynchronous Agent initialization without starting a transport run", async () => {
    const run = vi.fn(() => vi.fn());
    const cancel = vi.fn();
    const agent = new SocketAdapterAgent({ run, cancel });
    let release!: () => void;
    const initialized = new Promise<void>((resolve) => { release = resolve; });
    const result = agent.runAgent({ runId: "initializing" }, {
      onRunInitialized: async () => { await initialized; },
    });

    agent.abortRun();
    agent.abortRun();
    release();
    await result;

    expect(run).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    expect(agent.isRunning).toBe(false);
  });

  it("coalesces both Runtime cancellation paths and settles the Agent without a success event", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const agent = new SocketAdapterAgent(new WebSocketBackendTransport("ws://localhost/test"));
    const onFinished = vi.fn();
    agent.subscribe({ onRunFinishedEvent: onFinished });
    const abort = vi.spyOn(agent, "abortRun");
    const runtime = new SingleAgentRuntime<string>({
      source: new AgUiAgentSource({ agent }),
      createInputMessage: (content, id) => ({ id, role: "user", content }),
    });
    try {
      const handle = await runtime.send("Question");
      await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
      const socket = FakeWebSocket.instances[0]!;
      socket.emitOpen();

      await runtime.cancel();
      await vi.waitFor(() => expect(agent.isRunning).toBe(false));

      expect(abort).toHaveBeenCalledTimes(2);
      const packets = socket.sent.map((payload) => JSON.parse(payload));
      expect(packets.filter((packet) => packet.event === "cancel")).toEqual([{
        event: "cancel",
        threadId: packets[0].input.threadId,
        runId: packets[0].input.runId,
      }]);
      expect(runtime.getSnapshot().branchesById[handle.branchIds[0]!]!.status).toBe("cancelled");
      expect(onFinished).not.toHaveBeenCalled();
      expect(socket.closeCalls).toEqual([]);

      const next = await runtime.send("Next question");
      await vi.waitFor(() => expect(socket.sent).toHaveLength(3));
      const nextInput = JSON.parse(socket.sent[2]!).input;
      socket.emitMessage(JSON.stringify({ event: "completed", runId: nextInput.runId }));
      await vi.waitFor(() => expect(runtime.getSnapshot().status).toBe("idle"));
      expect(runtime.getSnapshot().branchesById[next.branchIds[0]!]!.status).toBe("completed");
      expect(FakeWebSocket.instances).toHaveLength(1);
      expect(onFinished).toHaveBeenCalledOnce();
    } finally {
      await runtime.dispose();
    }
  });

  it("closes the underlying Socket and reports its close event once", () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const transport = new WebSocketBackendTransport("ws://localhost/test");
    const onError = vi.fn();
    const onDisconnected = vi.fn<(event: SocketDisconnectEvent) => void>();
    transport.onDisconnected = onDisconnected;
    transport.run({} as RunAgentInput, {
      onMessage: vi.fn(),
      onError,
    });
    const socket = FakeWebSocket.instances[0]!;

    transport.close();

    expect(socket.closeCalls).toEqual([
      { code: 4000, reason: "Manual socket disconnect" },
    ]);
    expect(onDisconnected).not.toHaveBeenCalled();

    socket.emitClose({
      code: 4000,
      reason: "Manual socket disconnect",
      wasClean: true,
    });
    socket.emitClose({
      code: 4000,
      reason: "Manual socket disconnect",
      wasClean: true,
    });

    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Manual socket disconnect" }),
    );
    expect(onDisconnected).toHaveBeenCalledOnce();
    expect(onDisconnected).toHaveBeenCalledWith({
      error: expect.objectContaining({
        message: "Manual socket disconnect",
      }),
      code: 4000,
      reason: "Manual socket disconnect",
      wasClean: true,
    });
  });

  it("coalesces the Socket error and following close callback", () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const transport = new WebSocketBackendTransport("ws://localhost/test");
    const onError = vi.fn();
    const onDisconnected = vi.fn<(event: SocketDisconnectEvent) => void>();
    transport.onDisconnected = onDisconnected;
    transport.run({} as RunAgentInput, {
      onMessage: vi.fn(),
      onError,
    });
    const socket = FakeWebSocket.instances[0]!;

    socket.emitError();
    socket.emitClose({ code: 1006, reason: "", wasClean: false });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onDisconnected).toHaveBeenCalledTimes(1);
    expect(socket.closeCalls).toEqual([{ code: undefined, reason: undefined }]);
  });

  it("ignores messages from a stale Socket after reconnecting", () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const transport = new WebSocketBackendTransport("ws://localhost/test");
    transport.run({} as RunAgentInput, {
      onMessage: vi.fn(),
      onError: vi.fn(),
    });
    const staleSocket = FakeWebSocket.instances[0]!;
    staleSocket.emitError();

    const onMessage = vi.fn();
    transport.run({} as RunAgentInput, {
      onMessage,
      onError: vi.fn(),
    });
    expect(FakeWebSocket.instances).toHaveLength(2);

    staleSocket.emitMessage('{"event":"completed"}');

    expect(onMessage).not.toHaveBeenCalled();
  });

  it("forwards disconnects to the optional Agent callback", () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const onDisconnected = vi.fn<(event: SocketDisconnectEvent) => void>();
    const agent = new SocketAdapterAgent(
      new WebSocketBackendTransport("ws://localhost/test"),
      { onDisconnected },
    );
    const subscription = agent.run({} as RunAgentInput).subscribe({
      error: () => undefined,
    });
    const socket = FakeWebSocket.instances[0]!;

    socket.emitClose({
      code: 1006,
      reason: "Backend connection lost",
      wasClean: false,
    });

    expect(onDisconnected).toHaveBeenCalledOnce();
    expect(onDisconnected).toHaveBeenCalledWith({
      error: expect.objectContaining({ message: "Backend connection lost" }),
      code: 1006,
      reason: "Backend connection lost",
      wasClean: false,
    });
    subscription.unsubscribe();
  });

  it("does not report an explicit Agent shutdown as a disconnect Error", () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const onDisconnected = vi.fn<(event: SocketDisconnectEvent) => void>();
    const agent = new SocketAdapterAgent(
      new WebSocketBackendTransport("ws://localhost/test"),
      { onDisconnected },
    );
    const subscription = agent.run({} as RunAgentInput).subscribe({
      error: () => undefined,
    });
    const socket = FakeWebSocket.instances[0]!;

    agent.close();
    socket.emitClose({
      code: 4000,
      reason: "Manual socket disconnect",
      wasClean: true,
    });

    expect(onDisconnected).not.toHaveBeenCalled();
    subscription.unsubscribe();
  });
});

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];
  readonly sent: string[] = [];

  readonly closeCalls: Array<{
    code: number | undefined;
    reason: string | undefined;
  }> = [];
  readyState = FakeWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose:
    | ((event: { code: number; reason: string; wasClean: boolean }) => void)
    | null = null;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(payload: string) { this.sent.push(payload); }

  emitOpen() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  close(code?: number, reason?: string) {
    this.closeCalls.push({ code, reason });
    this.readyState = FakeWebSocket.CLOSING;
  }

  emitError() {
    this.onerror?.();
  }

  emitMessage(data: unknown) {
    this.onmessage?.({ data });
  }

  emitClose(event: {
    code: number;
    reason: string;
    wasClean: boolean;
  }) {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.(event);
  }
}

function runInput(runId: string): RunAgentInput {
  return { threadId: "thread", runId, messages: [], tools: [], context: [], state: {}, forwardedProps: {} };
}
