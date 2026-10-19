"use client";

import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { acquirePendo, pendoEnabled, type AnalyticsEvent, type PendoConfig, type Track } from "./client";

const PendoContext = createContext<{ enabled: boolean; track: Track }>({ enabled: false, track: () => {} });

/** Mount once around the desired app/route scope. No business subscriptions. */
export function PendoProvider({ children, ...config }: PendoConfig & { children?: ReactNode }) {
  const { publicAppId, enabled = false, region = "io", visitorId, accountId, environment } = config;
  const connection = useMemo(() => {
    const options = { publicAppId, enabled, region, visitorId, accountId, environment };
    let lease: ReturnType<typeof acquirePendo>;
    let retired = false;
    const early: AnalyticsEvent[] = [];
    const active = pendoEnabled(options);
    const value = {
      enabled: active,
      track: ((event) => {
        if (!active || retired) return;
        // The client buffers synchronously for last-chance exit delivery.
        if (lease) lease.track(event);
        // Child mount effects can run before this provider's acquisition effect.
        else if (early.length < 100) early.push(event);
      }) as Track,
    };
    return {
      value,
      connect() {
        retired = false;
        lease = acquirePendo(options);
        early.splice(0).forEach((event) => lease?.track(event));
        return () => { retired = true; early.length = 0; lease?.release(); lease = undefined; };
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
