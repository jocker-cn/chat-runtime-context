import type { Message } from "@ag-ui/client";
import { describe, expect, it, vi } from "vitest";
import {
  SingleAgentRuntime,
  type AnswerSource,
  type ChatSourceRunContext,
} from "../../../../src/core";

describe("CompareChatRuntime turn isolation", () => {
  it("rejects a direct send while another turn is running", async () => {
    const source = new ControlledAnswerSource();
    const runtime = new SingleAgentRuntime<string, Message>({
      source,
      createInputMessage: (input, turnId) => ({
        id: `${turnId}:input`,
        role: "user",
        content: input,
      }),
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
    runtime.dispose();
  });
});

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
