/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
});

function expectDescribedContent(element: HTMLElement, expected: string) {
  const descriptionId = element.getAttribute("aria-describedby");
  expect(descriptionId).not.toBeNull();
  expect(document.getElementById(descriptionId!)?.textContent).toContain(
    expected,
  );
}
