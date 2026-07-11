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
    const inputGroup = question.closest<HTMLElement>(
      "[data-runtime-focus-group-id]",
    )!;
    const responseFrame = document.querySelector<HTMLElement>(
      ".crt-frame-list-item",
    )!;
    const link = screen.getByRole("link", { name: "runbook" });

    expect(inputGroup.getAttribute("tabindex")).toBe("-1");
    expect(question.getAttribute("tabindex")).toBe("-1");
    expect(responseFrame.getAttribute("tabindex")).toBe("0");
    expect(responseFrame.textContent).toContain("How AI Think");
    expect(responseFrame.textContent).toContain("Result");
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
    await waitFor(() => expect(document.activeElement).toBe(link));

    fireEvent.keyDown(link, { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(responseFrame));

    runtime.dispose();
  });
});
