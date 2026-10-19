/** Framework-independent SDK boundary. Configuration belongs to the host. */
export interface PendoConfig {
  publicAppId: string;
  enabled?: boolean;
  region?: "io" | "eu" | "jpn" | "au" | "us1";
  visitorId?: string;
  accountId?: string;
  environment?: string;
}

export interface AnalyticsEvent {
  name: string;
  properties?: Record<string, unknown>;
}

export type Track = (event: AnalyticsEvent) => void;

interface PendoSdk {
  _q?: unknown[][];
  track?(name: string, properties: Record<string, unknown>): void;
  flushNow?(options?: { hidden?: boolean; unload?: boolean }): void;
  teardown?(): void;
}

type PendoWindow = Window & { pendo?: PendoSdk };
let shared: { track: Track; stop(flushBeforeStop?: boolean): void; references: number; key: string } | undefined;
const memoryVisitors = new Map<string, string>();

export function pendoEnabled(config: PendoConfig) {
  return config.enabled === true && /^[a-f0-9-]{32,36}$/i.test(config.publicAppId)
    && ["io", "eu", "jpn", "au", "us1"].includes(config.region ?? "io");
}

/** Reference-counted leases keep StrictMode and sibling sidecars on one SDK. */
export function acquirePendo(config: PendoConfig): { track: Track; release(): void } | undefined {
  if (typeof window === "undefined") return;
  if (!pendoEnabled(config)) {
    // On a config update React releases the old effect before connecting the new
    // disabled one. Cancel its deferred exit flush: disabling must not send data.
    if (shared?.references === 0) {
      shared.stop();
      shared = undefined;
    }
    return;
  }
  try {
    const key = JSON.stringify([config.publicAppId, config.region ?? "io", config.visitorId, config.accountId, config.environment]);
    if (shared && shared.key !== key) {
      // Identity/configuration changes may replace an unused SDK, never an active owner.
      if (shared.references > 0) return;
      shared.stop();
      shared = undefined;
    }
    shared ??= { ...startPendo(config), references: 0, key };
    const client = shared;
    client.references++;
    let released = false;
    return {
      track: client.track,
      release() {
        if (released) return;
        released = true;
        client.references--;
        // React immediately reacquires on the development effect replay.
        queueMicrotask(() => {
          if (client.references === 0 && shared === client) {
            shared = undefined;
            client.stop(true);
          }
        });
      },
    };
  } catch {
    return undefined;
  }
}

function startPendo(config: PendoConfig) {
  const host = window as PendoWindow;
  // Do not take ownership of another host application's SDK.
  if (host.pendo) throw new Error("Pendo already belongs to the host.");
  const appId = config.publicAppId;
  const region = config.region ?? "io";
  let stopped = false;
  let ready = false;
  const pending: AnalyticsEvent[] = [];
  const script = document.createElement("script");
  const drain = () => {
    if (stopped || !ready) return;
    for (const event of pending.splice(0)) {
      try {
        host.pendo?.track?.(event.name, {
          ...event.properties,
          ...(config.environment ? { environment: config.environment } : {}),
        });
      } catch { /* Analytics must not affect the UI. */ }
    }
  };
  const send: Track = (event) => {
    if (stopped || (!ready && pending.length >= 100)) return;
    // Store synchronously so a same-turn pagehide/unmount can drain the event.
    // Third-party calls normally run outside the business publisher's call stack.
    pending.push(event);
    queueMicrotask(drain);
  };
  const flush = (options: { hidden?: boolean; unload?: boolean }) => {
    if (stopped || !ready) return;
    drain();
    try { host.pendo?.flushNow?.(options); } catch { /* Last-chance delivery is best effort. */ }
  };
  const onHidden = () => { if (document.visibilityState === "hidden") flush({ hidden: true }); };
  const onPageHide = () => flush({ unload: true });
  const stop = (flushBeforeStop = false) => {
    if (stopped) return;
    if (flushBeforeStop) flush({ unload: true });
    stopped = true;
    pending.length = 0;
    document.removeEventListener("visibilitychange", onHidden);
    window.removeEventListener("pagehide", onPageHide);
    script.remove();
    if (host.pendo?._q) host.pendo._q.length = 0;
    try { host.pendo?.teardown?.(); } catch { /* Best-effort SDK cleanup. */ }
    delete host.pendo;
  };
  const options = {
    visitor: {
      id: config.visitorId || getVisitorId(appId),
      ...(config.environment ? { environment: config.environment } : {}),
    },
    ...(config.accountId ? { account: { id: config.accountId } } : {}),
    excludeAllText: true,
    allowedText: [],
    analytics: { excludeEvents: ["focus", "change", "submit"] },
    interceptPreventDefault: false,
    interceptStopPropagation: false,
    syntheticClicks: { elementRemoval: false, targetChanged: false },
    guides: { disabled: true },
    recording: { enabled: false, autoStart: false },
    // Keep captured URLs free of query parameters and fragments.
    location: { transforms: [
      { attr: "search", action: "Clear" },
      { attr: "hash", action: "Clear" },
    ] },
    events: { ready: () => {
      if (stopped) return;
      ready = true;
      queueMicrotask(drain);
    } },
  };
  host.pendo = { _q: [["initialize", options]] };
  script.async = true;
  script.dataset.pendoSidecar = "true";
  script.src = `https://cdn.${region === "io" ? "pendo.io" : `${region}.pendo.io`}/agent/static/${appId}/pendo.js`;
  script.onerror = () => stop();
  document.addEventListener("visibilitychange", onHidden);
  window.addEventListener("pagehide", onPageHide);
  try { document.head.append(script); } catch { stop(); }
  return { track: send, stop };
}

function getVisitorId(appId: string) {
  const key = `pendo-sidecar:${appId}:visitor`;
  try {
    const stored = localStorage.getItem(key);
    if (stored && /^anonymous-[a-f0-9-]{36}$/i.test(stored)) return stored;
  } catch { /* Private browsing/storage restrictions use an in-memory identity. */ }
  const memoryVisitor = memoryVisitors.get(appId) ?? `anonymous-${crypto.randomUUID()}`;
  memoryVisitors.set(appId, memoryVisitor);
  try { localStorage.setItem(key, memoryVisitor); } catch { /* Optional storage. */ }
  return memoryVisitor;
}
