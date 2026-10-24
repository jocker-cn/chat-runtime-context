import { useCallback, useSyncExternalStore } from "react";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import type { AgUiLifecycleNotification } from "../../plugins/ag-ui-lifecycle";

export interface ResponseTraceRef {
  sourceId: string;
  threadId: string;
  runId: string;
}

export type ResponseTraceOutcome = "completed" | "error" | "cancelled" | "interrupted" | "incomplete";
export interface ResponseTraceEvent {
  sequence: number;
  receivedAt: number;
  event: BaseEvent;
}

/** Display data reported by the integration; event names have no built-in semantics. */
export interface ResponseTraceEntry {
  id: string;
  event: string;
  content: unknown;
  startedAt: number;
  endedAt?: number;
  details?: unknown;
}

export type ResponseTraceProjector = (events: readonly ResponseTraceEvent[]) => readonly ResponseTraceEntry[];

export interface ResponseTraceRecord {
  ref: ResponseTraceRef;
  input: RunAgentInput;
  outcome: ResponseTraceOutcome;
  error?: string;
  startedAt: number;
  endedAt: number;
  events: readonly ResponseTraceEvent[];
  entries: readonly ResponseTraceEntry[];
  summary: { durationMs: number; eventCount: number };
}

export interface ResponseTraceState {
  status: "unavailable" | "recording" | "ready";
  record?: ResponseTraceRecord;
}

export interface ResponseTraceStore {
  record(notification: AgUiLifecycleNotification): void;
  markCancelled(ref: ResponseTraceRef): void;
  getSnapshot(ref?: ResponseTraceRef): ResponseTraceState;
  subscribe(ref: ResponseTraceRef | undefined, listener: () => void): () => void;
  dispose(): void;
}

const unavailable: ResponseTraceState = Object.freeze({ status: "unavailable" });
const recording: ResponseTraceState = Object.freeze({ status: "recording" });
const keyOf = (ref: ResponseTraceRef) => JSON.stringify([ref.sourceId, ref.threadId, ref.runId]);
type ProtocolEvent = BaseEvent & Record<string, unknown>;
type Run = {
  ref: ResponseTraceRef;
  input: RunAgentInput;
  startedAt: number;
  events: ResponseTraceEvent[];
  outcome?: ResponseTraceOutcome;
  error?: string;
  state: ResponseTraceState;
};

/** A session-owned recorder. No Runtime, message reader or mounted Card is required. */
export function createResponseTraceStore(options: {
  projectEvents?: ResponseTraceProjector;
} = {}): ResponseTraceStore {
  const runs = new Map<string, Run>();
  const listeners = new Map<string, Set<() => void>>();
  let disposed = false;
  const publish = (key: string) => listeners.get(key)?.forEach((listener) => listener());
  return {
    record(notification) {
      if (disposed || notification.type === "messages-changed") return;
      const ref = { sourceId: notification.sourceId, threadId: notification.threadId, runId: notification.runId };
      const key = keyOf(ref);
      let run = runs.get(key);
      if (run?.state.status === "ready") return;
      if (!run) {
        run = { ref, input: structuredClone(notification.input), startedAt: notification.observedAt, events: [], state: recording };
        runs.set(key, run);
        publish(key);
      }
      if (notification.type === "event") {
        const event = structuredClone(notification.event) as ProtocolEvent;
        run.events.push({ sequence: run.events.length + 1, receivedAt: notification.observedAt, event });
        if (event.type === "RUN_ERROR") {
          run.outcome = "error";
          run.error = String(event.message ?? "响应失败");
        } else if (event.type === "RUN_FINISHED") {
          const outcome = (event.outcome as { type?: string } | undefined)?.type;
          run.outcome = outcome === "cancelled" ? "cancelled" : outcome === "interrupt" ? "interrupted" : "completed";
        }
      } else if (notification.type === "run-failed") {
        if (run.outcome !== "cancelled") {
          run.outcome = "error";
          run.error = notification.error.message;
        }
      } else if (notification.type === "run-finalized") {
        const outcome = run.outcome ?? "incomplete";
        const endedAt = notification.observedAt;
        const entries = options.projectEvents ? structuredClone(options.projectEvents(run.events)) : run.events.map((entry) => ({
          id: String(entry.sequence), event: entry.event.type, content: entry.event, startedAt: entry.receivedAt,
        }));
        const record: ResponseTraceRecord = {
          ref, input: run.input, startedAt: run.startedAt, endedAt, outcome, error: run.error,
          events: run.events, entries,
          summary: { durationMs: Math.max(0, endedAt - run.startedAt), eventCount: run.events.length },
        };
        freeze(record);
        run.state = Object.freeze({ status: "ready", record });
        publish(key);
      }
    },
    markCancelled(ref) {
      const run = runs.get(keyOf(ref));
      if (run?.state.status === "recording") run.outcome = "cancelled";
    },
    getSnapshot: (ref) => ref ? runs.get(keyOf(ref))?.state ?? unavailable : unavailable,
    subscribe(ref, listener) {
      if (!ref || disposed) return () => {};
      const key = keyOf(ref);
      const set = listeners.get(key) ?? new Set();
      set.add(listener);
      listeners.set(key, set);
      return () => { set.delete(listener); if (!set.size) listeners.delete(key); };
    },
    dispose() {
      disposed = true;
      runs.clear();
      listeners.forEach((set) => set.forEach((listener) => listener()));
      listeners.clear();
    },
  };
}

export function useResponseTrace(store?: ResponseTraceStore, ref?: ResponseTraceRef): ResponseTraceState {
  const sourceId = ref?.sourceId;
  const threadId = ref?.threadId;
  const runId = ref?.runId;
  const readRef = useCallback(() => sourceId !== undefined && threadId !== undefined && runId !== undefined
    ? { sourceId, threadId, runId } : undefined, [sourceId, threadId, runId]);
  const subscribe = useCallback((listener: () => void) => store?.subscribe(readRef(), listener) ?? (() => {}), [store, readRef]);
  const getSnapshot = useCallback(() => store?.getSnapshot(readRef()) ?? unavailable, [store, readRef]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function freeze(value: unknown): void {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
  Object.freeze(value);
  Object.values(value).forEach(freeze);
}

export function parseJson(value: string): unknown {
  try { return JSON.parse(value); } catch { return value; }
}

