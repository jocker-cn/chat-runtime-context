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

  it("keeps the question and the complete AI response as two tab stops", async () => {
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
      <ChatRuntimeView
        runtime={runtime}
        renderer={demoRenderer}
        renderInput={(props: FrameCardProps<DemoMessage>) => {
          const Card = demoRenderer.getCard(props.message, props.context);
          return <Card {...props} />;
        }}
      />,
    );

    const question = screen.getByText("What blocks this release?");
    const responseFrame = document.querySelector<HTMLElement>(
      ".crt-frame-list-item",
    )!;
    const link = screen.getByRole("link", { name: "runbook" });

    expect(question.getAttribute("tabindex")).toBe("0");
    expect(responseFrame.getAttribute("tabindex")).toBe("0");
    expect(responseFrame.textContent).toContain("How AI Think");
    expect(responseFrame.textContent).toContain("Result");
    expect(link.getAttribute("tabindex")).toBe("-1");

    responseFrame.focus();
    fireEvent.keyDown(responseFrame, { key: "Enter" });
    await waitFor(() => expect(document.activeElement).toBe(link));

    fireEvent.keyDown(link, { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(responseFrame));

    runtime.dispose();
  });
});
