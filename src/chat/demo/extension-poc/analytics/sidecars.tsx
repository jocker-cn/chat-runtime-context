import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { createPendoScript, track } from "../../../../features/pendo";
import { chatData } from "../chatHistory";
import { observeQueue, observeRuntime, observeSessions, type ObservableQueue, type ObservableRuntime } from "./observe";

/** Vite/local-demo policy stays at the host boundary; never copy this to Next. */
function demoAnalyticsEnabled() {
  return typeof window !== "undefined"
    && ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname)
    && window.location.pathname === "/extension-poc"
    && import.meta.env.VITE_PENDO_ENABLED === "true"
    && !!import.meta.env.VITE_PENDO_PUBLIC_APP_ID;
}

export function ExtensionPocAnalytics({ children }: { children: ReactNode }) {
  useLayoutEffect(() => {
    if (document.getElementById("pendo-install")) return;
    const source = createPendoScript({
      enabled: demoAnalyticsEnabled(),
      publicAppId: import.meta.env.VITE_PENDO_PUBLIC_APP_ID ?? "",
      environment: "local",
    });
    if (!source) return;
    const script = document.createElement("script");
    script.id = "pendo-install";
    script.textContent = source;
    document.head.append(script);
  }, []);
  return children;
}

/** Demo-specific session and effective-view observation; renders no DOM. */
export function PendoWorkspaceSidecar({ view }: { view: string }) {
  const enabled = demoAnalyticsEnabled();
  const lastView = useRef<{ view: string; track: typeof track }>(undefined);
  useEffect(() => {
    if (!enabled) return;
    try { return observeSessions(chatData, track); } catch { /* Optional observer. */ }
  }, [enabled, track]);
  useEffect(() => {
    if (!enabled || (lastView.current?.view === view && lastView.current.track === track)) return;
    lastView.current = { view, track };
    track({ name: "workspace_viewed", properties: { view } });
  }, [enabled, track, view]);
  return null;
}

/** Optional demo adapter. Next.js hosts do not need Runtime, queue or this component. */
export function PendoChatSidecar({ runtime, queue, secondaryEnabled }: {
  runtime: ObservableRuntime;
  queue: ObservableQueue;
  secondaryEnabled: boolean;
}) {
  const enabled = demoAnalyticsEnabled();
  const previousEnabled = useRef(secondaryEnabled);
  useEffect(() => {
    if (!enabled) return;
    const cleanups: (() => void)[] = [];
    try { cleanups.push(observeRuntime(runtime, track)); } catch { /* Optional observer. */ }
    try { cleanups.push(observeQueue(queue, track)); } catch { /* Optional observer. */ }
    return () => cleanups.forEach((cleanup) => { try { cleanup(); } catch { /* Optional observer. */ } });
  }, [enabled, track, runtime, queue]);
  useEffect(() => {
    if (previousEnabled.current === secondaryEnabled) return;
    previousEnabled.current = secondaryEnabled;
    if (enabled) track({ name: "agent_comparison_changed", properties: { enabled: secondaryEnabled } });
  }, [enabled, track, secondaryEnabled]);
  return null;
}
