import type { AbstractAgent, AgentSubscriberParams, BaseEvent } from "@ag-ui/client";
import type { ResponseTraceStore } from "../../features/ai-response-trace";
import { createBackendEventReporter } from "./backendEvents";
import { reportAgUiEvents } from "./agUiEvents";

export interface ResponseTraceMessageRef {
  sourceId?: string;
  messageId: string;
}

/** Independent AG-UI observer; never reads a Runtime or Turn/Branch. */
export function createAgUiResponseTraceObserver(store: ResponseTraceStore) {
  const messageResponses = new Map<string, string>();
  const stops = new Set<() => void>();
  const messageKey = (sourceId: string, messageId: string) => JSON.stringify([sourceId, messageId]);
  let disposed = false;

  return {
    observe(agent: AbstractAgent, sourceId: string): () => void {
      if (disposed) return () => {};
      let active = true;
      const runs = new Map<string, {
        initialMessageIds: Set<string>;
        report: ReturnType<typeof createBackendEventReporter>;
        native: boolean;
        pending: { event: BaseEvent; receivedAt: number }[];
      }>();
      const responseId = (input: AgentSubscriberParams["input"]) =>
        JSON.stringify([sourceId, input.threadId, input.runId]);
      const bind = (id: string, messages: AgentSubscriberParams["messages"]) => {
        const run = runs.get(id);
        if (!run) return;
        for (const message of messages) {
          if (!run.initialMessageIds.has(message.id)) messageResponses.set(messageKey(sourceId, message.id), id);
        }
      };
      // Observing a response must not interrupt the Agent's normal event handling.
      const safely = (handle: () => void) => {
        if (!active || disposed) return;
        try { handle(); } catch (error) { console.error("Response trace observer failed.", error); }
      };
      const subscription = agent.subscribe({
        onRunInitialized: ({ input, messages }) => safely(() => {
          runs.set(responseId(input), {
            initialMessageIds: new Set(messages.map((message) => message.id)),
            report: createBackendEventReporter(store),
            native: false,
            pending: [],
          });
        }),
        onEvent: ({ input, event, messages }) => safely(() => {
          const id = responseId(input);
          const run = runs.get(id);
          if (!run) return;
          bind(id, messages);
          const data = event as typeof event & { messageId?: string; source?: string; event?: unknown };
          if (typeof data.messageId === "string" && !run.initialMessageIds.has(data.messageId)) {
            messageResponses.set(messageKey(sourceId, data.messageId), id);
          }
          if (data.type === "RAW" && data.source === "copilot-backend") {
            run.native = true;
            run.pending = [];
            run.report(id, data.event);
          } else if (!run.native) {
            run.pending.push({ event: structuredClone(event), receivedAt: Date.now() });
          }
        }),
        onMessagesChanged: ({ input, messages }) => safely(() => {
          if (input) bind(responseId(input), messages);
        }),
        onRunErrorEvent: ({ input, event }) => safely(() => {
          const id = responseId(input);
          const run = runs.get(id);
          if (run?.native) run.report(id, { event: "error", error: event.message });
        }),
        onRunFailed: ({ input, error }) => safely(() => {
          const id = responseId(input);
          const run = runs.get(id);
          if (!run) return;
          if (run.native) run.report(id, { event: "error", error: error.message });
          else if (!run.pending.some((item) => item.event.type === "RUN_ERROR")) {
            run.pending.push({ event: { type: "RUN_ERROR", message: error.message } as BaseEvent, receivedAt: Date.now() });
          }
        }),
        onRunFinalized: ({ input }) => safely(() => {
          const id = responseId(input);
          const run = runs.get(id);
          if (run && !run.native) reportAgUiEvents(store, id, run.pending);
          runs.delete(id);
        }),
      });
      const stop = () => {
        if (!active) return;
        active = false;
        subscription.unsubscribe();
        runs.clear();
        stops.delete(stop);
      };
      stops.add(stop);
      return stop;
    },
    resolveMessage({ sourceId, messageId }: ResponseTraceMessageRef): string | undefined {
      return sourceId === undefined ? undefined : messageResponses.get(messageKey(sourceId, messageId));
    },
    dispose() {
      disposed = true;
      [...stops].forEach((stop) => stop());
      messageResponses.clear();
    },
  };
}
