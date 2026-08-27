import { describe, expect, it, vi } from "vitest";
import type { DemoMessage } from "../../../src/chat/demo/demoMessage";
import {
  DEMO_RETRY_USER_ERROR_PRIORITY,
  createBeSingleRuntime,
  createDemoRuntimeController,
} from "../../../src/chat/demo/demoRuntime";
import {
  CompareChatRuntime,
  SingleAgentRuntime,
  addAssistantErrorMessage,
  addUserErrorMessage,
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
          code: "DEMO_AI_ERROR_WITH_CONTEXT",
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

  it("creates a Reasoning, Tool and AI Error response for cleanup controls", async () => {
    const controller = createBeSingleRuntime({
      websocketUrl: "ws://localhost:1/demo-error-scenario",
      threadId: "demo-error-scenario",
    });

    await controller.addAiError();

    const addedSnapshot = controller.runtime.getSnapshot();
    const addedTurnId = addedSnapshot.turnIds.at(-1)!;
    const addedTurn = addedSnapshot.turnsById[addedTurnId]!;
    const branchId = addedTurn.branchIds[0]!;
    expect(
      addedSnapshot.branchesById[branchId]!.messageReader
        .getMessages()
        .map((message) => message.role),
    ).toEqual(["reasoning", "tool", "activity"]);

    await controller.removeAiError();

    expect(controller.runtime.getSnapshot().turnsById[addedTurnId]).toBeUndefined();

    await controller.addAiError();
    const nextSnapshot = controller.runtime.getSnapshot();
    const nextTurnId = nextSnapshot.turnIds.at(-1)!;

    await controller.removeAiResponse();

    expect(
      controller.runtime.getSnapshot().turnsById[nextTurnId],
    ).toBeUndefined();
    await controller.dispose();
  });

  it("clears all tail Errors and retries the selected User Error first", async () => {
    const controlled = createControlledSource("controlled");
    let turnSequence = 0;
    const runtime = new SingleAgentRuntime<string, DemoMessage>({
      source: controlled.source,
      createTurnId: () => `retry-${++turnSequence}`,
      createInputMessage: (input, turnId) => ({
        id: `${turnId}:input`,
        role: "user",
        content: input,
      }),
    });
    const controller = createDemoRuntimeController(runtime);

    await controller.addUserError();
    await controller.clearErrors();
    expect(runtime.getSnapshot().turnIds).toEqual([]);

    await addUserErrorMessage(runtime, "Retry this message.");
    await addUserErrorMessage(runtime, "Newer failed message.");
    const retryMessage = runtime.getSnapshot().turnsById["retry-2"]
      ?.inputMessage;
    expect(retryMessage).toBeDefined();

    controller.scheduler.pause();
    const ordinary = controller.queue.enqueue({ text: "Already queued" });
    controller.retryUserError(retryMessage!);

    const retry = controller.queue
      .list()
      .find((item) => item.id !== ordinary.id);
    expect(retry?.priority).toBe(DEMO_RETRY_USER_ERROR_PRIORITY);
    expect(retry!.priority).toBeGreaterThan(ordinary.priority);

    controller.scheduler.resume();

    await vi.waitFor(() =>
      expect(controlled.inputs).toEqual([
        "Retry this message.",
        "Already queued",
      ]),
    );
    await vi.waitFor(() => expect(runtime.getSnapshot().status).toBe("idle"));

    const snapshot = runtime.getSnapshot();
    expect(snapshot.turnIds).toEqual(["retry-4", "retry-5"]);
    expect(snapshot.turnsById["retry-4"]?.inputMessage).toMatchObject({
      role: "user",
      content: "Retry this message.",
    });
    expect(snapshot.turnsById["retry-4"]?.inputMessage).not.toHaveProperty(
      "status",
    );

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
