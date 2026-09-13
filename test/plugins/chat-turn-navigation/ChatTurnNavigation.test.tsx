// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode, useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DemoMessage } from "../../../src/chat/demo/demoMessage";
import {
  ChatTurnNavigationAnchor,
  ChatTurnNavigationProvider,
  ChatTurnNavigationRail,
  ChatTurnNavigationStore,
} from "../../../src/core";
import {
  CompareChatRuntime,
  createMessageStore,
  type AnswerSource,
} from "../../../src/core";

describe("Chat Turn Navigation", () => {
  const runtimes: CompareChatRuntime<string, DemoMessage>[] = [];

  afterEach(async () => {
    cleanup();
    await Promise.allSettled(runtimes.splice(0).map((runtime) => runtime.dispose()));
  });

  it("keeps NavigationItem identity stable and ignores stale Anchor cleanup", () => {
    const store = new ChatTurnNavigationStore();
    store.setItems([{ id: "turn-1", turnId: "turn-1", messageId: "user-1" }]);
    const firstSnapshot = store.getSnapshot();

    store.setItems([{ id: "turn-1", turnId: "turn-1", messageId: "user-1" }]);
    expect(store.getSnapshot()).toBe(firstSnapshot);

    const oldElement = document.createElement("div");
    const nextElement = document.createElement("div");
    const oldToken = Symbol("old");
    const nextToken = Symbol("next");
    store.registerAnchor({
      turnId: "turn-1",
      messageId: "user-1",
      element: oldElement,
      token: oldToken,
    });
    store.registerAnchor({
      turnId: "turn-1",
      messageId: "user-1",
      element: nextElement,
      token: nextToken,
    });

    store.unregisterAnchor("turn-1", oldToken);
    expect(store.getAnchor("turn-1")).toBe(nextElement);
  });

  it("projects one marker per User Turn and scrolls its registered Anchor", async () => {
    const runtime = createHistoryRuntime();
    runtimes.push(runtime);
    const onUserNavigate = vi.fn();

    function Harness() {
      const viewportRef = useRef<HTMLDivElement>(null);
      return (
        <ChatTurnNavigationProvider
          runtime={runtime}
          scrollContainerRef={viewportRef}
          onUserNavigate={onUserNavigate}
          getPreview={({ inputMessage }) => ({
            title: String(inputMessage.content),
            ariaLabel: `Preview of ${String(inputMessage.content)}`,
          })}
        >
          <div ref={viewportRef} data-testid="viewport">
            <ChatTurnNavigationAnchor turnId="turn-1" messageId="user-1">
              First
            </ChatTurnNavigationAnchor>
            <ChatTurnNavigationAnchor turnId="turn-2" messageId="user-2">
              Second
            </ChatTurnNavigationAnchor>
          </div>
          <ChatTurnNavigationRail />
        </ChatTurnNavigationProvider>
      );
    }

    render(
      <StrictMode>
        <Harness />
      </StrictMode>,
    );
    const firstMarker = await screen.findByRole("button", {
      name: "Jump to user message 1",
    });
    expect(screen.getAllByRole("button")).toHaveLength(2);

    fireEvent.mouseEnter(firstMarker);
    expect(screen.getByRole("tooltip").textContent).toContain("First");

    const rail = screen.getByRole("navigation", { name: "User messages" });
    Object.defineProperties(rail, {
      clientHeight: { configurable: true, value: 40 },
      scrollHeight: { configurable: true, value: 100 },
      scrollTop: { configurable: true, value: 0, writable: true },
    });
    fireEvent.wheel(rail, { deltaY: 24 });
    expect(rail.scrollTop).toBe(24);
    expect(screen.queryByRole("tooltip")).toBeNull();

    const viewport = screen.getByTestId("viewport");
    const firstAnchor = viewport.querySelector<HTMLElement>(
      '[data-chat-turn-navigation-anchor="turn-1"]',
    )!;
    Object.defineProperty(viewport, "scrollTop", {
      configurable: true,
      value: 100,
      writable: true,
    });
    viewport.getBoundingClientRect = () => createRect({ top: 10, height: 300 });
    firstAnchor.getBoundingClientRect = () => createRect({ top: 210, height: 40 });
    const scrollTo = vi.fn();
    viewport.scrollTo = scrollTo;

    fireEvent.click(firstMarker);

    expect(scrollTo).toHaveBeenCalledWith({ top: 300, behavior: "smooth" });
    expect(onUserNavigate).toHaveBeenCalledWith(
      expect.objectContaining({ turnId: "turn-1", messageId: "user-1" }),
    );
  });

  it("previews the first Agent when a Compare Turn has no selected Branch", async () => {
    const sourceA = createPreviewSource("Agent A response");
    const sourceB = createPreviewSource("Agent B response");
    const runtime = new CompareChatRuntime<string, DemoMessage>({
      sources: [
        { branchId: "agent-a", source: sourceA.source },
        { branchId: "agent-b", source: sourceB.source },
      ],
      createTurnId: () => "turn-1",
      createInputMessage: (content, turnId) => ({
        id: `${turnId}:input`,
        role: "user",
        content,
      }),
    });
    runtimes.push(runtime);

    await runtime.send("Question");
    await vi.waitFor(() => expect(runtime.getSnapshot().status).toBe("idle"));
    expect(runtime.getSnapshot().turnsById["turn-1"]?.selectedBranchId)
      .toBeUndefined();

    function Harness() {
      const viewportRef = useRef<HTMLDivElement>(null);
      return (
        <ChatTurnNavigationProvider
          runtime={runtime}
          scrollContainerRef={viewportRef}
          getPreview={({ inputMessage, selectedMessages }) => ({
            title: String(inputMessage.content),
            body: selectedMessages?.find((message) =>
              message.role === "assistant"
            )?.content,
            ariaLabel: "Turn preview",
          })}
        >
          <div ref={viewportRef}>
            <ChatTurnNavigationAnchor turnId="turn-1" messageId="turn-1:input">
              Question
            </ChatTurnNavigationAnchor>
          </div>
          <ChatTurnNavigationRail />
        </ChatTurnNavigationProvider>
      );
    }

    const view = render(<Harness />);
    const marker = view.getByRole("button", {
      name: "Jump to user message 1",
    });
    fireEvent.mouseEnter(marker);

    expect(view.getByRole("tooltip").textContent)
      .toContain("Agent A response");
    expect(view.getByRole("tooltip").textContent)
      .not.toContain("Agent B response");

    fireEvent.mouseLeave(marker);
    runtime.selectBranch("turn-1", "turn-1:agent-b");
    fireEvent.mouseEnter(marker);

    expect(view.getByRole("tooltip").textContent)
      .toContain("Agent B response");
  });
});

function createHistoryRuntime() {
  const messageStore = createMessageStore<DemoMessage>();
  const source: AnswerSource<string, DemoMessage> = {
    id: "agent-a",
    messageReader: messageStore,
    async *run() {
      yield { type: "branch-completed" };
    },
  };

  return new CompareChatRuntime<string, DemoMessage>({
    sources: [{ source, branchId: "agent-a" }],
    createInputMessage: (content, turnId) => ({
      id: `${turnId}:input`,
      role: "user",
      content,
    }),
    historyTurns: [
      {
        id: "turn-1",
        inputMessage: { id: "user-1", role: "user", content: "First" },
        messageIds: [],
      },
      {
        id: "turn-2",
        inputMessage: { id: "user-2", role: "user", content: "Second" },
        messageIds: [],
      },
    ],
  });
}

function createPreviewSource(response: string) {
  const messageStore = createMessageStore<DemoMessage>();
  const source: AnswerSource<string, DemoMessage> = {
    id: response,
    messageReader: messageStore,
    async *run(_input, context) {
      if (context.inputMessage) {
        messageStore.appendMessage(context.inputMessage as DemoMessage);
      }
      messageStore.appendMessage({
        id: `${context.branchId}:assistant`,
        role: "assistant",
        content: response,
      });
      yield { type: "branch-completed" };
    },
  };

  return { source };
}

function createRect({ top, height }: { top: number; height: number }) {
  return {
    x: 0,
    y: top,
    top,
    right: 100,
    bottom: top + height,
    left: 0,
    width: 100,
    height,
    toJSON: () => undefined,
  };
}
