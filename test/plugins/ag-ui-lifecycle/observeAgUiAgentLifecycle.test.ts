import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { Observable } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import {
  observeAgUiAgentLifecycle,
  type AgUiLifecycleNotification,
} from "../../../src/plugins/ag-ui-lifecycle";

describe("observeAgUiAgentLifecycle", () => {
  it("reports protocol events and post-merge Messages without owning business state", async () => {
    const notifications: AgUiLifecycleNotification[] = [];
    const agent = new SnapshotAgent();
    let observedAt = 100;
    const unsubscribe = observeAgUiAgentLifecycle(agent, {
      sourceId: "agent-a",
      now: () => observedAt++,
      onNotification: (notification) => notifications.push(notification),
    });

    await agent.runAgent();

    expect(notifications.map((notification) => notification.type)).toEqual([
      "run-initialized",
      "event",
      "event",
      "messages-changed",
      "event",
      "run-finalized",
    ]);
    const snapshot = notifications.find(
      (notification) =>
        notification.type === "event" &&
        notification.event.type === EventType.MESSAGES_SNAPSHOT,
    );
    expect(snapshot).toMatchObject({
      sourceId: "agent-a",
      observedAt: 102,
      threadId: expect.any(String),
      runId: expect.any(String),
      event: {
        type: EventType.MESSAGES_SNAPSHOT,
        messages: [
          { id: "assistant-1", role: "assistant", content: "merged" },
        ],
      },
    });
    const merged = notifications.find(
      (notification) => notification.type === "messages-changed",
    );
    expect(merged?.messages).toEqual([
      { id: "assistant-1", role: "assistant", content: "merged" },
    ]);

    unsubscribe();
    notifications.length = 0;
    await agent.runAgent();
    expect(notifications).toEqual([]);
  });

  it("reports failures through the lifecycle callback", async () => {
    const onNotification = vi.fn();
    const agent = new FailingAgent();
    observeAgUiAgentLifecycle(agent, {
      sourceId: "agent-error",
      onNotification,
    });

    await expect(agent.runAgent()).rejects.toThrow("backend failed");

    expect(onNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "run-failed",
        sourceId: "agent-error",
        error: expect.objectContaining({ message: "backend failed" }),
      }),
    );
    expect(onNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "run-finalized",
        sourceId: "agent-error",
      }),
    );
  });
});

class SnapshotAgent extends AbstractAgent {
  run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable((subscriber) => {
      subscriber.next({
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      });
      subscriber.next({
        type: EventType.MESSAGES_SNAPSHOT,
        messages: [
          { id: "assistant-1", role: "assistant", content: "merged" },
        ],
      });
      subscriber.next({
        type: EventType.RUN_FINISHED,
        threadId: input.threadId,
        runId: input.runId,
        outcome: { type: "success" },
      });
      subscriber.complete();
    });
  }
}

class FailingAgent extends AbstractAgent {
  run(_input: RunAgentInput): Observable<BaseEvent> {
    return new Observable((subscriber) => {
      subscriber.error(new Error("backend failed"));
    });
  }
}
