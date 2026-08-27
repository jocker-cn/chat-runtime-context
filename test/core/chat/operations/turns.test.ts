import type { Message } from "@ag-ui/client";
import { describe, expect, it, vi } from "vitest";
import {
  CompareChatRuntime,
  SingleAgentRuntime,
  createMessageStore,
  removeLastTurn,
  type AnswerSource,
} from "../../../../src/core";

type TestMessage = Message;

describe("Turn operations", () => {
  it("removes only the last settled Turn and its Source messages", async () => {
    const messages: TestMessage[] = [
      userMessage("user-1", "First"),
      assistantMessage("answer-1", "First answer"),
      userMessage("user-2", "Second"),
      assistantMessage("answer-2", "Second answer"),
    ];
    const controlled = createHistorySource(messages);
    const runtime = createHistoryRuntime(controlled.source, messages);

    await removeLastTurn(runtime);

    expect(runtime.getSnapshot().turnIds).toHaveLength(1);
    expect(controlled.messageStore.getMessages()).toEqual(messages.slice(0, 2));

    await runtime.dispose();
  });

  it("removes the Turn input while preserving its complete AI response", async () => {
    const input = userMessage("user", "Question");
    const answer = assistantMessage("answer", "Answer");
    const messages = [input, answer];
    const controlled = createHistorySource(messages);
    const runtime = createHistoryRuntime(controlled.source, messages);
    const snapshot = runtime.getSnapshot();
    const turnId = snapshot.turnIds[0]!;
    const branchId = snapshot.turnsById[turnId]!.branchIds[0]!;

    await runtime.removeTurnInput(turnId);

    const nextSnapshot = runtime.getSnapshot();
    expect(nextSnapshot.turnIds).toEqual([turnId]);
    expect(nextSnapshot.turnsById[turnId]?.inputMessage).toBeUndefined();
    expect(nextSnapshot.turnsById[turnId]?.inputMessageId).toBeUndefined();
    expect(nextSnapshot.branchesById[branchId]?.anchorMessageId).toBeUndefined();
    expect(
      nextSnapshot.branchesById[branchId]?.messageReader.getMessages(),
    ).toEqual([answer]);
    expect(controlled.messageStore.getMessages()).toEqual([answer]);

    await runtime.dispose();
  });

  it("removes a shared input from every Source in Compare mode", async () => {
    const sourceA = createLiveSource("source-a");
    const sourceB = createLiveSource("source-b");
    const runtime = new CompareChatRuntime<string, TestMessage>({
      sources: [
        { branchId: "branch-a", source: sourceA.source },
        { branchId: "branch-b", source: sourceB.source },
      ],
      createInputMessage: (input, turnId) =>
        userMessage(`${turnId}:input`, input),
    });

    const handle = await runtime.send("Question");
    await vi.waitFor(() => expect(runtime.getSnapshot().status).toBe("idle"));
    await runtime.removeTurnInput(handle.turnId);

    expect(sourceA.messageStore.getMessages().map(({ role }) => role)).toEqual([
      "assistant",
    ]);
    expect(sourceB.messageStore.getMessages().map(({ role }) => role)).toEqual([
      "assistant",
    ]);
    expect(
      runtime.getSnapshot().turnsById[handle.turnId]?.inputMessage,
    ).toBeUndefined();

    await runtime.dispose();
  });

  it("keeps the Turn topology when Source deletion fails", async () => {
    const input = userMessage("user", "Question");
    const answer = assistantMessage("answer", "Answer");
    const messages = [input, answer];
    const controlled = createHistorySource(messages);
    controlled.source.deleteMessages = () => {
      throw new Error("delete failed");
    };
    const runtime = createHistoryRuntime(controlled.source, messages);
    const turnId = runtime.getSnapshot().turnIds[0]!;

    await expect(runtime.removeTurn(turnId)).rejects.toThrow("delete failed");

    expect(runtime.getSnapshot().turnIds).toEqual([turnId]);
    expect(controlled.messageStore.getMessages()).toEqual(messages);

    await runtime.dispose();
  });

  it("rejects an external Source without deletion support before changing topology", async () => {
    const input = userMessage("user", "Question");
    const answer = assistantMessage("answer", "Answer");
    const messages = [input, answer];
    const messageStore = createMessageStore<TestMessage>(messages);
    const source: AnswerSource<string, TestMessage> = {
      id: "read-only-history-source",
      messageReader: messageStore,
      async *run() {
        yield { type: "branch-completed" };
      },
    };
    const runtime = createHistoryRuntime(source, messages);
    const turnId = runtime.getSnapshot().turnIds[0]!;

    await expect(runtime.removeTurn(turnId)).rejects.toThrow(
      "does not support message deletion",
    );

    expect(runtime.getSnapshot().turnIds).toEqual([turnId]);
    expect(messageStore.getMessages()).toEqual(messages);

    await runtime.dispose();
  });

  it("keeps successful Source projections consistent after a partial Compare deletion failure", async () => {
    const sourceA = createLiveSource("source-a");
    const sourceB = createLiveSource("source-b");
    const deleteFromSourceA = vi.fn(sourceA.source.deleteMessages!);
    const deleteFromSourceB = sourceB.source.deleteMessages!;
    sourceA.source.deleteMessages = deleteFromSourceA;
    sourceB.source.deleteMessages = () => {
      throw new Error("source-b delete failed");
    };
    const runtime = new CompareChatRuntime<string, TestMessage>({
      sources: [
        { branchId: "branch-a", source: sourceA.source },
        { branchId: "branch-b", source: sourceB.source },
      ],
      createInputMessage: (input, turnId) =>
        userMessage(`${turnId}:input`, input),
    });

    const handle = await runtime.send("Question");
    await vi.waitFor(() => expect(runtime.getSnapshot().status).toBe("idle"));

    await expect(runtime.removeTurn(handle.turnId)).rejects.toThrow(
      "source-b delete failed",
    );

    const snapshot = runtime.getSnapshot();
    const turn = snapshot.turnsById[handle.turnId]!;
    expect(turn).toBeDefined();
    expect(sourceA.messageStore.getMessages()).toEqual([]);
    expect(sourceB.messageStore.getMessages()).toHaveLength(2);
    expect(
      snapshot.branchesById[turn.branchIds[0]!]!.messageReader.getMessages(),
    ).toEqual([]);
    expect(
      snapshot.branchesById[turn.branchIds[1]!]!.messageReader.getMessages(),
    ).toHaveLength(1);

    sourceB.source.deleteMessages = deleteFromSourceB;
    await runtime.removeTurn(handle.turnId);

    expect(deleteFromSourceA).toHaveBeenCalledTimes(1);
    expect(runtime.getSnapshot().turnIds).toEqual([]);
    expect(sourceB.messageStore.getMessages()).toEqual([]);

    await runtime.dispose();
  });

  it("requires the caller to cancel an active Turn before deleting it", async () => {
    const messageStore = createMessageStore<TestMessage>();
    const cancel = vi.fn();
    const source: AnswerSource<string, TestMessage> = {
      id: "active-source",
      messageReader: messageStore,
      async *run(_input, context) {
        if (context.inputMessage) {
          messageStore.appendMessage(context.inputMessage as TestMessage);
        }
        yield { type: "branch-started" };
        await waitForAbort(context.signal);
      },
      cancel,
      deleteMessages(messageIds) {
        const removedIds = new Set(messageIds);
        messageStore.setMessages(
          messageStore
            .getMessages()
            .filter((message) => !removedIds.has(message.id)),
        );
      },
    };
    const runtime = new SingleAgentRuntime<string, TestMessage>({
      source,
      createInputMessage: (input, turnId) =>
        userMessage(`${turnId}:input`, input),
    });

    const handle = await runtime.send("Stop this answer");
    await Promise.resolve();
    await expect(removeLastTurn(runtime)).rejects.toThrow("Cancel it first");
    expect(cancel).not.toHaveBeenCalled();

    await runtime.cancel({ turnId: handle.turnId });
    await removeLastTurn(runtime);

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(runtime.getSnapshot().turnsById[handle.turnId]).toBeUndefined();
    expect(runtime.getSnapshot().turnIds).toEqual([]);
    expect(runtime.getSnapshot().activeTurnId).toBeUndefined();
    expect(messageStore.getMessages()).toEqual([]);

    await runtime.dispose();
  });

  it("is a no-op when there is no last Turn", async () => {
    const controlled = createHistorySource([]);
    const runtime = createHistoryRuntime(controlled.source, []);

    await removeLastTurn(runtime);

    expect(runtime.getSnapshot().turnIds).toEqual([]);
    expect(controlled.messageStore.getMessages()).toEqual([]);

    await runtime.dispose();
  });
});

function createHistorySource(messages: readonly TestMessage[]) {
  const messageStore = createMessageStore<TestMessage>();
  messageStore.setMessages(messages);
  const source: AnswerSource<string, TestMessage> = {
    id: "history-source",
    messageReader: messageStore,
    async *run() {
      yield { type: "branch-completed" };
    },
    deleteMessages(messageIds) {
      const removedIds = new Set(messageIds);
      messageStore.setMessages(
        messageStore
          .getMessages()
          .filter((message) => !removedIds.has(message.id)),
      );
    },
  };

  return { source, messageStore };
}

function createLiveSource(id: string) {
  const messageStore = createMessageStore<TestMessage>();
  const source: AnswerSource<string, TestMessage> = {
    id,
    messageReader: messageStore,
    async *run(_input, context) {
      if (context.inputMessage) {
        messageStore.appendMessage(context.inputMessage);
      }
      messageStore.appendMessage(
        assistantMessage(`${context.turnId}:${id}:answer`, `${id} answer`),
      );
      yield { type: "branch-completed" };
    },
    deleteMessages(messageIds) {
      const removedIds = new Set(messageIds);
      messageStore.setMessages(
        messageStore
          .getMessages()
          .filter((message) => !removedIds.has(message.id)),
      );
    },
  };

  return { source, messageStore };
}

function createHistoryRuntime(
  source: AnswerSource<string, TestMessage>,
  messages: readonly TestMessage[],
) {
  return new SingleAgentRuntime<string, TestMessage>({
    source,
    historyMessages: messages,
    createInputMessage: (input, turnId) =>
      userMessage(`${turnId}:input`, input),
  });
}

function waitForAbort(signal: AbortSignal) {
  if (signal.aborted) return Promise.resolve();

  return new Promise<void>((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

function userMessage(id: string, content: string): TestMessage {
  return { id, role: "user", content };
}

function assistantMessage(id: string, content: string): TestMessage {
  return { id, role: "assistant", content };
}
