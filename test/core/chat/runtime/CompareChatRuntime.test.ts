import type { Message } from "@ag-ui/client";
import { describe, expect, it, vi } from "vitest";
import {
  BaseChatRuntime,
  CompareChatRuntime,
  SingleAgentRuntime,
  createInitialChatRuntimeSnapshot,
  type AnswerSource,
  type ChatRunHandle,
  type ChatSourceRunContext,
  type CompareChatRuntimeOptions,
} from "../../../../src/core";

const createInputMessage = (input: string, turnId: string): Message => ({
  id: `${turnId}:input`,
  role: "user",
  content: input,
});

describe("CompareChatRuntime source invariants", () => {
  it("requires at least one source", () => {
    expect(
      () =>
        new CompareChatRuntime<string, Message>({
          sources: [],
          createInputMessage,
        }),
    ).toThrow("at least one answer source");
  });

  it("requires the runtime to own input-message creation", () => {
    const options = {
      sources: [{ source: new FiniteAnswerSource() }],
    } as unknown as CompareChatRuntimeOptions<string, Message>;

    expect(() => new CompareChatRuntime(options)).toThrow(
      "requires createInputMessage",
    );
  });

  it.each([
    { branchIds: [], error: "at least one source branch" },
    { branchIds: ["missing"], error: "Unknown source branch ID" },
  ])(
    "rejects an invalid branch selection before creating a turn: $branchIds",
    async ({ branchIds, error }) => {
      const source = new FiniteAnswerSource("source-a");
      const runtime = new CompareChatRuntime<string, Message>({
        sources: [{ source, branchId: "a" }],
        createInputMessage,
      });

      await expect(runtime.send("hello", { branchIds })).rejects.toThrow(error);

      expect(source.runCount).toBe(0);
      expect(runtime.getSnapshot()).toMatchObject({
        status: "idle",
        activeTurnId: undefined,
        turnIds: [],
        turnsById: {},
        branchesById: {},
      });
      await runtime.dispose();
    },
  );

  it("selects a new turn automatically when it has one branch", async () => {
    const runtime = new SingleAgentRuntime<string, Message>({
      source: new FiniteAnswerSource(),
      createInputMessage,
      createTurnId: () => "turn-1",
    });

    const handle = await runtime.send("hello");
    const turn = runtime.getSnapshot().turnsById[handle.turnId];

    expect(handle.branchIds).toEqual(["turn-1:main"]);
    expect(turn.selectedBranchId).toBe(handle.branchIds[0]);
    await vi.waitFor(() => expect(runtime.getSnapshot().status).toBe("idle"));
    expect(turn.branchIds).toHaveLength(1);
    expect(
      runtime.getSnapshot().branchesById[handle.branchIds[0]].messageReader
        .getMessages(),
    ).toEqual([]);
    await runtime.dispose();
  });

  it("registers active runs before publishing the running snapshot", async () => {
    const source = new FiniteAnswerSource();
    const runtime = new SingleAgentRuntime<string, Message>({
      source,
      createInputMessage,
      createTurnId: () => "turn-1",
    });
    let cancellation: Promise<void> | undefined;
    runtime.subscribe(() => {
      if (runtime.getSnapshot().status === "running" && !cancellation) {
        cancellation = runtime.cancel();
      }
    });

    const handle = await runtime.send("hello");
    await cancellation;

    expect(source.runCount).toBe(0);
    expect(source.cancelCount).toBe(1);
    expect(runtime.getSnapshot().status).toBe("idle");
    expect(
      runtime.getSnapshot().branchesById[handle.branchIds[0]].status,
    ).toBe("cancelled");
    await runtime.dispose();
  });
});

describe("CompareChatRuntime source terminal state", () => {
  it("waits for iterator completion and retains messages emitted after branch-completed", async () => {
    const source = new CompletedThenFinalMessageSource();
    const runtime = new SingleAgentRuntime<string, Message>({
      source,
      createInputMessage,
      createTurnId: () => "turn-1",
    });

    const handle = await runtime.send("hello");
    const branchId = handle.branchIds[0];
    await vi.waitFor(() => expect(source.terminalEmitted).toBe(true));

    expect(runtime.getSnapshot().status).toBe("running");
    expect(runtime.getSnapshot().branchesById[branchId].status).toBe("running");

    source.finish();

    await vi.waitFor(() => expect(runtime.getSnapshot().status).toBe("idle"));
    const branch = runtime.getSnapshot().branchesById[branchId];
    expect(branch.status).toBe("completed");
    expect(branch.messageReader.getMessages().map((message) => message.id))
      .toEqual(["before-terminal", "after-terminal"]);
    await runtime.dispose();
  });

  it("commits branch-error only after the iterator finishes", async () => {
    const sourceError = new Error("backend failed");
    const source = new ErrorThenFinalMessageSource(sourceError);
    const runtime = new SingleAgentRuntime<string, Message>({
      source,
      createInputMessage,
      createTurnId: () => "turn-1",
    });

    const handle = await runtime.send("hello");
    const branchId = handle.branchIds[0];
    await vi.waitFor(() => expect(source.terminalEmitted).toBe(true));

    expect(runtime.getSnapshot().status).toBe("running");
    expect(runtime.getSnapshot().branchesById[branchId].status).toBe("running");

    source.finish();

    await vi.waitFor(() => expect(runtime.getSnapshot().status).toBe("error"));
    const branch = runtime.getSnapshot().branchesById[branchId];
    expect(branch.status).toBe("error");
    expect(branch.error).toBe(sourceError);
    expect(branch.messageReader.getMessages().map((message) => message.id))
      .toEqual(["after-error"]);
    await runtime.dispose();
  });

  it("treats normal iterator completion without a terminal event as completed", async () => {
    const runtime = new SingleAgentRuntime<string, Message>({
      source: new FiniteAnswerSource(),
      createInputMessage,
      createTurnId: () => "turn-1",
    });

    const handle = await runtime.send("hello");
    const branchId = handle.branchIds[0];

    await vi.waitFor(() => expect(runtime.getSnapshot().status).toBe("idle"));
    expect(runtime.getSnapshot().branchesById[branchId].status).toBe("completed");
    await runtime.dispose();
  });
});

describe("CompareChatRuntime async lifecycle", () => {
  it("blocks a new send while an idle reset is in progress", async () => {
    const source = new FiniteAnswerSource();
    const runtime = new SingleAgentRuntime<string, Message>({
      source,
      createInputMessage,
    });

    const reset = runtime.reset();
    await expect(runtime.send("racing input")).rejects.toThrow("resetting");
    await reset;

    expect(source.runCount).toBe(0);
    expect(runtime.getSnapshot()).toMatchObject({
      status: "idle",
      turnIds: [],
      turnsById: {},
      branchesById: {},
    });
    await runtime.dispose();
  });

  it("waits for an asynchronous source cancellation", async () => {
    const source = new AsyncLifecycleAnswerSource();
    const runtime = new SingleAgentRuntime<string, Message>({
      source,
      createInputMessage,
      createTurnId: () => "turn-1",
    });
    const handle = await runtime.send("hello");
    const branchId = handle.branchIds[0];
    await vi.waitFor(() => {
      expect(source.started).toBe(true);
      expect(runtime.getSnapshot().branchesById[branchId].status).toBe("running");
    });

    let settled = false;
    const cancellation = runtime.cancel().then(() => {
      settled = true;
    });
    await vi.waitFor(() => expect(source.cancelCalls).toBe(1));

    expect(source.signal?.aborted).toBe(true);
    expect(settled).toBe(false);
    expect(runtime.getSnapshot().status).toBe("running");

    source.resolveCancel();
    await cancellation;

    expect(runtime.getSnapshot().status).toBe("idle");
    expect(runtime.getSnapshot().branchesById[branchId].status).toBe("cancelled");
    source.resolveDispose();
    await runtime.dispose();
  });

  it("waits for active cancellation and asynchronous source disposal", async () => {
    const source = new AsyncLifecycleAnswerSource();
    const runtime = new SingleAgentRuntime<string, Message>({
      source,
      createInputMessage,
    });
    const handle = await runtime.send("hello");
    await vi.waitFor(() => {
      expect(source.started).toBe(true);
      expect(runtime.getSnapshot().branchesById[handle.branchIds[0]].status)
        .toBe("running");
    });

    let settled = false;
    const disposal = runtime.dispose().then(() => {
      settled = true;
    });
    await vi.waitFor(() => expect(source.cancelCalls).toBe(1));
    expect(source.disposeCalls).toBe(0);
    expect(settled).toBe(false);

    source.resolveCancel();
    await vi.waitFor(() => expect(source.disposeCalls).toBe(1));
    expect(runtime.getSnapshot().status).not.toBe("closed");
    expect(settled).toBe(false);

    source.resolveDispose();
    await disposal;

    expect(runtime.getSnapshot().status).toBe("closed");
  });
});

describe("BaseChatRuntime disposal", () => {
  it("notifies current subscribers of the closed snapshot", () => {
    const runtime = new TestBaseRuntime();
    const observedStatuses: string[] = [];
    runtime.subscribe(() => {
      observedStatuses.push(runtime.getSnapshot().status);
    });

    runtime.dispose();

    expect(observedStatuses).toEqual(["closed"]);
    expect(runtime.getSnapshot().status).toBe("closed");
  });
});

describe("CompareChatRuntime turn isolation", () => {
  it("rejects a direct send while another turn is running", async () => {
    const source = new ControlledAnswerSource();
    const runtime = new SingleAgentRuntime<string, Message>({
      source,
      createInputMessage,
    });

    await runtime.send("first");
    await vi.waitFor(() => expect(source.inputs).toEqual(["first"]));

    await expect(runtime.send("second")).rejects.toThrow(
      "ChatRuntime cannot send while a turn is running",
    );
    expect(runtime.getSnapshot().turnIds).toHaveLength(1);
    expect(source.inputs).toEqual(["first"]);

    source.complete("first");
    await vi.waitFor(() =>
      expect(runtime.getSnapshot().status).toBe("idle"),
    );
    await runtime.dispose();
  });
});

class FiniteAnswerSource implements AnswerSource<string, Message> {
  public runCount = 0;
  public cancelCount = 0;

  constructor(public readonly id = "finite") {}

  async *run() {
    this.runCount += 1;
    yield { type: "branch-started" as const };
  }

  cancel() {
    this.cancelCount += 1;
  }
}

class CompletedThenFinalMessageSource implements AnswerSource<string, Message> {
  public readonly id = "completed-then-final-message";
  public terminalEmitted = false;
  private readonly completion = deferred<void>();

  async *run() {
    yield { type: "branch-started" as const };
    yield {
      type: "message" as const,
      message: assistantMessage("before-terminal"),
    };
    this.terminalEmitted = true;
    yield { type: "branch-completed" as const };
    await this.completion.promise;
    yield {
      type: "message" as const,
      message: assistantMessage("after-terminal"),
    };
  }

  finish() {
    this.completion.resolve(undefined);
  }
}

class ErrorThenFinalMessageSource implements AnswerSource<string, Message> {
  public readonly id = "error-then-final-message";
  public terminalEmitted = false;
  private readonly completion = deferred<void>();

  constructor(private readonly sourceError: Error) {}

  async *run() {
    yield { type: "branch-started" as const };
    this.terminalEmitted = true;
    yield { type: "branch-error" as const, error: this.sourceError };
    await this.completion.promise;
    yield {
      type: "message" as const,
      message: assistantMessage("after-error"),
    };
  }

  finish() {
    this.completion.resolve(undefined);
  }
}

class AsyncLifecycleAnswerSource implements AnswerSource<string, Message> {
  public readonly id = "async-lifecycle";
  public started = false;
  public signal?: AbortSignal;
  public cancelCalls = 0;
  public disposeCalls = 0;
  private readonly cancellation = deferred<void>();
  private readonly disposal = deferred<void>();

  async *run(_input: string, context: ChatSourceRunContext) {
    this.signal = context.signal;
    this.started = true;
    yield { type: "branch-started" as const };
    await new Promise<void>((resolve) => {
      if (context.signal.aborted) {
        resolve();
        return;
      }
      context.signal.addEventListener("abort", () => resolve(), { once: true });
    });
  }

  async cancel() {
    this.cancelCalls += 1;
    await this.cancellation.promise;
  }

  async dispose() {
    this.disposeCalls += 1;
    await this.disposal.promise;
  }

  resolveCancel() {
    this.cancellation.resolve(undefined);
  }

  resolveDispose() {
    this.disposal.resolve(undefined);
  }
}

class TestBaseRuntime extends BaseChatRuntime<string, Message> {
  constructor() {
    super(createInitialChatRuntimeSnapshot());
  }

  async send(): Promise<ChatRunHandle> {
    return { turnId: "unused", branchIds: [] };
  }
}

function assistantMessage(id: string): Message {
  return {
    id,
    role: "assistant",
    content: id,
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

class ControlledAnswerSource implements AnswerSource<string, Message> {
  public readonly id = "controlled";
  public readonly inputs: string[] = [];
  private readonly resolvers = new Map<string, () => void>();

  async *run(
    input: string,
    _context: ChatSourceRunContext,
  ) {
    this.inputs.push(input);
    yield { type: "branch-started" as const };
    await new Promise<void>((resolve) => {
      this.resolvers.set(input, resolve);
    });
    yield { type: "branch-completed" as const };
  }

  complete(input: string) {
    this.resolvers.get(input)?.();
    this.resolvers.delete(input);
  }
}
