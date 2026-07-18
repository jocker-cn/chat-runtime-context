import type { Message } from "@ag-ui/client";
import { describe, expect, it } from "vitest";
import {
  CompareChatRuntime,
  SingleAgentRuntime,
  addAssistantErrorMessage,
  addErrorMessage,
  addUserErrorMessage,
  clearErrorMessagesBeforeSend,
  createMessageStore,
  type AnswerSource,
  type ChatRuntime,
} from "../../../../src/core";

type ErrorMessage = Message & {
  status?: "error";
};

describe("Error Message operations", () => {
  it("normalizes a complete Error Message and rejects unsupported roles", async () => {
    const controlled = createControlledSource("single");
    const runtime = createSingleRuntime(controlled.source);

    await addErrorMessage(runtime, {
      id: "activity-error",
      role: "activity",
      activityType: "notice",
      content: { message: "Normalize me." },
    });
    await expect(
      addErrorMessage(runtime, {
        id: "assistant-error",
        role: "assistant",
        content: "Unsupported role.",
      }),
    ).rejects.toThrow("requires a User or Activity message");

    expect(controlled.messageStore.getMessages()).toEqual([
      {
        id: "activity-error",
        role: "activity",
        activityType: "error",
        content: { message: "Normalize me." },
      },
    ]);
    expect(runtime.getSnapshot().turnIds).toHaveLength(1);

    await runtime.dispose();
  });

  it("fills User and Assistant Error fields while preserving supplied content and IDs", async () => {
    const controlled = createControlledSource("single");
    const runtime = createSingleRuntime(controlled.source);
    const runtimeContract: ChatRuntime<string, ErrorMessage> = runtime;

    await addUserErrorMessage(
      runtimeContract,
      "The message could not be sent.",
    );
    await addAssistantErrorMessage(runtime, {
      content: {
        content: "The connection was interrupted.",
        code: "SOCKET_CLOSED",
      },
    });
    await addAssistantErrorMessage(runtime, {
      id: "provided-error-id",
      content: { message: "Use this ID." },
    });

    const messages = controlled.messageStore.getMessages();
    expect(messages).toEqual([
      {
        id: expect.stringMatching(/^chat-user-error-/),
        role: "user",
        content: "The message could not be sent.",
        status: "error",
      },
      {
        id: expect.stringMatching(/^chat-assistant-error-/),
        role: "activity",
        activityType: "error",
        content: {
          content: "The connection was interrupted.",
          code: "SOCKET_CLOSED",
        },
      },
      {
        id: "provided-error-id",
        role: "activity",
        activityType: "error",
        content: { message: "Use this ID." },
      },
    ]);

    const snapshot = runtime.getSnapshot();
    const userTurn = snapshot.turnsById[snapshot.turnIds[0]!]!;
    expect(userTurn.inputMessage).toBe(messages[0]);

    await runtime.dispose();
  });

  it("requires and respects an explicit Source branch in Compare mode", async () => {
    const sourceA = createControlledSource("source-a");
    const sourceB = createControlledSource("source-b");
    const runtime = new CompareChatRuntime<string, ErrorMessage>({
      sources: [
        { branchId: "branch-a", source: sourceA.source },
        { branchId: "branch-b", source: sourceB.source },
      ],
      createInputMessage: (input, turnId) => ({
        id: `${turnId}:input`,
        role: "user",
        content: input,
      }),
    });

    await expect(
      addAssistantErrorMessage(runtime, "Missing branch."),
    ).rejects.toThrow("requires branchId");
    expect(runtime.getSnapshot().turnIds).toEqual([]);

    await addAssistantErrorMessage(runtime, "Branch B failed.", "branch-b");

    expect(sourceA.messageStore.getMessages()).toEqual([]);
    expect(sourceB.messageStore.getMessages()).toEqual([
      {
        id: expect.stringMatching(/^chat-assistant-error-/),
        role: "activity",
        activityType: "error",
        content: { message: "Branch B failed." },
      },
    ]);
    expect(runtime.getSnapshot().turnIds).toHaveLength(1);

    await runtime.dispose();
  });

  it("removes consecutive trailing Error Turns and their Source messages", async () => {
    const controlled = createControlledSource("single");
    const runtime = createSingleRuntime(controlled.source);
    const notice: ErrorMessage = {
      id: "persistent-notice",
      role: "activity",
      activityType: "notice",
      content: { message: "Keep this message." },
    };

    await runtime.sendLocalMessage(notice);
    await addUserErrorMessage(runtime, "User Error");
    await addAssistantErrorMessage(runtime, "Assistant Error");

    await clearErrorMessagesBeforeSend(runtime);
    await clearErrorMessagesBeforeSend(runtime);

    expect(runtime.getSnapshot().turnIds).toHaveLength(1);
    expect(controlled.messageStore.getMessages()).toEqual([notice]);

    await runtime.dispose();
  });

  it("does not remove an older Error Turn across a normal tail Turn", async () => {
    const controlled = createControlledSource("single");
    const runtime = createSingleRuntime(controlled.source);
    const notice: ErrorMessage = {
      id: "normal-tail",
      role: "activity",
      activityType: "notice",
      content: { message: "Normal tail." },
    };

    await addAssistantErrorMessage(runtime, "Older Error");
    await runtime.sendLocalMessage(notice);
    await clearErrorMessagesBeforeSend(runtime);

    expect(runtime.getSnapshot().turnIds).toHaveLength(2);
    expect(controlled.messageStore.getMessages()).toHaveLength(2);

    await runtime.dispose();
  });
});

function createSingleRuntime(source: AnswerSource<string, ErrorMessage>) {
  let turnSequence = 0;
  return new SingleAgentRuntime<string, ErrorMessage>({
    source,
    createTurnId: () => `turn-${++turnSequence}`,
    createInputMessage: (input, turnId) => ({
      id: `${turnId}:input`,
      role: "user",
      content: input,
    }),
  });
}

function createControlledSource(id: string) {
  const messageStore = createMessageStore<ErrorMessage>();
  const source: AnswerSource<string, ErrorMessage> = {
    id,
    messageReader: messageStore,
    async *run() {
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

  return { source, messageStore };
}
