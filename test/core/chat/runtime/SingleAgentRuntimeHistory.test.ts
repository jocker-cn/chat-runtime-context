import type { AbstractAgent, Message } from "@ag-ui/client";
import { describe, expect, it, vi } from "vitest";
import {
  AgUiAgentSource,
  SingleAgentRuntime,
} from "../../../../src/core";

const createInputMessage = (input: string, turnId: string): Message => ({
  id: `${turnId}:input`,
  role: "user",
  content: input,
});

describe("SingleAgentRuntime AG-UI history", () => {
  it("projects history message ids from the same agent reader", async () => {
    const inputMessage = message("history-input", "user", "Question");
    const answerMessage = message("history-answer", "assistant", "Answer");
    const historyMessages = [inputMessage, answerMessage];
    const source = createAgentSource(historyMessages);
    const runtime = new SingleAgentRuntime<string, Message>({
      source,
      historyMessages,
      createInputMessage,
    });

    const historyTurnId = runtime.getSnapshot().turnIds[0];
    const historyTurn = runtime.getSnapshot().turnsById[historyTurnId];
    const historyBranch =
      runtime.getSnapshot().branchesById[historyTurn.branchIds[0]];

    expect(historyTurn.inputMessage).toBe(inputMessage);
    expect(historyBranch.messageReader.getMessages()).toMatchObject([
      answerMessage,
    ]);

    await runtime.dispose();
  });

  it("renders AI-only agent history as a native input-less turn", async () => {
    const answerMessage = message(
      "history-answer",
      "assistant",
      "Standalone answer",
    );
    const historyMessages = [answerMessage];
    const source = createAgentSource(historyMessages);
    const runtime = new SingleAgentRuntime<string, Message>({
      source,
      historyMessages,
      createInputMessage,
    });

    const historyTurn =
      runtime.getSnapshot().turnsById[runtime.getSnapshot().turnIds[0]];
    const historyBranch =
      runtime.getSnapshot().branchesById[historyTurn.branchIds[0]];

    expect(historyTurn.id).toBe("history-history-answer");
    expect(historyTurn.inputMessage).toBeUndefined();
    expect(historyTurn.inputMessageId).toBeUndefined();
    expect(historyBranch.messageReader.getMessages()).toMatchObject([
      answerMessage,
    ]);

    await runtime.dispose();
  });
});

function createAgentSource(initialMessages: readonly Message[]) {
  const agent = {
    agentId: "history-agent",
    description: "History agent",
    messages: [...initialMessages],
    subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })),
    addMessages: vi.fn(),
    runAgent: vi.fn(() =>
      Promise.resolve({ result: undefined, newMessages: [] }),
    ),
    abortRun: vi.fn(),
    setMessages: vi.fn(),
  } as unknown as AbstractAgent;

  return new AgUiAgentSource({ agent });
}

function message(id: string, role: Message["role"], content: string): Message {
  return { id, role, content } as Message;
}
