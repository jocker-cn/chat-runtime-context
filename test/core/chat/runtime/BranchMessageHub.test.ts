import type { Message } from "@ag-ui/client";
import { describe, expect, it, vi } from "vitest";
import type { MessageReader } from "../../../../src/core/chat/contracts/chat-runtime";
import {
  BranchMessageHub,
  type BranchMessageHubFrameClock,
} from "../../../../src/core/chat/runtime/BranchMessageHub";

type TestMessage = Extract<Message, { role: "assistant" }> & {
  content: string;
};

describe("BranchMessageHub streaming notifications", () => {
  it("coalesces a synchronous burst and exposes the final source snapshot", () => {
    const source = new ManualMessageReader<TestMessage>();
    const frames = new ManualFrameScheduler();
    const hub = createHub(source, frames);
    const scope = createTrackingScope(hub);
    const listener = vi.fn();
    scope.subscribe(listener);

    for (let index = 0; index < 1_000; index += 1) {
      source.publish([assistantMessage("active", `token-${index}`)]);
    }

    expect(listener).not.toHaveBeenCalled();
    expect(frames.pendingCount).toBe(1);

    frames.flushNext();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(scope.getMessages()).toHaveLength(1);
    expect(scope.getMessages()[0]?.content).toBe("token-999");
    expect(frames.pendingCount).toBe(0);

    hub.dispose();
  });

  it("uses an asynchronous timer frame outside the browser", () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", undefined);
    const source = new ManualMessageReader<TestMessage>();
    const hub = new BranchMessageHub(source);
    const scope = createTrackingScope(hub);
    const listener = vi.fn();
    scope.subscribe(listener);

    try {
      source.publish([assistantMessage("active", "complete")]);

      expect(listener).not.toHaveBeenCalled();
      vi.advanceTimersByTime(16);

      expect(listener).toHaveBeenCalledTimes(1);
      expect(scope.getMessages()[0]?.content).toBe("complete");
    } finally {
      hub.dispose();
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it("publishes an in-place mutation with a new active message reference", () => {
    const message = assistantMessage("active", "partial");
    const source = new ManualMessageReader<TestMessage>();
    const frames = new ManualFrameScheduler();
    const hub = createHub(source, frames);
    const scope = createTrackingScope(hub);
    const listener = vi.fn();
    scope.subscribe(listener);

    source.publish([message]);
    frames.flushNext();
    listener.mockClear();
    const previousSnapshot = scope.getMessages();
    const previousMessage = previousSnapshot[0];

    message.content = "complete";
    source.publishSameMessages();
    frames.flushNext();

    const nextSnapshot = scope.getMessages();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(nextSnapshot).not.toBe(previousSnapshot);
    expect(nextSnapshot[0]).not.toBe(previousMessage);
    expect(nextSnapshot[0]?.content).toBe("complete");
    expect(previousMessage?.content).toBe("partial");

    hub.dispose();
  });

  it("keeps nested tool-call data stable across in-place mutations", () => {
    const message = {
      id: "active",
      role: "assistant",
      content: "",
      toolCalls: [
        {
          id: "call-1",
          type: "function",
          function: {
            name: "lookup",
            arguments: '{"city":"Par"}',
          },
        },
      ],
    } satisfies TestMessage;
    const source = new ManualMessageReader<TestMessage>();
    const frames = new ManualFrameScheduler();
    const hub = createHub(source, frames);
    const scope = createTrackingScope(hub);
    scope.subscribe(vi.fn());

    source.publish([message]);
    frames.flushNext();
    const previousSnapshot = scope.getMessages();

    message.toolCalls[0].function.arguments = '{"city":"Paris"}';
    source.publishSameMessages();
    frames.flushNext();

    const nextSnapshot = scope.getMessages();
    expect(nextSnapshot[0]?.toolCalls?.[0]?.function.arguments).toBe(
      '{"city":"Paris"}',
    );
    expect(previousSnapshot[0]?.toolCalls?.[0]?.function.arguments).toBe(
      '{"city":"Par"}',
    );
    expect(nextSnapshot[0]?.toolCalls?.[0]?.function).not.toBe(
      previousSnapshot[0]?.toolCalls?.[0]?.function,
    );

    hub.dispose();
  });

  it("does not notify when the live message content is unchanged", () => {
    const source = new ManualMessageReader<TestMessage>();
    const frames = new ManualFrameScheduler();
    const hub = createHub(source, frames);
    const scope = createTrackingScope(hub);
    const listener = vi.fn();
    scope.subscribe(listener);

    source.publish([assistantMessage("active", "same")]);
    frames.flushNext();
    listener.mockClear();
    const snapshot = scope.getMessages();

    source.publishSameMessages();
    frames.flushNext();

    expect(scope.getMessages()).toBe(snapshot);
    expect(listener).not.toHaveBeenCalled();
    expect(frames.pendingCount).toBe(0);

    hub.dispose();
  });

  it("tracks the latest source message when a selector changes order", () => {
    const fixed = assistantMessage("fixed", "fixed");
    const active = assistantMessage("active", "partial");
    const source = new ManualMessageReader<TestMessage>();
    const frames = new ManualFrameScheduler();
    const hub = createHub(source, frames);
    const scope = hub.createScope({
      id: "branch",
      context: {
        threadId: "thread",
        turnId: "turn",
        branchId: "branch",
      },
      selector: (messages) => [...messages].reverse(),
      trackNewMessages: true,
    });
    scope.subscribe(vi.fn());

    source.publish([fixed, active]);
    frames.flushNext();
    const firstSnapshot = scope.getMessages();

    active.content = "complete";
    source.publishSameMessages();
    frames.flushNext();
    const secondSnapshot = scope.getMessages();

    expect(secondSnapshot[0]?.id).toBe("active");
    expect(secondSnapshot[0]?.content).toBe("complete");
    expect(secondSnapshot[0]).not.toBe(firstSnapshot[0]);
    expect(secondSnapshot[1]).toBe(firstSnapshot[1]);

    hub.dispose();
  });

  it("tracks the latest selected message when a selector filters the source tail", () => {
    const active = assistantMessage("active", "partial");
    const excluded = assistantMessage("excluded", "other branch");
    const source = new ManualMessageReader<TestMessage>();
    const frames = new ManualFrameScheduler();
    const hub = createHub(source, frames);
    const scope = hub.createScope({
      id: "branch",
      context: {
        threadId: "thread",
        turnId: "turn",
        branchId: "branch",
      },
      selector: (messages) =>
        messages.filter((message) => message.id === active.id),
      trackNewMessages: true,
    });
    scope.subscribe(vi.fn());

    source.publish([active, excluded]);
    frames.flushNext();
    const firstSnapshot = scope.getMessages();

    active.content = "complete";
    source.publishSameMessages();
    frames.flushNext();
    const secondSnapshot = scope.getMessages();

    expect(secondSnapshot).toHaveLength(1);
    expect(secondSnapshot[0]?.content).toBe("complete");
    expect(secondSnapshot[0]).not.toBe(firstSnapshot[0]);

    hub.dispose();
  });

  it("keeps historical projections stable when the source clones all messages", () => {
    const source = new ManualMessageReader<TestMessage>();
    const frames = new ManualFrameScheduler();
    const hub = createHub(source, frames);
    const scope = createTrackingScope(hub);
    scope.subscribe(vi.fn());

    source.publish([
      assistantMessage("history", "fixed"),
      assistantMessage("answer", "partial"),
    ]);
    frames.flushNext();
    const firstSnapshot = scope.getMessages();

    source.publish([
      assistantMessage("history", "fixed"),
      assistantMessage("answer", "complete"),
      assistantMessage("next", "n"),
    ]);
    frames.flushNext();
    const secondSnapshot = scope.getMessages();

    expect(secondSnapshot[0]).toBe(firstSnapshot[0]);
    expect(secondSnapshot[1]).not.toBe(firstSnapshot[1]);
    expect(secondSnapshot[1]?.content).toBe("complete");

    source.publish([
      assistantMessage("history", "fixed"),
      assistantMessage("answer", "complete"),
      assistantMessage("next", "next token"),
    ]);
    frames.flushNext();
    const thirdSnapshot = scope.getMessages();

    expect(thirdSnapshot[0]).toBe(secondSnapshot[0]);
    expect(thirdSnapshot[1]).toBe(secondSnapshot[1]);
    expect(thirdSnapshot[2]).not.toBe(secondSnapshot[2]);
    expect(thirdSnapshot[2]?.content).toBe("next token");

    hub.dispose();
  });

  it("cancels pending work and never notifies after dispose", () => {
    const source = new ManualMessageReader<TestMessage>();
    const frames = new ManualFrameScheduler();
    const hub = createHub(source, frames);
    const scope = createTrackingScope(hub);
    const listener = vi.fn();
    scope.subscribe(listener);

    source.publish([assistantMessage("active", "pending")]);
    const scheduledFrame = frames.latestFrame;
    expect(scheduledFrame).toBeDefined();

    hub.dispose();

    expect(source.listenerCount).toBe(0);
    expect(scheduledFrame?.cancelled).toBe(true);
    expect(frames.pendingCount).toBe(0);

    scheduledFrame?.callback();
    source.publish([assistantMessage("active", "late")]);

    expect(listener).not.toHaveBeenCalled();
    expect(frames.pendingCount).toBe(0);
  });

  it("commits the terminal source value before stopTracking returns", () => {
    const message = assistantMessage("active", "partial");
    const source = new ManualMessageReader<TestMessage>();
    const frames = new ManualFrameScheduler();
    const hub = createHub(source, frames);
    const scope = createTrackingScope(hub);
    const listener = vi.fn();
    scope.subscribe(listener);

    source.publish([message]);
    frames.flushNext();
    listener.mockClear();

    message.content = "terminal";
    source.publishSameMessages();
    scope.stopTracking();

    expect(scope.getMessages()[0]?.content).toBe("terminal");
    expect(listener).not.toHaveBeenCalled();
    expect(frames.pendingCount).toBe(1);

    frames.flushNext();

    expect(listener).toHaveBeenCalledTimes(1);

    const terminalSnapshot = scope.getMessages();
    source.publish([assistantMessage("active", "late")]);
    frames.flushNext();

    expect(scope.getMessages()).toBe(terminalSnapshot);
    expect(listener).toHaveBeenCalledTimes(1);

    hub.dispose();
  });

  it("commits a non-tail correction before stopTracking returns", () => {
    const prefix = assistantMessage("prefix", "draft");
    const active = assistantMessage("active", "partial");
    const source = new ManualMessageReader<TestMessage>();
    const frames = new ManualFrameScheduler();
    const hub = createHub(source, frames);
    const scope = createTrackingScope(hub);
    scope.subscribe(vi.fn());

    source.publish([prefix, active]);
    frames.flushNext();

    prefix.content = "corrected terminal value";
    source.publishSameMessages();
    scope.stopTracking();

    expect(scope.getMessages()[0]?.content).toBe(
      "corrected terminal value",
    );

    hub.dispose();
  });

  it("does not publish a new live snapshot when stopTracking has no source update", () => {
    const source = new ManualMessageReader<TestMessage>();
    const frames = new ManualFrameScheduler();
    const hub = createHub(source, frames);
    const scope = createTrackingScope(hub);
    const listener = vi.fn();
    scope.subscribe(listener);

    source.publish([assistantMessage("active", "complete")]);
    frames.flushNext();
    listener.mockClear();
    const snapshot = scope.getMessages();

    scope.stopTracking();

    expect(scope.getMessages()).toBe(snapshot);
    expect(listener).not.toHaveBeenCalled();
    expect(frames.pendingCount).toBe(0);

    hub.dispose();
  });

  it("materializes the initial snapshot and keeps a no-op stop stable", () => {
    const message = assistantMessage("existing", "initial");
    const source = new ManualMessageReader<TestMessage>();
    source.publish([message]);
    const frames = new ManualFrameScheduler();
    const hub = createHub(source, frames);
    const scope = hub.createScope({
      id: "branch",
      context: {
        threadId: "thread",
        turnId: "turn",
        branchId: "branch",
      },
      messageIds: [message.id],
      trackNewMessages: true,
    });
    const listener = vi.fn();
    scope.subscribe(listener);
    const snapshot = scope.getMessages();

    expect(snapshot[0]).not.toBe(message);
    message.content = "mutated outside the snapshot";
    expect(scope.getMessages()[0]?.content).toBe("initial");

    message.content = "initial";
    scope.stopTracking();

    expect(scope.getMessages()).toBe(snapshot);
    expect(listener).not.toHaveBeenCalled();
    expect(frames.pendingCount).toBe(0);

    hub.dispose();
  });

  it("ignores repeated callbacks from the same scheduled frame", () => {
    const source = new ManualMessageReader<TestMessage>();
    const frames = new ManualFrameScheduler();
    const hub = createHub(source, frames);
    const scope = createTrackingScope(hub);
    const listener = vi.fn();
    scope.subscribe(listener);

    source.publish([assistantMessage("active", "complete")]);
    const scheduledFrame = frames.latestFrame;
    expect(scheduledFrame).toBeDefined();

    scheduledFrame?.callback();
    scheduledFrame?.callback();

    expect(listener).toHaveBeenCalledTimes(1);

    hub.dispose();
  });

  it("rejects scopes created after dispose", () => {
    const source = new ManualMessageReader<TestMessage>();
    const frames = new ManualFrameScheduler();
    const hub = createHub(source, frames);

    hub.dispose();

    expect(() => createTrackingScope(hub)).toThrow(
      "Cannot create a scope on a disposed BranchMessageHub.",
    );
  });

  it("defers listener-triggered source changes to a later frame", () => {
    const source = new ManualMessageReader<TestMessage>();
    const frames = new ManualFrameScheduler();
    const hub = createHub(source, frames);
    const scope = createTrackingScope(hub);
    let calls = 0;
    let depth = 0;
    let maximumDepth = 0;

    scope.subscribe(() => {
      calls += 1;
      depth += 1;
      maximumDepth = Math.max(maximumDepth, depth);

      if (calls === 1) {
        source.publish([assistantMessage("active", "second frame")]);
      }

      depth -= 1;
    });

    source.publish([assistantMessage("active", "first frame")]);
    frames.flushNext();

    expect(calls).toBe(1);
    expect(maximumDepth).toBe(1);
    expect(frames.pendingCount).toBe(1);

    frames.flushNext();

    expect(calls).toBe(2);
    expect(maximumDepth).toBe(1);
    expect(scope.getMessages()[0]?.content).toBe("second frame");
    expect(frames.pendingCount).toBe(0);

    hub.dispose();
  });
});

function createHub<TMessage extends Message>(
  source: MessageReader<TMessage>,
  frames: ManualFrameScheduler,
) {
  return new BranchMessageHub(source, {
    scheduleFrame: frames.schedule,
  });
}

function createTrackingScope<TMessage extends Message>(
  hub: BranchMessageHub<TMessage>,
) {
  return hub.createScope({
    id: "branch",
    context: {
      threadId: "thread",
      turnId: "turn",
      branchId: "branch",
    },
    trackNewMessages: true,
  });
}

function assistantMessage(id: string, content: string): TestMessage {
  return {
    id,
    role: "assistant",
    content,
  } as TestMessage;
}

class ManualMessageReader<TMessage extends Message>
  implements MessageReader<TMessage>
{
  private messages: readonly TMessage[] = [];
  private readonly listeners = new Set<() => void>();

  get listenerCount() {
    return this.listeners.size;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getMessages = () => this.messages;

  publish(messages: readonly TMessage[]) {
    this.messages = messages;
    this.notify();
  }

  publishSameMessages() {
    this.notify();
  }

  private notify() {
    [...this.listeners].forEach((listener) => {
      if (this.listeners.has(listener)) {
        listener();
      }
    });
  }
}

interface ManualFrame {
  callback: () => void;
  cancelled: boolean;
  completed: boolean;
}

class ManualFrameScheduler {
  private readonly frames: ManualFrame[] = [];

  get pendingCount() {
    return this.frames.filter(
      (frame) => !frame.cancelled && !frame.completed,
    ).length;
  }

  get latestFrame() {
    return this.frames.at(-1);
  }

  schedule: BranchMessageHubFrameClock = (callback) => {
    const frame: ManualFrame = {
      callback,
      cancelled: false,
      completed: false,
    };
    this.frames.push(frame);

    return () => {
      frame.cancelled = true;
    };
  };

  flushNext() {
    const frame = this.frames.find(
      (candidate) => !candidate.cancelled && !candidate.completed,
    );
    if (!frame) {
      throw new Error("No frame is scheduled.");
    }

    frame.completed = true;
    frame.callback();
  }
}
