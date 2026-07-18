/** @vitest-environment jsdom */

import type { AbstractAgent, Message } from "@ag-ui/client";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AgUiAgentSource,
  ChatRuntimeView,
  SingleAgentRuntime,
  createFrameRenderer,
  type FrameCardProps,
} from "../../../src/core";

describe("ChatRuntimeView input-less history", () => {
  afterEach(cleanup);

  it("renders an AI-only history turn without synthesizing a user message", async () => {
    const historyMessages: Message[] = [
      {
        id: "standalone-answer",
        role: "assistant",
        content: "Standalone historical answer",
      },
    ];
    const agent = {
      agentId: "history-agent",
      description: "History agent",
      messages: historyMessages,
      subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })),
      addMessages: vi.fn(),
      runAgent: vi.fn(() =>
        Promise.resolve({ result: undefined, newMessages: [] }),
      ),
      abortRun: vi.fn(),
      setMessages: vi.fn(),
    } as unknown as AbstractAgent;
    const runtime = new SingleAgentRuntime<string, Message>({
      source: new AgUiAgentSource({ agent }),
      historyMessages,
      createInputMessage: (input, turnId) => ({
        id: `${turnId}:input`,
        role: "user",
        content: input,
      }),
    });
    const renderer = createFrameRenderer<Message>({
      cards: { assistant: MessageCard },
      fallback: MessageCard,
    });

    render(<ChatRuntimeView runtime={runtime} renderer={renderer} />);

    const turn =
      runtime.getSnapshot().turnsById[runtime.getSnapshot().turnIds[0]];
    expect(turn.inputMessage).toBeUndefined();
    expect(screen.getByTestId("message-standalone-answer").textContent).toBe(
      "Standalone historical answer",
    );

    await runtime.dispose();
  });
});

function MessageCard({ message }: FrameCardProps<Message>) {
  return (
    <article data-testid={`message-${message.id}`}>
      {typeof message.content === "string" ? message.content : ""}
    </article>
  );
}
