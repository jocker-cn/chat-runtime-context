// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DemoMessage } from "../../../src/chat/demo/demoMessage";
import {
  ChatTurnNavigationRail,
  ChatTurnNavigationStore,
  useChatTurnNavigation,
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

  it("keeps NavigationItem identity stable", () => {
    const store = new ChatTurnNavigationStore();
    store.setItems([{ id: "turn-1", turnId: "turn-1", messageId: "user-1" }]);
    const firstSnapshot = store.getSnapshot();

    store.setItems([{ id: "turn-1", turnId: "turn-1", messageId: "user-1" }]);
    expect(store.getSnapshot()).toBe(firstSnapshot);
  });

  it("projects one marker per User Turn and uses a custom ViewportAdapter", async () => {
    const runtime = createHistoryRuntime();
    runtimes.push(runtime);
    const onUserNavigate = vi.fn();
    const revealItem = vi.fn();
    const viewportAdapter = {
      getScrollElement: () => null,
      revealItem,
    };

    function Harness() {
      const navigation = useChatTurnNavigation({
        runtime,
        viewportAdapter,
        onUserNavigate,
        getPreview: ({ inputMessage }) => ({
          title: String(inputMessage.content),
          ariaLabel: `Preview of ${String(inputMessage.content)}`,
        }),
      });
      return (
        <>
          <div data-testid="viewport">
            <article data-turn-id="turn-1">
              First
            </article>
            <article data-turn-id="turn-2">
              Second
            </article>
          </div>
          <ChatTurnNavigationRail navigation={navigation} />
        </>
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

    fireEvent.click(firstMarker);

    expect(revealItem).toHaveBeenCalledWith(
      expect.objectContaining({ turnId: "turn-1", messageId: "user-1" }),
      { behavior: "smooth", align: "start" },
    );
    expect(onUserNavigate).toHaveBeenCalledWith(
      expect.objectContaining({ turnId: "turn-1", messageId: "user-1" }),
    );
  });

  it("uses the Turn DOM as the default scroll target", async () => {
    const runtime = createHistoryRuntime();
    runtimes.push(runtime);

    function Harness() {
      const navigation = useChatTurnNavigation({ runtime });
      return (
        <>
          <article data-turn-id="turn-1">
            First
          </article>
          <ChatTurnNavigationRail navigation={navigation} />
        </>
      );
    }

    const view = render(<Harness />);
    const turn = view.container.querySelector<HTMLElement>(
      '[data-turn-id="turn-1"]',
    )!;
    const scrollIntoView = vi.fn();
    turn.scrollIntoView = scrollIntoView;

    fireEvent.click(await view.findByRole("button", {
      name: "Jump to user message 1",
    }));

    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "start",
      inline: "nearest",
    });
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
      const navigation = useChatTurnNavigation({
        runtime,
        getPreview: ({ inputMessage, selectedMessages }) => ({
          title: String(inputMessage.content),
          body: selectedMessages?.find((message) =>
            message.role === "assistant"
          )?.content,
          ariaLabel: "Turn preview",
        }),
      });
      return (
        <>
          <div>
            <article data-turn-id="turn-1">
              Question
            </article>
          </div>
          <ChatTurnNavigationRail navigation={navigation} />
        </>
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

  it("refreshes a hovered Preview when its Branch settles without following tokens", async () => {
    const controlled = createControlledPreviewSource("Final response");
    const runtime = new CompareChatRuntime<string, DemoMessage>({
      sources: [{ branchId: "agent-a", source: controlled.source }],
      createTurnId: () => "turn-1",
      createInputMessage: (content, turnId) => ({
        id: `${turnId}:input`,
        role: "user",
        content,
      }),
    });
    runtimes.push(runtime);

    await runtime.send("Question");
    await vi.waitFor(() => {
      expect(runtime.getSnapshot().branchesById["turn-1:agent-a"]?.status)
        .toBe("running");
    });
    controlled.pushPartial("Partial before hover");
    const branchReader = runtime.getSnapshot()
      .branchesById["turn-1:agent-a"]!.messageReader;
    const subscribeReader = vi.spyOn(branchReader, "subscribe");
    const getPreview = vi.fn(({ inputMessage, selectedMessages }) => ({
      title: String(inputMessage.content),
      body: selectedMessages?.find((message: DemoMessage) =>
        message.role === "assistant"
      )?.content,
      ariaLabel: "Turn preview",
    }));

    function Harness() {
      const navigation = useChatTurnNavigation({ runtime, getPreview });
      return (
        <>
          <div>
            <article data-turn-id="turn-1">
              Question
            </article>
          </div>
          <ChatTurnNavigationRail navigation={navigation} />
        </>
      );
    }

    const view = render(<Harness />);
    fireEvent.mouseEnter(view.getByRole("button"));
    expect(view.getByRole("tooltip").textContent).not.toContain("Partial");
    expect(subscribeReader).not.toHaveBeenCalled();
    const previewCallsBeforeToken = getPreview.mock.calls.length;

    controlled.pushPartial("Partial response");
    await Promise.resolve();
    expect(getPreview).toHaveBeenCalledTimes(previewCallsBeforeToken);
    expect(view.getByRole("tooltip").textContent).not.toContain("Partial");

    controlled.complete();
    await vi.waitFor(() => {
      expect(view.getByRole("tooltip").textContent).toContain("Final response");
    });
    expect(subscribeReader).not.toHaveBeenCalled();
  });

  it("clamps the Preview Tooltip inside its layout", async () => {
    const runtime = createHistoryRuntime();
    runtimes.push(runtime);

    function Harness() {
      const navigation = useChatTurnNavigation({
        runtime,
        getPreview: ({ inputMessage }) => ({
          title: String(inputMessage.content),
          ariaLabel: "Turn preview",
        }),
      });
      return (
        <div className="layout">
          <nav />
          <div>
            <article data-turn-id="turn-1">
                First
            </article>
          </div>
          <ChatTurnNavigationRail
            navigation={navigation}
            markerClassName="marker"
            tooltipClassName="tooltip"
          />
        </div>
      );
    }

    const view = render(<Harness />);
    const layout = view.container.querySelector<HTMLElement>(".layout")!;
    const firstMarker = view.getByRole("button", {
      name: "Jump to user message 1",
    });
    const lastMarker = view.getByRole("button", {
      name: "Jump to user message 2",
    });
    layout.getBoundingClientRect = () => createRect({ top: 0, height: 200 });
    firstMarker.getBoundingClientRect = () => createRect({ top: 2, height: 12 });
    lastMarker.getBoundingClientRect = () => createRect({ top: 186, height: 12 });
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    const rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        if (this.classList.contains("tooltip")) {
          return createRect({ top: -42, height: 100 });
        }
        return originalRect.call(this);
      });

    fireEvent.mouseEnter(firstMarker);

    await vi.waitFor(() => {
      expect(view.getByRole("tooltip").style.top).toBe("58px");
    });

    fireEvent.mouseLeave(firstMarker);
    fireEvent.mouseEnter(lastMarker);
    await vi.waitFor(() => {
      expect(view.getByRole("tooltip").style.top).toBe("142px");
    });
    rectSpy.mockRestore();
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

function createControlledPreviewSource(finalResponse: string) {
  const messageStore = createMessageStore<DemoMessage>();
  let inputMessage: DemoMessage | undefined;
  let release: (() => void) | undefined;
  const completion = new Promise<void>((resolve) => {
    release = resolve;
  });
  const source: AnswerSource<string, DemoMessage> = {
    id: "controlled-agent",
    messageReader: messageStore,
    async *run(_input, context) {
      inputMessage = context.inputMessage as DemoMessage;
      messageStore.appendMessage(inputMessage);
      yield { type: "branch-started" };
      await completion;
      yield { type: "branch-completed" };
    },
  };
  const setResponse = (content: string) => {
    messageStore.setMessages([
      ...(inputMessage ? [inputMessage] : []),
      {
        id: "controlled-assistant",
        role: "assistant",
        content,
      },
    ]);
  };

  return {
    source,
    pushPartial: setResponse,
    complete() {
      setResponse(finalResponse);
      release?.();
    },
  };
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
