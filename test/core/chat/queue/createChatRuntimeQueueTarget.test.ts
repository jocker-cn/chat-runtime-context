import type { Message } from "@ag-ui/client";
import { describe, expect, it, vi } from "vitest";
import {
  SingleAgentRuntime,
  createChatRuntimeQueueTarget,
  createMessageStore,
  createQueueScheduler,
  createSubmissionQueue,
  type AnswerSource,
  type ChatSourceRunContext,
} from "../../../../src/core";

interface TestPayload {
  text: string;
}

describe("createChatRuntimeQueueTarget", () => {
  it("keeps later submissions queued until the active turn completes", async () => {
    const source = new ControlledAnswerSource();
    const runtime = new SingleAgentRuntime<string, Message>({
      source,
      createInputMessage: (input, turnId) => ({
        id: `${turnId}:input`,
        role: "user",
        content: input,
      }),
    });
    const queue = createSubmissionQueue<TestPayload>();
    const scheduler = createQueueScheduler({
      queue,
      target: createChatRuntimeQueueTarget<TestPayload, string>({
        runtime,
        toInput: (item) => item.payload.text,
      }),
    });

    const first = queue.enqueue({ text: "first" });
    const second = queue.enqueue({ text: "second" });

    await vi.waitFor(() => expect(source.inputs).toEqual(["first"]));
    expect(queue.has(first.id)).toBe(false);
    expect(queue.has(second.id)).toBe(true);
    expect(runtime.getSnapshot().turnIds).toHaveLength(1);

    const firstTurnId = runtime.getSnapshot().turnIds[0];
    const firstBranchId = runtime.getSnapshot().turnsById[firstTurnId].branchIds[0];
    const firstBranch = runtime.getSnapshot().branchesById[firstBranchId];
    expect(firstBranch.messageReader.getMessages().map((message) => message.id))
      .toEqual([`${firstTurnId}:answer`]);

    source.complete("first");
    await vi.waitFor(() => expect(source.inputs).toEqual(["first", "second"]));
    expect(queue.has(second.id)).toBe(false);
    expect(runtime.getSnapshot().turnIds).toHaveLength(2);

    const secondTurnId = runtime.getSnapshot().turnIds[1];
    const secondBranchId = runtime.getSnapshot().turnsById[secondTurnId].branchIds[0];
    const secondBranch = runtime.getSnapshot().branchesById[secondBranchId];
    expect(firstBranch.messageReader.getMessages().map((message) => message.id))
      .toEqual([`${firstTurnId}:answer`]);
    expect(secondBranch.messageReader.getMessages().map((message) => message.id))
      .toEqual([`${secondTurnId}:answer`]);

    source.complete("second");
    await vi.waitFor(() =>
      expect(runtime.getSnapshot().status).toBe("idle"),
    );

    scheduler.dispose();
    await runtime.dispose();
  });

  it("blocks queued submissions after a runtime error by default", async () => {
    const source = new ControlledAnswerSource();
    const runtime = new SingleAgentRuntime<string, Message>({
      source,
      createInputMessage: (input, turnId) => ({
        id: `${turnId}:input`,
        role: "user",
        content: input,
      }),
    });
    const queue = createSubmissionQueue<TestPayload>();
    const scheduler = createQueueScheduler({
      queue,
      target: createChatRuntimeQueueTarget<TestPayload, string>({
        runtime,
        toInput: (item) => item.payload.text,
      }),
    });

    const first = queue.enqueue({ text: "first" });
    const second = queue.enqueue({ text: "second" });
    await vi.waitFor(() => expect(source.inputs).toEqual(["first"]));

    source.fail("first", new Error("backend unavailable"));

    await vi.waitFor(() =>
      expect(scheduler.getSnapshot().status).toBe("blocked"),
    );
    expect(runtime.getSnapshot().status).toBe("error");
    expect(queue.has(first.id)).toBe(false);
    expect(queue.has(second.id)).toBe(true);
    expect(source.inputs).toEqual(["first"]);

    scheduler.dispose();
    await runtime.dispose();
  });
});

class ControlledAnswerSource implements AnswerSource<string, Message> {
  public readonly id = "controlled";
  public readonly inputs: string[] = [];
  public readonly messageReader = createMessageStore<Message>();
  private readonly resolvers = new Map<
    string,
    { resolve(): void; reject(error: unknown): void }
  >();

  async *run(
    input: string,
    context: ChatSourceRunContext,
  ) {
    this.inputs.push(input);
    if (context.inputMessage) {
      this.messageReader.appendMessage(context.inputMessage);
    }
    this.messageReader.appendMessage({
      id: `${context.turnId}:answer`,
      role: "assistant",
      content: `answer:${input}`,
    });
    yield { type: "branch-started" as const };
    await new Promise<void>((resolve, reject) => {
      this.resolvers.set(input, { resolve, reject });
    });
    yield { type: "branch-completed" as const };
  }

  complete(input: string) {
    this.resolvers.get(input)?.resolve();
    this.resolvers.delete(input);
  }

  fail(input: string, error: unknown) {
    this.resolvers.get(input)?.reject(error);
    this.resolvers.delete(input);
  }
}
