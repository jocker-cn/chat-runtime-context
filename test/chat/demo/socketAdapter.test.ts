/** @vitest-environment jsdom */

import type { RunAgentInput } from "@ag-ui/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SocketAdapterAgent,
  WebSocketBackendTransport,
  type SocketDisconnectEvent,
} from "../../../src/chat/demo/adapters/socketAdapter";

describe("WebSocketBackendTransport disconnects", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    FakeWebSocket.instances = [];
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

  send(_payload: string) {}

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
