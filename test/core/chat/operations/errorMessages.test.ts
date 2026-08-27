import type { Message } from "@ag-ui/client";
import { describe, expect, it, vi } from "vitest";
import {
  CompareChatRuntime,
  SingleAgentRuntime,
  addAssistantErrorMessage,
  addUserErrorMessage,
  clearErrorMessagesBeforeSend,
  clearTransientMessages,
  createMessageStore,
  removeAssistantErrorResponse,
  removeUserErrorMessage,
  type AnswerSource,
  type ChatRuntime,
} from "../../../../src/core";

type ErrorMessage = Message & {
  status?: string;
};

describe("Error Message operations", () => {
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
    await runtime.sendLocalMessage(
      {
        id: "user-error",
        role: "user",
        content: "User Error",
        status: " Error ",
      },
      { placement: "input" },
    );
    await runtime.sendLocalMessage({
      id: "assistant-error",
      role: "activity",
      activityType: "ERROR",
      content: { message: "Assistant Error" },
    });

    await clearErrorMessagesBeforeSend(runtime);
    await clearErrorMessagesBeforeSend(runtime);

    expect(runtime.getSnapshot().turnIds).toHaveLength(1);
    expect(controlled.messageStore.getMessages()).toEqual([notice]);

    await runtime.dispose();
  });

  it("removes the complete AI response when its final message is Error", async () => {
    const input = userMessage("input", "Question");
    const reasoning: ErrorMessage = {
      id: "reasoning",
      role: "reasoning",
      content: "Thinking",
    };
    const tool: ErrorMessage = {
      id: "tool",
      role: "tool",
      toolCallId: "call-1",
      content: "Tool result",
    };
    const errorOne = activityMessage("error-1", " Error ");
    const errorTwo = activityMessage("error-2", "ERROR");
    const { controlled, runtime } = createHistoryRuntime([
      input,
      reasoning,
      tool,
      errorOne,
      errorTwo,
    ]);
    const turnId = runtime.getSnapshot().turnIds[0]!;

    await removeAssistantErrorResponse(runtime);

    expect(controlled.messageStore.getMessages()).toEqual([input]);
    const snapshot = runtime.getSnapshot();
    const turn = snapshot.turnsById[turnId]!;
    const branch = snapshot.branchesById[turn.branchIds[0]!]!;
    expect(snapshot.turnIds).toEqual([turnId]);
    expect(turn.inputMessage).toBe(input);
    expect(branch.messageReader.getMessages()).toEqual([]);

    await runtime.dispose();
  });

  it("prunes a Turn after removing both its User Error and Error response", async () => {
    const input: ErrorMessage = {
      ...userMessage("input-error", "Failed question"),
      status: " ERROR ",
    };
    const reasoning: ErrorMessage = {
      id: "reasoning",
      role: "reasoning",
      content: "Thinking",
    };
    const tool: ErrorMessage = {
      id: "tool",
      role: "tool",
      toolCallId: "call-1",
      content: "Tool result",
    };
    const error = activityMessage("error", "Error");
    const { controlled, runtime } = createHistoryRuntime([
      input,
      reasoning,
      tool,
      error,
    ]);

    await clearErrorMessagesBeforeSend(runtime);

    expect(runtime.getSnapshot().turnIds).toEqual([]);
    expect(controlled.messageStore.getMessages()).toEqual([]);

    await runtime.dispose();
  });

  it("keeps a non-tail AI Error even when the selector makes it look final", async () => {
    const input = userMessage("input", "Question");
    const error = activityMessage("error", "ERROR");
    const answer: ErrorMessage = {
      id: "answer",
      role: "assistant",
      content: "Recovered answer",
    };
    const controlled = createControlledSource("single");
    controlled.messageStore.setMessages([input, error, answer]);
    const source: AnswerSource<string, ErrorMessage> = {
      ...controlled.source,
      selectMessages: (messages) =>
        messages.filter((message) => message.role === "activity"),
    };
    const runtime = new SingleAgentRuntime<string, ErrorMessage>({
      source,
      historyMessages: [input, error, answer],
      createInputMessage: (value, turnId) => ({
        id: `${turnId}:input`,
        role: "user",
        content: value,
      }),
    });

    const snapshot = runtime.getSnapshot();
    const turn = snapshot.turnsById[snapshot.turnIds[0]!]!;
    expect(
      snapshot.branchesById[turn.branchIds[0]!]!.messageReader.getMessages(),
    ).toEqual([error]);

    await removeAssistantErrorResponse(runtime);

    expect(controlled.messageStore.getMessages()).toEqual([
      input,
      error,
      answer,
    ]);

    await runtime.dispose();
  });

  it("removes the complete AI response while preserving its User input", async () => {
    const input = userMessage("input", "Question");
    const reasoning: ErrorMessage = {
      id: "reasoning",
      role: "reasoning",
      content: "Thinking",
    };
    const tool: ErrorMessage = {
      id: "tool",
      role: "tool",
      toolCallId: "call-1",
      content: "Tool result",
    };
    const error = activityMessage("error", "Error");
    const { controlled, runtime } = createHistoryRuntime([
      input,
      reasoning,
      tool,
      error,
    ]);
    const turnId = runtime.getSnapshot().turnIds[0]!;

    const branchId = runtime.getSnapshot().turnsById[turnId]!.branchIds[0]!;
    await runtime.removeBranchResponse(turnId, branchId);

    expect(controlled.messageStore.getMessages()).toEqual([input]);
    const snapshot = runtime.getSnapshot();
    const turn = snapshot.turnsById[turnId]!;
    const branch = snapshot.branchesById[turn.branchIds[0]!]!;
    expect(snapshot.turnIds).toEqual([turnId]);
    expect(turn.inputMessage).toBe(input);
    expect(branch.messageReader.getMessages()).toEqual([]);

    await runtime.dispose();
  });

  it("keeps the frozen Branch snapshot when Source deletion fails", async () => {
    const input = userMessage("input", "Question");
    const error = activityMessage("error", "ERROR");
    const controlled = createControlledSource("single");
    controlled.messageStore.setMessages([input, error]);
    controlled.source.deleteMessages = () => {
      throw new Error("delete failed");
    };
    const runtime = new SingleAgentRuntime<string, ErrorMessage>({
      source: controlled.source,
      historyMessages: [input, error],
      createInputMessage: (value, turnId) => ({
        id: `${turnId}:input`,
        role: "user",
        content: value,
      }),
    });
    const snapshot = runtime.getSnapshot();
    const turn = snapshot.turnsById[snapshot.turnIds[0]!]!;
    const branch = snapshot.branchesById[turn.branchIds[0]!]!;

    await expect(
      removeAssistantErrorResponse(runtime),
    ).rejects.toThrow("delete failed");

    expect(controlled.messageStore.getMessages()).toEqual([input, error]);
    expect(branch.messageReader.getMessages()).toEqual([error]);

    await runtime.dispose();
  });

  it("uses the raw Source tail when the selector hides the final Error", async () => {
    const reasoning: ErrorMessage = {
      id: "visible-reasoning",
      role: "reasoning",
      content: "Visible reasoning",
    };
    const error = activityMessage("hidden-error", "ERROR");
    const controlled = createControlledSource("single");
    controlled.messageStore.setMessages([reasoning, error]);
    const source: AnswerSource<string, ErrorMessage> = {
      ...controlled.source,
      selectMessages: (messages) =>
        messages.filter((message) => message.role === "reasoning"),
    };
    const runtime = new CompareChatRuntime<string, ErrorMessage>({
      sources: [{ branchId: "main", source }],
      historyTurns: [
        {
          id: "ai-only-turn",
          messageIds: [reasoning.id, error.id],
        },
      ],
      createInputMessage: (value, turnId) => ({
        id: `${turnId}:input`,
        role: "user",
        content: value,
      }),
    });

    const before = runtime.getSnapshot();
    const turn = before.turnsById["ai-only-turn"]!;
    expect(
      before.branchesById[turn.branchIds[0]!]!.messageReader.getMessages(),
    ).toEqual([reasoning]);

    await removeAssistantErrorResponse(runtime);

    const snapshot = runtime.getSnapshot();
    expect(snapshot.turnIds).toEqual([]);
    expect(controlled.messageStore.getMessages()).toEqual([]);

    await runtime.dispose();
  });

  it("removes only the User Error input and preserves hidden response messages", async () => {
    const input: ErrorMessage = {
      ...userMessage("user-error", "Failed question"),
      status: "ERROR",
    };
    const reasoning: ErrorMessage = {
      id: "hidden-reasoning",
      role: "reasoning",
      content: "Keep hidden reasoning",
    };
    const controlled = createControlledSource("single");
    controlled.messageStore.setMessages([input, reasoning]);
    const source: AnswerSource<string, ErrorMessage> = {
      ...controlled.source,
      selectMessages: (messages) =>
        messages.filter((message) => message.role === "activity"),
    };
    const runtime = new CompareChatRuntime<string, ErrorMessage>({
      sources: [{ branchId: "main", source }],
      historyTurns: [
        {
          id: "user-error-turn",
          inputMessage: input,
          inputMessageId: input.id,
          messageIds: [reasoning.id],
        },
      ],
      createInputMessage: (value, turnId) => ({
        id: `${turnId}:input`,
        role: "user",
        content: value,
      }),
    });

    await removeUserErrorMessage(runtime);

    expect(runtime.getSnapshot().turnIds).toEqual(["user-error-turn"]);
    expect(controlled.messageStore.getMessages()).toEqual([reasoning]);
    expect(
      runtime.getSnapshot().turnsById["user-error-turn"]?.inputMessage,
    ).toBeUndefined();

    await runtime.dispose();
  });

  it("resolves a User Error inputMessageId from the bound Source reader", async () => {
    const input: ErrorMessage = {
      ...userMessage("history-user-error", "Failed history question"),
      status: " Error ",
    };
    const controlled = createControlledSource("single");
    controlled.messageStore.setMessages([input]);
    const runtime = new CompareChatRuntime<string, ErrorMessage>({
      sources: [{ branchId: "main", source: controlled.source }],
      historyTurns: [
        {
          id: "history-user-error-turn",
          inputMessageId: input.id,
          messageIds: [],
        },
      ],
      createInputMessage: (value, turnId) => ({
        id: `${turnId}:input`,
        role: "user",
        content: value,
      }),
    });

    expect(
      runtime.getSnapshot().turnsById["history-user-error-turn"]?.inputMessage,
    ).toBe(input);

    await removeUserErrorMessage(runtime, "history-user-error-turn");

    expect(runtime.getSnapshot().turnIds).toEqual([]);
    expect(controlled.messageStore.getMessages()).toEqual([]);

    await runtime.dispose();
  });

  it("removes an internal MessageStore response without Source deletion support", async () => {
    const reasoning: ErrorMessage = {
      id: "reasoning",
      role: "reasoning",
      content: "Thinking",
    };
    const error = activityMessage("error", "ERROR");
    const source: AnswerSource<string, ErrorMessage> = {
      id: "event-source",
      async *run() {
        yield { type: "messages", messages: [reasoning, error] };
        yield { type: "branch-completed" };
      },
    };
    const runtime = new SingleAgentRuntime<string, ErrorMessage>({
      source,
      createInputMessage: (value, turnId) => ({
        id: `${turnId}:input`,
        role: "user",
        content: value,
      }),
    });
    const handle = await runtime.send("Question");
    await vi.waitFor(() => expect(runtime.getSnapshot().status).toBe("idle"));

    const branchId = runtime.getSnapshot().turnsById[handle.turnId]!.branchIds[0]!;
    await runtime.removeBranchResponse(handle.turnId, branchId);

    const snapshot = runtime.getSnapshot();
    const turn = snapshot.turnsById[handle.turnId]!;
    const branch = snapshot.branchesById[turn.branchIds[0]!]!;
    expect(turn.inputMessage?.role).toBe("user");
    expect(branch.messageReader.getMessages()).toEqual([]);

    await runtime.dispose();
  });

  it("requires a Runtime branchId when removing from a Compare Turn", async () => {
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
    const handle = await runtime.send("Question");

    await expect(
      removeAssistantErrorResponse(runtime, {
        turnId: handle.turnId,
      }),
    ).rejects.toThrow("requires branchId");

    await runtime.dispose();
  });

  it("clears complete Error responses across the Branches of the last Compare Turn", async () => {
    const reasoning: ErrorMessage = {
      id: "branch-a-reasoning",
      role: "reasoning",
      content: "Keep reasoning",
    };
    const branchError = activityMessage("branch-a-error", "ERROR");
    const branchAnswer: ErrorMessage = {
      id: "branch-b-answer",
      role: "assistant",
      content: "Keep answer",
    };
    const sourceA = createControlledSource("source-a", [
      reasoning,
      branchError,
    ]);
    const sourceB = createControlledSource("source-b", [branchAnswer]);
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

    await runtime.send("Question");
    await vi.waitFor(() => expect(runtime.getSnapshot().status).toBe("idle"));
    await clearErrorMessagesBeforeSend(runtime);

    expect(sourceA.messageStore.getMessages()).toEqual([]);
    expect(sourceB.messageStore.getMessages()).toEqual([branchAnswer]);
    expect(runtime.getSnapshot().turnIds).toHaveLength(1);

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

  it("supports a custom User cleanup type without adding a new operation", async () => {
    const warning: ErrorMessage = {
      ...userMessage("user-warning", "Temporary warning"),
      status: " Warning ",
    };
    const { controlled, runtime } = createHistoryRuntime([warning]);

    await clearTransientMessages(runtime, {
      shouldRemoveInput: (message) =>
        message.role === "user" &&
        message.status?.trim()?.toLowerCase() === "warning",
    });

    expect(runtime.getSnapshot().turnIds).toEqual([]);
    expect(controlled.messageStore.getMessages()).toEqual([]);

    await runtime.dispose();
  });

  it("removes a complete custom AI response by inspecting only its tail marker", async () => {
    const input = userMessage("input", "Question");
    const reasoning: ErrorMessage = {
      id: "reasoning",
      role: "reasoning",
      content: "Thinking",
    };
    const tool: ErrorMessage = {
      id: "tool",
      role: "tool",
      toolCallId: "call-1",
      content: "Tool output",
    };
    const transient = activityMessage("temporary-notice", " Temporary ");
    const { controlled, runtime } = createHistoryRuntime([
      input,
      reasoning,
      tool,
      transient,
    ]);
    const turnId = runtime.getSnapshot().turnIds[0]!;

    await clearTransientMessages(runtime, {
      shouldRemoveResponse: (message, context) =>
        context.turnId === turnId &&
        message.role === "activity" &&
        message.activityType?.trim()?.toLowerCase() === "temporary",
    });

    const snapshot = runtime.getSnapshot();
    expect(snapshot.turnIds).toEqual([turnId]);
    expect(snapshot.turnsById[turnId]?.inputMessage).toBe(input);
    expect(controlled.messageStore.getMessages()).toEqual([input]);

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

function createHistoryRuntime(messages: readonly ErrorMessage[]) {
  const controlled = createControlledSource("single");
  controlled.messageStore.setMessages(messages);
  const runtime = new SingleAgentRuntime<string, ErrorMessage>({
    source: controlled.source,
    historyMessages: messages,
    createInputMessage: (input, turnId) => ({
      id: `${turnId}:input`,
      role: "user",
      content: input,
    }),
  });

  return { controlled, runtime };
}

function createControlledSource(
  id: string,
  runMessages: readonly ErrorMessage[] = [],
) {
  const messageStore = createMessageStore<ErrorMessage>();
  const source: AnswerSource<string, ErrorMessage> = {
    id,
    messageReader: messageStore,
    async *run() {
      runMessages.forEach((message) => {
        messageStore.appendMessage(message);
      });
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

function userMessage(id: string, content: string): ErrorMessage {
  return {
    id,
    role: "user",
    content,
  };
}

function activityMessage(id: string, activityType: string): ErrorMessage {
  return {
    id,
    role: "activity",
    activityType,
    content: { message: id },
  };
}
