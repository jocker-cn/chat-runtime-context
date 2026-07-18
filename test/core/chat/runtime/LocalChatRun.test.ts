import {
  AbstractAgent,
  type BaseEvent,
  type Message,
  type RunAgentInput,
} from "@ag-ui/client";
import { EMPTY, type Observable } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import {
  CompareChatRuntime,
  SingleAgentRuntime,
  createAgUiAgentSource,
  createMessageStore,
  type AnswerSource,
  type ChatRuntime,
} from "../../../../src/core";

describe("ChatRuntime local runs", () => {
  it("keeps backend send and local message delivery as separate source paths", async () => {
    const agent = new RecordingAgent();
    const source = createAgUiAgentSource<string>({
      id: "agent",
      agent,
    });
    let turnSequence = 0;
    const runtime = new SingleAgentRuntime<string, Message>({
      source,
      createTurnId: () => `turn-${++turnSequence}`,
      createInputMessage: (input, turnId) => ({
        id: `${turnId}:input`,
        role: "user",
        content: input,
      }),
    });
    const runtimeContract: ChatRuntime<string, Message> = runtime;

    await runtime.send("normal message");
    await vi.waitFor(() => expect(runtime.getSnapshot().status).toBe("idle"));
    expect(agent.addMessagesCalls).toBe(1);
    expect(agent.addMessageCalls).toBe(0);

    const errorMessage: Message = {
      id: "connection-error",
      role: "activity",
      activityType: "error",
      content: { message: "Connection interrupted." },
    };
    const handle = await runtimeContract.sendLocalMessage(errorMessage);
    await vi.waitFor(() => expect(runtime.getSnapshot().status).toBe("idle"));

    const snapshot = runtime.getSnapshot();
    const localTurn = snapshot.turnsById[handle.turnId];
    const localBranch = snapshot.branchesById[handle.branchIds[0]!];

    expect(agent.runCalls).toBe(1);
    expect(agent.addMessagesCalls).toBe(1);
    expect(agent.addMessageCalls).toBe(1);
    expect(localTurn.inputMessage).toBeUndefined();
    expect(localBranch.status).toBe("completed");
    expect(localBranch.messageReader.getMessages()).toEqual([errorMessage]);
    expect(agent.messages.at(-1)).toBe(errorMessage);

    await runtime.dispose();
  });

  it("uses a local user message as the Turn input without duplicating it in the answer branch", async () => {
    const agent = new RecordingAgent();
    const source = createAgUiAgentSource<string>({ agent });
    const runtime = new SingleAgentRuntime<string, Message>({
      source,
      createTurnId: () => "user-error-turn",
      createInputMessage: () => {
        throw new Error("sendLocalMessage must not create an input message");
      },
    });
    const userError: Message = {
      id: "user-error",
      role: "user",
      content: "This message could not be sent.",
    };

    const handle = await runtime.sendLocalMessage(userError, {
      placement: "input",
    });
    await vi.waitFor(() => expect(runtime.getSnapshot().status).toBe("idle"));

    const snapshot = runtime.getSnapshot();
    const turn = snapshot.turnsById[handle.turnId];
    const branch = snapshot.branchesById[handle.branchIds[0]!];

    expect(agent.runCalls).toBe(0);
    expect(turn.inputMessage).toBe(userError);
    expect(branch.messageReader.getMessages()).toEqual([]);
    expect(agent.messages).toEqual([userError]);

    await runtime.removeTurn(handle.turnId, {
      deleteMessages: true,
      includeInput: true,
    });
    expect(agent.messages).toEqual([]);
    expect(runtime.getSnapshot().turnIds).toEqual([]);

    await runtime.dispose();
  });

  it("rejects local delivery before creating topology when a source has no local path", async () => {
    const source: AnswerSource<string, Message> = {
      id: "backend-only",
      async *run() {
        yield { type: "branch-completed" };
      },
    };
    const runtime = new SingleAgentRuntime<string, Message>({
      source,
      createInputMessage: (input, turnId) => ({
        id: `${turnId}:input`,
        role: "user",
        content: input,
      }),
    });

    await expect(
      runtime.sendLocalMessage({
        id: "local-message",
        role: "assistant",
        content: "local message",
      }),
    ).rejects.toThrow("does not support local messages");
    expect(runtime.getSnapshot()).toMatchObject({
      status: "idle",
      turnIds: [],
      turnsById: {},
      branchesById: {},
    });

    await runtime.dispose();
  });

  it("requires one explicit Source in Compare mode and only updates that Source", async () => {
    const agentA = new RecordingAgent();
    const agentB = new RecordingAgent();
    const runtime = new CompareChatRuntime<string, Message>({
      createTurnId: () => "compare-error-turn",
      createInputMessage: (input, turnId) => ({
        id: `${turnId}:input`,
        role: "user",
        content: input,
      }),
      sources: [
        {
          branchId: "agent-a",
          source: createAgUiAgentSource<string>({ agent: agentA }),
        },
        {
          branchId: "agent-b",
          source: createAgUiAgentSource<string>({ agent: agentB }),
        },
      ],
    });
    const errorMessage: Message = {
      id: "agent-b-error",
      role: "activity",
      activityType: "error",
      content: { message: "Agent B disconnected." },
    };

    await expect(runtime.sendLocalMessage(errorMessage)).rejects.toThrow(
      "requires branchId",
    );
    expect(runtime.getSnapshot().turnIds).toEqual([]);

    const handle = await runtime.sendLocalMessage(errorMessage, {
      branchId: "agent-b",
    });

    expect(handle.branchIds).toEqual(["compare-error-turn:agent-b"]);
    expect(agentA.messages).toEqual([]);
    expect(agentB.messages).toEqual([errorMessage]);
    expect(runtime.getSnapshot().status).toBe("idle");

    await runtime.dispose();
  });

  it("rejects a local message while a backend run is active", async () => {
    const messageStore = createMessageStore<Message>();
    const completion = deferred<void>();
    let localAddCalls = 0;
    const source: AnswerSource<string, Message> = {
      id: "controlled-source",
      messageReader: messageStore,
      async *run() {
        yield { type: "branch-started" };
        await completion.promise;
        yield { type: "branch-completed" };
      },
      addLocalMessage(message) {
        localAddCalls += 1;
        messageStore.appendMessage(message);
      },
    };
    const runtime = new SingleAgentRuntime<string, Message>({
      source,
      createInputMessage: (input, turnId) => ({
        id: `${turnId}:input`,
        role: "user",
        content: input,
      }),
    });

    await runtime.send("backend message");
    await vi.waitFor(() => expect(runtime.getSnapshot().status).toBe("running"));

    await expect(
      runtime.sendLocalMessage({
        id: "local-error",
        role: "activity",
        activityType: "error",
        content: { message: "Disconnected." },
      }),
    ).rejects.toThrow("cannot send while a turn is running");
    expect(localAddCalls).toBe(0);
    expect(runtime.getSnapshot().turnIds).toHaveLength(1);

    completion.resolve(undefined);
    await vi.waitFor(() => expect(runtime.getSnapshot().status).toBe("idle"));
    await runtime.dispose();
  });

  it("finalizes a synchronous local source failure without leaving an active run", async () => {
    const sourceError = new Error("local add failed");
    const source: AnswerSource<string, Message> = {
      id: "failing-local-source",
      messageReader: createMessageStore<Message>(),
      async *run() {
        yield { type: "branch-completed" };
      },
      addLocalMessage() {
        throw sourceError;
      },
    };
    const runtime = new SingleAgentRuntime<string, Message>({
      source,
      createTurnId: () => "failing-local-turn",
      createInputMessage: (input, turnId) => ({
        id: `${turnId}:input`,
        role: "user",
        content: input,
      }),
    });

    const handle = await runtime.sendLocalMessage({
      id: "local-message",
      role: "assistant",
      content: "local message",
    });
    await vi.waitFor(() => expect(runtime.getSnapshot().status).toBe("error"));

    const snapshot = runtime.getSnapshot();
    expect(snapshot.activeTurnId).toBeUndefined();
    const branch = snapshot.branchesById[handle.branchIds[0]!]!;
    expect(branch.status).toBe("error");
    expect(branch.error).toBe(sourceError);

    await runtime.dispose();
  });
});

class RecordingAgent extends AbstractAgent {
  public runCalls = 0;
  public addMessageCalls = 0;
  public addMessagesCalls = 0;

  run(_input: RunAgentInput): Observable<BaseEvent> {
    this.runCalls += 1;
    return EMPTY;
  }

  override addMessage(message: Message): void {
    this.addMessageCalls += 1;
    super.addMessage(message);
  }

  override addMessages(messages: Message[]): void {
    this.addMessagesCalls += 1;
    super.addMessages(messages);
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}
