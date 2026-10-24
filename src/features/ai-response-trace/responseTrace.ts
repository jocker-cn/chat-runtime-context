import { useCallback, useSyncExternalStore } from "react";

/** Names and types belong to the caller; this module knows no protocol. */
export interface ResponseTraceEntry {
  id: string;
  type: string;
  name?: string;
  content?: unknown;
  startedAt: number;
  endedAt?: number;
  details?: unknown;
}

export type ResponseTraceReport = Omit<ResponseTraceEntry, "id" | "startedAt"> & {
  id?: string;
  startedAt?: number;
};

export interface ResponseTraceRecord {
  id: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  entries: readonly ResponseTraceEntry[];
}

export interface ResponseTraceStore {
  /** Omit id to append; reuse an id to update an event without changing its order. */
  report(responseId: string, event: ResponseTraceReport): string | undefined;
  getSnapshot(responseId?: string): ResponseTraceRecord | undefined;
  subscribe(responseId: string | undefined, listener: () => void): () => void;
  dispose(): void;
}

/** Read-only event snapshots, scoped to the caller's chosen response ID. */
export function createResponseTraceStore(): ResponseTraceStore {
  const responses = new Map<string, {
    entries: Map<string, ResponseTraceEntry>;
    sequence: number;
    record?: ResponseTraceRecord;
  }>();
  const listeners = new Map<string, Set<() => void>>();
  let disposed = false;
  return {
    report(responseId, event) {
      if (disposed) return;
      let response = responses.get(responseId);
      if (!response) {
        response = { entries: new Map(), sequence: 0 };
        responses.set(responseId, response);
      }
      let id = event.id;
      if (id === undefined) {
        do { id = `event-${++response.sequence}`; } while (response.entries.has(id));
      }
      const previous = response.entries.get(id);
      const entry: ResponseTraceEntry = {
        ...previous, ...structuredClone(event), id,
        startedAt: event.startedAt ?? previous?.startedAt ?? Date.now(),
      };
      freeze(entry);
      response.entries.set(id, entry);
      const entries = Object.freeze([...response.entries.values()]);
      let startedAt = Infinity;
      let endedAt = -Infinity;
      for (const item of entries) {
        startedAt = Math.min(startedAt, item.startedAt);
        endedAt = Math.max(endedAt, item.endedAt ?? item.startedAt);
      }
      response.record = Object.freeze({
        id: responseId, entries, startedAt, endedAt, durationMs: Math.max(0, endedAt - startedAt),
      });
      listeners.get(responseId)?.forEach((listener) => listener());
      return id;
    },
    getSnapshot: (id) => id === undefined ? undefined : responses.get(id)?.record,
    subscribe(id, listener) {
      if (id === undefined || disposed) return () => {};
      const set = listeners.get(id) ?? new Set();
      set.add(listener);
      listeners.set(id, set);
      return () => { set.delete(listener); if (!set.size) listeners.delete(id); };
    },
    dispose() {
      disposed = true;
      responses.clear();
      listeners.forEach((set) => set.forEach((listener) => listener()));
      listeners.clear();
    },
  };
}

export function useResponseTrace(store?: ResponseTraceStore, responseId?: string): ResponseTraceRecord | undefined {
  const subscribe = useCallback((listener: () => void) => store?.subscribe(responseId, listener) ?? (() => {}), [store, responseId]);
  const getSnapshot = useCallback(() => store?.getSnapshot(responseId), [store, responseId]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function freeze(value: unknown, seen = new WeakSet<object>()): void {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  Object.freeze(value);
  Object.values(value).forEach((item) => freeze(item, seen));
}

export function parseJson(value: string): unknown {
  try { return JSON.parse(value); } catch { return value; }
}

