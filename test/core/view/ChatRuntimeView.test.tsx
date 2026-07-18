/** @vitest-environment jsdom */

import { act } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DemoMessage } from "../../../src/chat/demo/demoMessage";
import { demoRenderer } from "../../../src/chat/demo/demoRenderer";
import {
  ChatRuntimeView,
  SingleAgentRuntime,
  createMessageStore,
  type AnswerSource,
  type FrameCardProps,
} from "../../../src/core";

describe("ChatRuntimeView response grouping", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "requestAnimationFrame",
      (callback: FrameRequestCallback) => {
        callback(performance.now());
        return 1;
      },
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("treats the question and complete AI response as runtime focus groups", async () => {
    const messages: DemoMessage[] = [
      {
        id: "question-1",
        role: "user",
        content: "What blocks this release?",
      },
      {
        id: "thinking-1",
        role: "activity",
        activityType: "thinking",
        content: {
          phase: "completed",
          text: "I compared rollback readiness and metrics.",
        },
      } as DemoMessage,
      {
        id: "answer-1",
        role: "assistant",
        content: "## Result\n\nRead the [runbook](https://example.com/runbook).",
        actions: [
          {
            id: "check",
            label: "Run check",
            result: "Check started.",
          },
        ],
      },
    ];
    const messageStore = createMessageStore<DemoMessage>(messages);
    const source: AnswerSource<string, DemoMessage> = {
      id: "main",
      messageReader: messageStore,
      async *run() {
        yield { type: "branch-completed" };
      },
    };
    const runtime = new SingleAgentRuntime<string, DemoMessage>({
      source,
      branchId: "main",
      historyMessages: messages,
      createInputMessage: (input, turnId) => ({
        id: `${turnId}:input`,
        role: "user",
        content: input,
      }),
    });

    render(
      <div>
        <button type="button">Before chat</button>
        <ChatRuntimeView
          runtime={runtime}
          renderer={demoRenderer}
          renderInput={(props: FrameCardProps<DemoMessage>) => {
            const Card = demoRenderer.getCard(props.message, props.context);
            return <Card {...props} />;
          }}
        />
        <button type="button">After chat</button>
      </div>,
    );

    const question = screen.getByText("What blocks this release?");
    const questionCard = screen.getByRole("article", {
      name: "User message",
    });
    const inputGroup = question.closest<HTMLElement>(
      "[data-runtime-focus-group-id]",
    )!;
    const responseFrame = document.querySelector<HTMLElement>(
      ".crt-frame-list-item",
    )!;
    const thinkingCard = screen.getByRole("article", {
      name: "How AI Think",
    });
    const assistantCard = screen.getByRole("article", {
      name: "AI response",
    });
    const link = screen.getByRole("link", { name: "runbook" });

    expect(screen.getByRole("list", { name: "Chat messages" })).toBeTruthy();
    expect(inputGroup.getAttribute("tabindex")).toBe("-1");
    expect(inputGroup.getAttribute("aria-label")).toBe("Message");
    expect(inputGroup.getAttribute("aria-posinset")).toBe("1");
    expect(inputGroup.getAttribute("aria-setsize")).toBe("2");
    expect(questionCard.getAttribute("tabindex")).toBe("-1");
    expectDescribedContent(questionCard, "What blocks this release?");
    expect(responseFrame.getAttribute("tabindex")).toBe("0");
    expect(responseFrame.getAttribute("aria-label")).toBe("Message");
    expect(responseFrame.getAttribute("aria-posinset")).toBe("2");
    expect(responseFrame.getAttribute("aria-setsize")).toBe("2");
    expect(responseFrame.textContent).toContain("How AI Think");
    expect(responseFrame.textContent).toContain("Result");
    expect(thinkingCard.getAttribute("tabindex")).toBe("-1");
    expect(thinkingCard.getAttribute("aria-busy")).toBe("false");
    expect(thinkingCard.hasAttribute("aria-live")).toBe(false);
    expectDescribedContent(
      thinkingCard,
      "I compared rollback readiness and metrics.",
    );
    expect(assistantCard.getAttribute("tabindex")).toBe("-1");
    expectDescribedContent(assistantCard, "Result");
    expectDescribedContent(assistantCard, "runbook");
    expect(link.getAttribute("tabindex")).toBe("-1");

    responseFrame.focus();
    fireEvent.keyDown(responseFrame, { key: "ArrowUp" });
    await waitFor(() => expect(document.activeElement).toBe(inputGroup));
    expect(inputGroup.getAttribute("tabindex")).toBe("0");
    expect(responseFrame.getAttribute("tabindex")).toBe("-1");

    fireEvent.keyDown(inputGroup, { key: "ArrowDown" });
    await waitFor(() => expect(document.activeElement).toBe(responseFrame));

    const tabEvent = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Tab",
    });
    responseFrame.dispatchEvent(tabEvent);
    expect(tabEvent.defaultPrevented).toBe(false);

    responseFrame.focus();
    fireEvent.keyDown(responseFrame, { key: "Enter" });
    await waitFor(() => expect(document.activeElement).toBe(thinkingCard));

    fireEvent.keyDown(thinkingCard, { key: "ArrowDown" });
    await waitFor(() => expect(document.activeElement).toBe(assistantCard));

    fireEvent.keyDown(assistantCard, { key: "ArrowDown" });
    await waitFor(() => expect(document.activeElement).toBe(link));

    fireEvent.keyDown(link, { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(responseFrame));

    runtime.dispose();
  });

  it("renders AI-only and failed-user local runs as independent focus groups", async () => {
    const messages: DemoMessage[] = [
      {
        id: "question-1",
        role: "user",
        content: "What blocks this release?",
      },
      {
        id: "answer-1",
        role: "assistant",
        content: "The deployment connection was interrupted.",
      },
    ];
    const messageStore = createMessageStore<DemoMessage>(messages);
    const source: AnswerSource<string, DemoMessage> = {
      id: "main",
      messageReader: messageStore,
      deleteMessages(messageIds) {
        const deletedIds = new Set(messageIds);
        messageStore.setMessages(
          messageStore
            .getMessages()
            .filter((message) => !deletedIds.has(message.id)),
        );
      },
      async *run() {
        yield { type: "branch-completed" };
      },
      addLocalMessage(message) {
        messageStore.setMessages([
          ...messageStore.getMessages(),
          message,
        ]);
      },
    };
    const runtime = new SingleAgentRuntime<string, DemoMessage>({
      source,
      branchId: "main",
      historyMessages: messages,
      createInputMessage: (_input, turnId) => ({
        id: `${turnId}:input`,
        role: "user",
        content: "unused",
      }),
      createTurnId: () => "error-turn",
    });
    render(
      <ChatRuntimeView
        runtime={runtime}
        renderer={demoRenderer}
        renderInput={(props: FrameCardProps<DemoMessage>) => {
          const Card = demoRenderer.getCard(props.message, props.context);
          return <Card {...props} />;
        }}
      />,
    );

    const previousResponseFrame = document.querySelector<HTMLElement>(
      ".crt-frame-list-item",
    )!;
    previousResponseFrame.focus();
    let errorTurnId = "";

    await act(async () => {
      const handle = await runtime.sendLocalMessage({
        id: "connection-error",
        role: "activity",
        activityType: "error",
        content: { message: "Connection interrupted." },
      } as DemoMessage);
      errorTurnId = handle.turnId;
    });

    const errorCard = await screen.findByRole("article", {
      name: "AI error",
    });
    const errorTurn = document.querySelector<HTMLElement>(
      `[data-turn-id="${errorTurnId}"]`,
    )!;
    const errorFrame = errorCard.closest<HTMLElement>(
      "[data-runtime-focus-group-id]",
    )!;

    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(
      errorTurn.querySelectorAll("[data-runtime-focus-group-id]"),
    ).toHaveLength(1);
    expect(errorFrame).not.toBe(previousResponseFrame);
    expect(previousResponseFrame.getAttribute("aria-posinset")).toBe("2");
    expect(previousResponseFrame.getAttribute("aria-setsize")).toBe("3");
    expect(errorFrame.getAttribute("aria-posinset")).toBe("3");
    expect(errorFrame.getAttribute("aria-setsize")).toBe("3");
    expect(previousResponseFrame.getAttribute("tabindex")).toBe("0");
    expect(errorFrame.getAttribute("tabindex")).toBe("-1");
    expect(document.activeElement).toBe(previousResponseFrame);

    fireEvent.keyDown(previousResponseFrame, { key: "ArrowDown" });
    await waitFor(() => expect(document.activeElement).toBe(errorFrame));

    fireEvent.keyDown(errorFrame, { key: "ArrowUp" });
    await waitFor(() =>
      expect(document.activeElement).toBe(previousResponseFrame),
    );

    await act(async () => {
      await runtime.removeTurn(errorTurnId, {
        deleteMessages: true,
        includeInput: true,
      });
    });

    await waitFor(() =>
      expect(
        screen.queryByRole("article", { name: "AI error" }),
      ).toBeNull(),
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(previousResponseFrame.getAttribute("aria-posinset")).toBe("2");
    expect(previousResponseFrame.getAttribute("aria-setsize")).toBe("2");
    expect(messageStore.getMessages()).toEqual(messages);

    const userError: DemoMessage = {
      id: "user-error",
      role: "user",
      content: "This message could not be sent.",
      status: "error",
    };
    let userErrorTurnId = "";

    await act(async () => {
      const handle = await runtime.sendLocalMessage(
        userError,
        { placement: "input" },
      );
      userErrorTurnId = handle.turnId;
    });

    const userErrorCard = await screen.findByRole("article", {
      name: "User message failed",
    });
    const userErrorTurn = document.querySelector<HTMLElement>(
      `[data-turn-id="${userErrorTurnId}"]`,
    )!;

    expect(userErrorCard.textContent).toContain("Failed to send");
    expect(userErrorCard.textContent).toContain(
      "This message could not be sent.",
    );
    expect(
      userErrorTurn.querySelectorAll("[data-runtime-focus-group-id]"),
    ).toHaveLength(1);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);

    runtime.dispose();
  });
});

function expectDescribedContent(element: HTMLElement, expected: string) {
  const descriptionId = element.getAttribute("aria-describedby");
  expect(descriptionId).not.toBeNull();
  expect(document.getElementById(descriptionId!)?.textContent).toContain(
    expected,
  );
}
