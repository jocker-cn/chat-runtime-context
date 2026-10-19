"use client";

import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { acquirePendo, pendoEnabled, type PendoConfig, type Track } from "./client";

const PendoContext = createContext<{ enabled: boolean; track: Track }>({ enabled: false, track: () => {} });

/** Mount once around the desired app/route scope. No business subscriptions. */
export function PendoProvider({ children, ...config }: PendoConfig & { children?: ReactNode }) {
  const { publicAppId, enabled = false, region = "io", visitorId, accountId, environment } = config;
  const connection = useMemo(() => {
    const options = { publicAppId, enabled, region, visitorId, accountId, environment };
    let lease: ReturnType<typeof acquirePendo>;
    const active = pendoEnabled(options);
    const value = {
      enabled: active,
      // Child mount effects can run before the provider's effect acquires the SDK.
      // Deferred delivery also drops events belonging to a disposed identity.
      track: ((event) => { if (active) queueMicrotask(() => lease?.track(event)); }) as Track,
    };
    return {
      value,
      connect() {
        lease = acquirePendo(options);
        return () => { lease?.release(); lease = undefined; };
      },
    };
  }, [publicAppId, enabled, region, visitorId, accountId, environment]);

  useEffect(() => connection.connect(), [connection]);
  return <PendoContext.Provider value={connection.value}>{children}</PendoContext.Provider>;
}

/** Optional custom events; a missing/disabled provider is a no-op. */
export function usePendo() {
  return useContext(PendoContext);
}
