import { useEffect, useRef, useState, type ReactNode } from "react";
import { PendoProvider, usePendo, type PendoConfig } from "../../../../features/pendo";
import { chatData } from "../chatHistory";
import { observeQueue, observeRuntime, observeSessions, type ObservableQueue, type ObservableRuntime } from "./observe";

/** Vite/local-demo policy stays at the host boundary; never copy this to Next. */
export function ExtensionPocAnalytics({ children }: { children: ReactNode }) {
  const [localWorkspace, setLocalWorkspace] = useState(false);
  useEffect(() => {
    setLocalWorkspace(["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname)
      && window.location.pathname === "/extension-poc");
  }, []);
  return <PendoProvider
    enabled={localWorkspace && import.meta.env.VITE_PENDO_ENABLED === "true"}
    publicAppId={import.meta.env.VITE_PENDO_PUBLIC_APP_ID ?? ""}
    region={(import.meta.env.VITE_PENDO_REGION || "io") as PendoConfig["region"]}
    environment="local"
  >{children}</PendoProvider>;
}

/** Demo-specific session and effective-view observation; renders no DOM. */
export function PendoWorkspaceSidecar({ view }: { view: string }) {
  const { enabled, track } = usePendo();
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
  const { enabled, track } = usePendo();
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
