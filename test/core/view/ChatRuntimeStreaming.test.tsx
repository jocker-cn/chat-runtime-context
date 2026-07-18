/** @vitest-environment jsdom */

import type { Message } from "@ag-ui/client";
import { useEffect } from "react";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ChatRuntimeView,
  SingleAgentRuntime,
  createFrameRenderer,
  type AnswerSource,
  type ChatSourceRunContext,
  type FrameCardProps,
  type MessageReader,
} from "../../../src/core";

describe("ChatRuntimeView streaming isolation", () => {
  let animationFrames: ControlledAnimationFrames;

  beforeEach(() => {
    animationFrames = new ControlledAnimationFrames();
    vi.stubGlobal(
      "requestAnimationFrame",
      animationFrames.requestAnimationFrame,
    );
    vi.stubGlobal(
      "cancelAnimationFrame",
      animationFrames.cancelAnimationFrame,
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("updates only the live tail while keeping historical cards mounted", async () => {
    const historyMessages = [
      createMessage("history-input", "user", "Previous question"),
      createMessage("history-answer", "assistant", "Previous answer"),
    ];
    const reader = new CloningMessageReader(historyMessages);
    const source = new ControlledStreamingSource(reader);
    const metrics = createCardMetrics();

    function TrackedCard({ message }: FrameCardProps<Message>) {
      metrics.incrementRender(message.id);

      useEffect(() => {
        metrics.incrementMount(message.id);
        return () => metrics.incrementUnmount(message.id);
      }, []);

      useEffect(() => {
        metrics.incrementMessageEffect(message.id);
      }, [message]);

      return (
        <article data-testid={`card-${message.id}`}>
          {typeof message.content === "string" ? message.content : ""}
        </article>
      );
    }

    const renderer = createFrameRenderer<Message>({
      cards: {
        assistant: TrackedCard,
      },
      fallback: TrackedCard,
    });
    const runtime = new SingleAgentRuntime<string, Message>({
      source,
      historyMessages,
      createInputMessage: (content) =>
        createMessage("current-input", "user", content),
    });

    render(<ChatRuntimeView runtime={runtime} renderer={renderer} />);

    expect(screen.getByTestId("card-history-answer").textContent).toBe(
      "Previous answer",
    );
    expect(metrics.getRenders("history-answer")).toBe(1);
    expect(metrics.getMounts("history-answer")).toBe(1);
    expect(metrics.getMessageEffects("history-answer")).toBe(1);

    await act(async () => {
      await runtime.send("Current question");
    });
    await waitFor(() => {
      const activeTurnId = runtime.getSnapshot().activeTurnId;
      const activeBranch = activeTurnId
        ? runtime.getSnapshot().branchesById[`${activeTurnId}:main`]
        : undefined;
      expect(activeBranch?.status).toBe("running");
    });

    await publishAndFlush(
      reader,
      animationFrames,
      historyMessages,
      "A",
    );

    expect(screen.getByTestId("card-current-prefix").textContent).toBe(
      "Committed current step",
    );
    expect(screen.getByTestId("card-streaming-answer").textContent).toBe("A");

    const historyRenderCount = metrics.getRenders("history-answer");
    const historyMountCount = metrics.getMounts("history-answer");
    const historyEffectCount = metrics.getMessageEffects("history-answer");
    const prefixRenderCount = metrics.getRenders("current-prefix");
    const prefixMountCount = metrics.getMounts("current-prefix");
    const prefixEffectCount = metrics.getMessageEffects("current-prefix");
    const liveRenderCount = metrics.getRenders("streaming-answer");

    await act(async () => {
      reader.publish(createStreamingMessages(historyMessages, "AB"));
      reader.publish(createStreamingMessages(historyMessages, "ABC"));
      reader.publish(
        createStreamingMessages(historyMessages, "ABC final response"),
      );
      animationFrames.flush();
      await Promise.resolve();
    });

    expect(metrics.getRenders("history-answer")).toBe(historyRenderCount);
    expect(metrics.getMounts("history-answer")).toBe(historyMountCount);
    expect(metrics.getMessageEffects("history-answer")).toBe(
      historyEffectCount,
    );
    expect(metrics.getRenders("current-prefix")).toBe(prefixRenderCount);
    expect(metrics.getMounts("current-prefix")).toBe(prefixMountCount);
    expect(metrics.getMessageEffects("current-prefix")).toBe(
      prefixEffectCount,
    );
    expect(metrics.getRenders("streaming-answer")).toBe(
      liveRenderCount + 1,
    );
    expect(screen.getByTestId("card-streaming-answer").textContent).toBe(
      "ABC final response",
    );

    await act(async () => {
      source.complete();
      await source.completed;
    });
    await waitFor(() => expect(runtime.getSnapshot().status).toBe("idle"));
    await act(async () => {
      animationFrames.flush();
      await Promise.resolve();
    });

    expect(screen.getByTestId("card-streaming-answer").textContent).toBe(
      "ABC final response",
    );
    expect(metrics.getRenders("history-answer")).toBe(historyRenderCount);
    expect(metrics.getMounts("history-answer")).toBe(historyMountCount);
    expect(metrics.getUnmounts("history-answer")).toBe(0);
    expect(metrics.getMessageEffects("history-answer")).toBe(
      historyEffectCount,
    );
    expect(metrics.getMounts("current-prefix")).toBe(prefixMountCount);
    expect(metrics.getUnmounts("current-prefix")).toBe(0);
    expect(metrics.getMessageEffects("current-prefix")).toBe(
      prefixEffectCount,
    );

    await runtime.dispose();
  });
});

async function publishAndFlush(
  reader: CloningMessageReader,
  animationFrames: ControlledAnimationFrames,
  historyMessages: readonly Message[],
  content: string,
) {
  await act(async () => {
    reader.publish(createStreamingMessages(historyMessages, content));
    animationFrames.flush();
    await Promise.resolve();
  });
}

function createStreamingMessages(
  historyMessages: readonly Message[],
  content: string,
) {
  return [
    ...historyMessages,
    createMessage("current-prefix", "assistant", "Committed current step"),
    createMessage("streaming-answer", "assistant", content),
  ];
}

function createMessage(
  id: string,
  role: Message["role"],
  content: string,
): Message {
  return { id, role, content } as Message;
}

class CloningMessageReader implements MessageReader<Message> {
  private readonly listeners = new Set<() => void>();
  private messages: readonly Message[];

  constructor(initialMessages: readonly Message[]) {
    this.messages = cloneMessages(initialMessages);
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getMessages = () => this.messages;

  publish(messages: readonly Message[]) {
    this.messages = cloneMessages(messages);
    [...this.listeners].forEach((listener) => listener());
  }
}

class ControlledStreamingSource implements AnswerSource<string, Message> {
  readonly id = "controlled-stream";
  readonly completed: Promise<void>;
  readonly messageReader: MessageReader<Message>;
  private resolveCompletion!: () => void;

  constructor(messageReader: MessageReader<Message>) {
    this.messageReader = messageReader;
    this.completed = new Promise((resolve) => {
      this.resolveCompletion = resolve;
    });
  }

  async *run(_input: string, _context: ChatSourceRunContext) {
    yield { type: "branch-started" as const };
    await this.completed;
    yield { type: "branch-completed" as const };
  }

  complete() {
    this.resolveCompletion();
  }
}

class ControlledAnimationFrames {
  private callbacks = new Map<number, FrameRequestCallback>();
  private nextId = 1;

  requestAnimationFrame = (callback: FrameRequestCallback) => {
    const id = this.nextId++;
    this.callbacks.set(id, callback);
    return id;
  };

  cancelAnimationFrame = (id: number) => {
    this.callbacks.delete(id);
  };

  flush() {
    const callbacks = [...this.callbacks.values()];
    this.callbacks.clear();
    callbacks.forEach((callback) => callback(performance.now()));
  }
}

function cloneMessages(messages: readonly Message[]): readonly Message[] {
  return messages.map((message) => ({ ...message }) as Message);
}

function createCardMetrics() {
  const renders = new Map<string, number>();
  const mounts = new Map<string, number>();
  const unmounts = new Map<string, number>();
  const messageEffects = new Map<string, number>();
  const increment = (target: Map<string, number>, id: string) => {
    target.set(id, (target.get(id) ?? 0) + 1);
  };

  return {
    incrementRender: (id: string) => increment(renders, id),
    incrementMount: (id: string) => increment(mounts, id),
    incrementUnmount: (id: string) => increment(unmounts, id),
    incrementMessageEffect: (id: string) => increment(messageEffects, id),
    getRenders: (id: string) => renders.get(id) ?? 0,
    getMounts: (id: string) => mounts.get(id) ?? 0,
    getUnmounts: (id: string) => unmounts.get(id) ?? 0,
    getMessageEffects: (id: string) => messageEffects.get(id) ?? 0,
  };
}
