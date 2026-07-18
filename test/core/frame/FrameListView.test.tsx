/** @vitest-environment jsdom */

import type { Message } from "@ag-ui/client";
import { useEffect } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { BranchRenderState } from "../../../src/core/chat/context/ChatContext";
import type {
  ChatBranch,
  MessageReader,
} from "../../../src/core/chat/contracts/chat-runtime";
import { FrameListView } from "../../../src/core/chat/frame/FrameListView";
import {
  createFrameRenderer,
  type FrameCardProps,
} from "../../../src/core/chat/frame/createFrameRenderer";
import type { MessageRenderContext } from "../../../src/core/chat/frame/types";

type TestMessage = Extract<Message, { role: "assistant" }> & {
  content: string;
};

const messageReader: MessageReader<TestMessage> = {
  subscribe: () => () => undefined,
  getMessages: () => [],
};

describe("FrameListView message isolation", () => {
  afterEach(() => cleanup());

  it("keeps message contexts stable when only the live message changes", () => {
    const history = assistantMessage("history", "fixed");
    const live = assistantMessage("live", "partial");
    const contexts = new Map<string, MessageRenderContext[]>();
    const mounts = new Map<string, number>();

    function Card({ message, context }: FrameCardProps<TestMessage>) {
      append(contexts, message.id, context);

      useEffect(() => {
        increment(mounts, message.id);
      }, [message.id]);

      return <div data-testid={`card-${message.id}`}>{message.content}</div>;
    }

    const renderer = createFrameRenderer<TestMessage>({
      cards: { assistant: Card },
    });
    const branch = createBranch();
    const { rerender } = renderFrameList({
      renderer,
      state: createState(branch, [history, live]),
    });

    rerender(
      <FrameListView
        branchId={branch.id}
        renderer={renderer}
        state={createState(branch, [
          history,
          assistantMessage("live", "complete"),
        ])}
      />,
    );

    expect(screen.getByTestId("card-live").textContent).toBe("complete");
    expect(contexts.get("history")).toHaveLength(1);
    expect(contexts.get("live")).toHaveLength(2);
    expect(contexts.get("live")?.[1]).toBe(contexts.get("live")?.[0]);
    expect(mounts.get("history")).toBe(1);
    expect(mounts.get("live")).toBe(1);
  });

  it("ignores branch object churn outside the render context", () => {
    const message = assistantMessage("history", "fixed");
    const contexts: MessageRenderContext[] = [];
    let renders = 0;
    let mounts = 0;
    let unmounts = 0;

    function Card({ context }: FrameCardProps<TestMessage>) {
      renders += 1;
      contexts.push(context);

      useEffect(() => {
        mounts += 1;
        return () => {
          unmounts += 1;
        };
      }, []);

      return <div data-testid="stable-context">fixed</div>;
    }

    const renderer = createFrameRenderer<TestMessage>({
      cards: { assistant: Card },
    });
    const branch = createBranch();
    const { rerender } = renderFrameList({
      renderer,
      state: createState(branch, [message]),
    });

    rerender(
      <FrameListView
        branchId={branch.id}
        renderer={renderer}
        state={createState({ ...branch, error: new Error("ignored") }, [
          message,
        ])}
      />,
    );

    expect(screen.getByTestId("stable-context").textContent).toBe("fixed");
    expect(renders).toBe(1);
    expect(contexts).toHaveLength(1);
    expect(mounts).toBe(1);
    expect(unmounts).toBe(0);
  });

  it("rerenders context changes without remounting the same card", () => {
    const message = assistantMessage("answer", "answer");
    const metadataOne = { version: 1 };
    const metadataTwo = { version: 2 };
    let renders = 0;
    let mounts = 0;
    let unmounts = 0;
    const contexts: MessageRenderContext[] = [];

    function Card({ context }: FrameCardProps<TestMessage>) {
      renders += 1;
      contexts.push(context);

      useEffect(() => {
        mounts += 1;
        return () => {
          unmounts += 1;
        };
      }, []);

      return (
        <div data-testid="context-value">
          {[
            context.branchStatus,
            context.branchMetadata?.version,
            context.selectedBranchId,
            String(context.isSelectedBranch),
            context.mode,
          ].join("|")}
        </div>
      );
    }

    const renderer = createFrameRenderer<TestMessage>({
      cards: { assistant: Card },
    });
    const runningBranch = createBranch({
      status: "running",
      metadata: metadataOne,
    });
    const { rerender } = renderFrameList({
      renderer,
      state: createState(runningBranch, [message], {
        selectedBranchId: runningBranch.id,
      }),
    });

    const completedBranch = createBranch({
      status: "completed",
      metadata: metadataOne,
    });
    rerender(
      <FrameListView
        branchId={completedBranch.id}
        renderer={renderer}
        state={createState(completedBranch, [message], {
          selectedBranchId: completedBranch.id,
        })}
      />,
    );

    const updatedMetadataBranch = createBranch({
      status: "completed",
      metadata: metadataTwo,
    });
    rerender(
      <FrameListView
        branchId={updatedMetadataBranch.id}
        renderer={renderer}
        state={createState(updatedMetadataBranch, [message], {
          selectedBranchId: updatedMetadataBranch.id,
        })}
      />,
    );

    rerender(
      <FrameListView
        branchId={updatedMetadataBranch.id}
        renderer={renderer}
        state={createState(updatedMetadataBranch, [message], {
          selectedBranchId: "another-branch",
        })}
      />,
    );

    rerender(
      <FrameListView
        branchId={updatedMetadataBranch.id}
        renderer={renderer}
        state={createState(updatedMetadataBranch, [message], {
          mode: "compare",
          selectedBranchId: "another-branch",
        })}
      />,
    );

    expect(screen.getByTestId("context-value").textContent).toBe(
      "completed|2|another-branch|false|compare",
    );
    expect(renders).toBe(5);
    expect(mounts).toBe(1);
    expect(unmounts).toBe(0);
    expect(new Set(contexts)).toHaveLength(5);
  });

  it("updates messageIndex after a prepend without remounting existing cards", () => {
    const answer = assistantMessage("answer", "answer");
    const renders = new Map<string, number>();
    const mounts = new Map<string, number>();
    const unmounts = new Map<string, number>();
    const indexes = new Map<string, number[]>();

    function Card({ message, context }: FrameCardProps<TestMessage>) {
      increment(renders, message.id);
      append(indexes, message.id, context.messageIndex);

      useEffect(() => {
        increment(mounts, message.id);
        return () => increment(unmounts, message.id);
      }, [message.id]);

      return (
        <div data-testid={`index-${message.id}`}>{context.messageIndex}</div>
      );
    }

    const renderer = createFrameRenderer<TestMessage>({
      cards: { assistant: Card },
    });
    const branch = createBranch();
    const { rerender } = renderFrameList({
      renderer,
      state: createState(branch, [answer]),
    });

    rerender(
      <FrameListView
        branchId={branch.id}
        renderer={renderer}
        state={createState(branch, [
          assistantMessage("prefix", "prefix"),
          answer,
        ])}
      />,
    );

    expect(screen.getByTestId("index-answer").textContent).toBe("1");
    expect(indexes.get("answer")).toEqual([0, 1]);
    expect(renders.get("answer")).toBe(2);
    expect(mounts.get("answer")).toBe(1);
    expect(unmounts.get("answer") ?? 0).toBe(0);
  });

  it("remounts when a renderer condition selects a different card type", () => {
    const message = assistantMessage("answer", "answer");
    let runningMounts = 0;
    let runningUnmounts = 0;
    let completedMounts = 0;
    let completedUnmounts = 0;

    function RunningCard() {
      useEffect(() => {
        runningMounts += 1;
        return () => {
          runningUnmounts += 1;
        };
      }, []);

      return <div data-testid="card-kind">running</div>;
    }

    function CompletedCard() {
      useEffect(() => {
        completedMounts += 1;
        return () => {
          completedUnmounts += 1;
        };
      }, []);

      return <div data-testid="card-kind">completed</div>;
    }

    const renderer = createFrameRenderer<TestMessage>({
      cards: {
        assistant: [
          {
            condition: (_message, context) =>
              context.branchStatus === "completed",
            card: CompletedCard,
          },
          { card: RunningCard },
        ],
      },
    });
    const runningBranch = createBranch({ status: "running" });
    const { rerender } = renderFrameList({
      renderer,
      state: createState(runningBranch, [message]),
    });

    const completedBranch = createBranch({ status: "completed" });
    rerender(
      <FrameListView
        branchId={completedBranch.id}
        renderer={renderer}
        state={createState(completedBranch, [message])}
      />,
    );

    expect(screen.getByTestId("card-kind").textContent).toBe("completed");
    expect(runningMounts).toBe(1);
    expect(runningUnmounts).toBe(1);
    expect(completedMounts).toBe(1);
    expect(completedUnmounts).toBe(0);
  });
});

function renderFrameList({
  renderer,
  state,
}: {
  renderer: ReturnType<typeof createFrameRenderer<TestMessage>>;
  state: BranchRenderState<TestMessage>;
}) {
  return render(
    <FrameListView
      branchId={state.branch?.id ?? "branch"}
      renderer={renderer}
      state={state}
    />,
  );
}

function createState(
  branch: ChatBranch<TestMessage>,
  messages: readonly TestMessage[],
  overrides: Partial<BranchRenderState<TestMessage>> = {},
): BranchRenderState<TestMessage> {
  return {
    branch,
    messages,
    mode: "single",
    selectedBranchId: undefined,
    threadId: "thread",
    ...overrides,
  };
}

function createBranch(
  overrides: Partial<ChatBranch<TestMessage>> = {},
): ChatBranch<TestMessage> {
  return {
    id: "branch",
    turnId: "turn",
    sourceId: "source",
    messageReader,
    status: "running",
    ...overrides,
  };
}

function assistantMessage(id: string, content: string): TestMessage {
  return { id, role: "assistant", content } as TestMessage;
}

function increment(target: Map<string, number>, key: string) {
  target.set(key, (target.get(key) ?? 0) + 1);
}

function append<T>(target: Map<string, T[]>, key: string, value: T) {
  const values = target.get(key) ?? [];
  values.push(value);
  target.set(key, values);
}
