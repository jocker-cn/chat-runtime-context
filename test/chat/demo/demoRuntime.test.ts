import { describe, expect, it, vi } from "vitest";
import type { DemoMessage } from "../../../src/chat/demo/demoMessage";
import { createDemoRuntimeController } from "../../../src/chat/demo/demoRuntime";
import {
  CompareChatRuntime,
  SingleAgentRuntime,
  addAssistantErrorMessage,
  createMessageStore,
  type AnswerSource,
} from "../../../src/core";

describe("DemoRuntimeController error messages", () => {
  it("removes User and AI Error Turns before dispatching the next message", async () => {
    const messageStore = createMessageStore<DemoMessage>();
    const inputs: string[] = [];
    const source: AnswerSource<string, DemoMessage> = {
      id: "controlled",
      messageReader: messageStore,
      async *run(input, context) {
        inputs.push(input);
        if (context.inputMessage) {
          messageStore.appendMessage(context.inputMessage as DemoMessage);
        }
        yield { type: "branch-completed" };
      },
      addLocalMessage(message) {
        messageStore.appendMessage(message);
      },
      deleteMessages(messageIds) {
        const deletedIds = new Set(messageIds);
        messageStore.setMessages(
          messageStore
            .getMessages()
            .filter((message) => !deletedIds.has(message.id)),
        );
      },
    };
    let turnSequence = 0;
    const runtime = new SingleAgentRuntime<string, DemoMessage>({
      source,
      createTurnId: () => `turn-${++turnSequence}`,
      createInputMessage: (input, turnId) => ({
        id: `${turnId}:input`,
        role: "user",
        content: input,
      }),
    });
    const controller = createDemoRuntimeController(runtime);

    const notice: DemoMessage = {
      id: "local-notice",
      role: "activity",
      activityType: "notice",
      content: { message: "Keep this local message." },
    };
    await runtime.sendLocalMessage(notice);
    await controller.addUserError();
    await addAssistantErrorMessage(
      runtime,
      {
        id: "direct-ai-error",
        content: { message: "Disconnected." },
      },
    );

    expect(runtime.getSnapshot().turnIds).toHaveLength(3);
    expect(messageStore.getMessages()).toHaveLength(3);
    expect(messageStore.getMessages()[1]).toMatchObject({
      id: expect.stringMatching(/^chat-user-error-/),
      role: "user",
      content: "This message could not be sent.",
      status: "error",
    });
    expect(messageStore.getMessages()[2]).toEqual({
      id: "direct-ai-error",
      role: "activity",
      activityType: "error",
      content: { message: "Disconnected." },
    });
    const queued = controller.queue.enqueue({ text: "next message" });

    await vi.waitFor(() => expect(inputs).toEqual(["next message"]));
    await vi.waitFor(() =>
      expect(runtime.getSnapshot().status).toBe("idle"),
    );

    expect(controller.queue.has(queued.id)).toBe(false);
    expect(runtime.getSnapshot().turnIds).toEqual(["turn-1", "turn-4"]);
    expect(messageStore.getMessages()).toEqual([
      notice,
      {
        id: "turn-4:input",
        role: "user",
        content: "next message",
      },
    ]);

    await controller.dispose();
  });

  it("targets the Source branch that reports an error in Compare mode", async () => {
    const sourceA = createControlledSource("source-a");
    const sourceB = createControlledSource("source-b");
    let turnSequence = 0;
    const runtime = new CompareChatRuntime<string, DemoMessage>({
      sources: [
        { branchId: "branch-a", source: sourceA.source },
        { branchId: "branch-b", source: sourceB.source },
      ],
      createTurnId: () => `compare-${++turnSequence}`,
      createInputMessage: (input, turnId) => ({
        id: `${turnId}:input`,
        role: "user",
        content: input,
      }),
    });
    const controller = createDemoRuntimeController(runtime);

    await controller.addAiError("branch-b");

    const errorTurn = runtime.getSnapshot().turnsById["compare-1"];
    expect(errorTurn.branchIds).toEqual(["compare-1:branch-b"]);
    expect(sourceA.messageStore.getMessages()).toEqual([]);
    expect(sourceB.messageStore.getMessages()).toEqual([
      {
        id: expect.stringMatching(/^chat-assistant-error-/),
        role: "activity",
        activityType: "error",
        content: {
          message: "The connection was interrupted. Please try again.",
        },
      },
    ]);

    controller.queue.enqueue({ text: "next comparison" });

    await vi.waitFor(() =>
      expect(sourceA.inputs).toEqual(["next comparison"]),
    );
    await vi.waitFor(() =>
      expect(sourceB.inputs).toEqual(["next comparison"]),
    );
    await vi.waitFor(() =>
      expect(runtime.getSnapshot().status).toBe("idle"),
    );

    expect(runtime.getSnapshot().turnIds).toEqual(["compare-2"]);
    expect(sourceA.messageStore.getMessages()).toEqual([
      {
        id: "compare-2:input",
        role: "user",
        content: "next comparison",
      },
    ]);
    expect(sourceB.messageStore.getMessages()).toEqual([
      {
        id: "compare-2:input",
        role: "user",
        content: "next comparison",
      },
    ]);

    await controller.dispose();
  });
});

function createControlledSource(id: string) {
  const messageStore = createMessageStore<DemoMessage>();
  const inputs: string[] = [];
  const source: AnswerSource<string, DemoMessage> = {
    id,
    messageReader: messageStore,
    async *run(input, context) {
      inputs.push(input);
      if (context.inputMessage) {
        messageStore.appendMessage(context.inputMessage as DemoMessage);
      }
      yield { type: "branch-completed" };
    },
    addLocalMessage(message) {
      messageStore.appendMessage(message);
    },
    deleteMessages(messageIds) {
      const deletedIds = new Set(messageIds);
      messageStore.setMessages(
        messageStore
          .getMessages()
          .filter((message) => !deletedIds.has(message.id)),
      );
    },
  };

  return { source, messageStore, inputs };
}
