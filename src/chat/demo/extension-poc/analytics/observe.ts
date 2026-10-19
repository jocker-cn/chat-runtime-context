// These event names and state shapes belong to this demo, not the reusable SDK.
type ChatAnalyticsEvent =
  | { name: "chat_session_created"; properties: Record<string, never> }
  | { name: "chat_submitted"; properties: Record<string, never> }
  | { name: "agent_run_finished"; properties: { agent: string; outcome: string; duration_ms: number } };
type Track = (event: ChatAnalyticsEvent) => void;

// Structural, read-only ports: no dependency on concrete controllers or agents.
export interface ObservableRuntime {
  subscribe(listener: () => void): () => void;
  getSnapshot(): { branchesById: Readonly<Record<string, { status: string; sourceId?: string }>> };
}
export interface ObservableQueue {
  subscribe(listener: () => void): () => void;
  getSnapshot(): { items: readonly { id: string }[] };
}
export interface ObservableSessions {
  subscribe(listener: () => void): () => void;
  listSessions(): Promise<readonly { id: string }[]>;
}

/** All failures, including a broken analytics sink, stay outside business code. */
function isolated(action: () => void) {
  try { action(); } catch { /* Read-only observation is optional. */ }
}

export function observeRuntime(runtime: ObservableRuntime, track: Track, now = Date.now) {
  const branches = new Map<string, { status: string; startedAt?: number }>();
  const inspect = (initial = false) => isolated(() => {
    const current = runtime.getSnapshot().branchesById;
    for (const id of branches.keys()) if (!current[id]) branches.delete(id);
    for (const [id, branch] of Object.entries(current)) {
      const previous = branches.get(id);
      if (previous?.status === branch.status) continue;
      const startedAt = branch.status === "running" ? now() : previous?.startedAt;
      branches.set(id, { status: branch.status, startedAt });
      if (initial || startedAt === undefined || !["completed", "error", "cancelled"].includes(branch.status)) continue;
      // IDs, messages, tool arguments and errors never cross the analytics port.
      isolated(() => track({ name: "agent_run_finished", properties: {
        agent: branch.sourceId === "agent-a" ? "agent-a" : branch.sourceId === "agent-b" ? "agent-b" : "other",
        outcome: branch.status,
        duration_ms: Math.max(0, now() - startedAt),
      } }));
      branches.set(id, { status: branch.status });
    }
  });
  inspect(true);
  return runtime.subscribe(inspect);
}

export function observeQueue(queue: ObservableQueue, track: Track) {
  const seen = new Set(queue.getSnapshot().items.map((item) => item.id));
  return queue.subscribe(() => isolated(() => {
    for (const item of queue.getSnapshot().items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      isolated(() => track({ name: "chat_submitted", properties: {} }));
    }
    // Retain only items in this queue; removed payloads are never retained.
    const current = new Set(queue.getSnapshot().items.map((item) => item.id));
    for (const id of seen) if (!current.has(id)) seen.delete(id);
  }));
}

export function observeSessions(sessions: ObservableSessions, track: Track) {
  let active = true;
  let seen: Set<string> | undefined;
  // Serialize refreshes, so slow responses cannot manufacture creation events.
  // Capture the baseline immediately, before a same-tick createSession call.
  let refresh = sessions.listSessions().then((items) => {
    if (active) seen = new Set(items.map((session) => session.id));
  }).catch(() => {});
  const inspect = () => {
    refresh = refresh.then(async () => {
      if (!active) return;
      const current = new Set((await sessions.listSessions()).map((session) => session.id));
      if (!active) return;
      if (seen) for (const id of current) {
        if (!seen.has(id)) isolated(() => track({ name: "chat_session_created", properties: {} }));
      }
      seen = current;
    }).catch(() => {});
  };
  const unsubscribe = sessions.subscribe(inspect);
  return () => { active = false; unsubscribe(); };
}
