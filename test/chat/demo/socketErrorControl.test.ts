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

  it("sends Add to Chat references through AG-UI context", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const demo = createBeSingleRuntime({ threadId: "reference-thread" });
    const contextReferences = [{
      id: "reference-1",
      type: "text-selection" as const,
      text: "Selected release risk",
      source: {
        type: "chat-frame",
        turnId: "turn-1",
        branchId: "agent-single",
        frameId: "frame-1",
      },
    }];

    demo.queue.enqueue({
      text: "Summarize this",
      contextReferences,
    });
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const socket = FakeWebSocket.instances[0]!;
    socket.emitOpen();

    await vi.waitFor(() => expect(socket.sentPayloads).toHaveLength(1));
    const payload = JSON.parse(socket.sentPayloads[0]!) as {
      input: {
        context: Array<{ description: string; value: string }>;
      };
    };
    expect(payload.input.context).toEqual([{
      description: "addToChatReferences",
      value: JSON.stringify(contextReferences),
    }]);

    socket.emitMessage(JSON.stringify({ event: "completed" }));
    await vi.waitFor(() => expect(demo.runtime.getSnapshot().status).toBe("idle"));
    const inputMessage = demo.runtime.getSnapshot()
      .turnsById[demo.runtime.getSnapshot().turnIds.at(-1)!]?.inputMessage;
    expect(inputMessage?.contextReferences).toEqual(contextReferences);
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
  readonly sentPayloads: string[] = [];
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

  send(payload: string) {
    this.sentPayloads.push(payload);
  }

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
