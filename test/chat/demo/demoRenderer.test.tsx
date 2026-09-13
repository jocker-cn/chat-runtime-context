// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DemoMessage } from "../../../src/chat/demo/demoMessage";
import {
  demoRenderer,
  type DemoChatExtensions,
} from "../../../src/chat/demo/demoRenderer";
import {
  ChatRuntimeView,
  CompareChatRuntime,
  createChatExtensionStore,
  createMessageStore,
  findChatMessageById,
  type AnswerSource,
  type FrameCardProps,
} from "../../../src/core";

describe("demoRenderer Message references", () => {
  const runtimes: CompareChatRuntime<string, DemoMessage>[] = [];

  afterEach(async () => {
    await Promise.allSettled(runtimes.splice(0).map((runtime) => runtime.dispose()));
  });

  it("starts a reference from an AI Message and resolves it for a User Message", () => {
    const referenced: DemoMessage = {
      id: "assistant-reference",
      role: "assistant",
      content: "A long answer that the next User Message references.",
    };
    const userWithReference: DemoMessage = {
      id: "user-with-reference",
      role: "user",
      content: "Continue from this answer.",
      referencedMessageId: referenced.id,
    };
    const messageStore = createMessageStore<DemoMessage>([referenced]);
    const source: AnswerSource<string, DemoMessage> = {
      id: "agent-a",
      messageReader: messageStore,
      async *run() {
        yield { type: "branch-completed" };
      },
    };
    const runtime = new CompareChatRuntime<string, DemoMessage>({
      sources: [{ branchId: "agent-a", source }],
      createInputMessage: (content, turnId) => ({
        id: `${turnId}:input`,
        role: "user",
        content,
      }),
      historyTurns: [
        {
          id: "answer-turn",
          inputMessage: {
            id: "question",
            role: "user",
            content: "Original question",
          },
          messageIds: [referenced.id],
        },
        {
          id: "reference-turn",
          inputMessage: userWithReference,
          messageIds: [],
        },
      ],
    });
    runtimes.push(runtime);
    const chatFromHere = vi.fn();
    const extensions: DemoChatExtensions = Object.assign(
      createChatExtensionStore(),
      {
        chatFromHere,
        resolveMessageById: (messageId: string) =>
          findChatMessageById(runtime, messageId),
      },
    );

    const { container } = render(
      <ChatRuntimeView
        runtime={runtime}
        extensions={extensions}
        renderer={demoRenderer}
        renderInput={renderInput}
      />,
    );

    expect(container.querySelector(".message-card-reference")?.textContent)
      .toBe(referenced.content);

    fireEvent.click(screen.getByRole("button", { name: "Chat from here" }));
    expect(chatFromHere).toHaveBeenCalledWith(
      referenced,
      expect.objectContaining({ turnId: "answer-turn" }),
    );
  });
});

function renderInput(props: FrameCardProps<DemoMessage>) {
  const Card = demoRenderer.getCard(props.message, props.context);
  return <Card {...props} />;
}
