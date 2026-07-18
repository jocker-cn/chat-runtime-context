/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import { createBeSingleRuntime } from "../../../src/chat/demo/demoRuntime";

describe("Socket Error demo control", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    FakeWebSocket.instances = [];
  });

  it("closes the Agent Socket and adds an AI Error from its callback", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const demo = createBeSingleRuntime();
    demo.queue.enqueue({ text: "connect" });
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const socket = FakeWebSocket.instances[0]!;
    socket.emitOpen();
    socket.emitMessage(JSON.stringify({ event: "completed" }));
    await vi.waitFor(() => expect(demo.runtime.getSnapshot().status).toBe("idle"));
    const turnCountBeforeClose = demo.runtime.getSnapshot().turnIds.length;

    demo.socket.closeWithError();
    expect(socket.closeCalls).toEqual([
      { code: 4000, reason: "Manual socket disconnect" },
    ]);
    socket.emitClose({
      code: 4000,
      reason: "Manual socket disconnect",
      wasClean: true,
    });

    await vi.waitFor(() =>
      expect(demo.runtime.getSnapshot().turnIds).toHaveLength(
        turnCountBeforeClose + 1,
      ),
    );
    const snapshot = demo.runtime.getSnapshot();
    const errorTurn = snapshot.turnsById[snapshot.turnIds.at(-1)!]!;
    const errorBranch = snapshot.branchesById[errorTurn.branchIds[0]!]!;
    expect(errorBranch.messageReader.getMessages()).toEqual([
      {
        id: expect.stringMatching(/^chat-assistant-error-/),
        role: "activity",
        activityType: "error",
        content: {
          message: "Socket disconnected. Send a new message to reconnect.",
          code: "SOCKET_DISCONNECTED",
          detail: "Manual socket disconnect",
          closeCode: 4000,
        },
      },
    ]);

    await demo.dispose();
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

  emitOpen() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
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
