"use client";

import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { acquirePendo, pendoEnabled, snapshotAgentArgs, type PendoConfig, type Track, type TrackAgent } from "./client";

const PendoContext = createContext<{ enabled: boolean; track: Track; trackAgent: TrackAgent }>({
  enabled: false, track: () => {}, trackAgent: () => {},
});

/** Mount once around the desired app/route scope. No business subscriptions. */
export function PendoProvider({ children, ...config }: PendoConfig & { children?: ReactNode }) {
  const { publicAppId, enabled = false, region = "io", visitorId, accountId, environment } = config;
  const connection = useMemo(() => {
    const options = { publicAppId, enabled, region, visitorId, accountId, environment };
    let lease: ReturnType<typeof acquirePendo>;
    let retired = false;
    const early: ((client: NonNullable<typeof lease>) => void)[] = [];
    const active = pendoEnabled(options);
    const send = (deliver: (client: NonNullable<typeof lease>) => void) => {
      if (!active || retired) return;
      // The client buffers synchronously for last-chance exit delivery.
      if (lease) deliver(lease);
      // Child mount effects can run before this provider's acquisition effect.
      else if (early.length < 100) early.push(deliver);
    };
    const value = {
      enabled: active,
      track: ((event) => send((client) => client.track(event))) as Track,
      trackAgent: ((...args) => {
        if (!active || retired) return;
        // Child effects may submit and then mutate their message before connect().
        if (lease) lease.trackAgent(...args);
        else {
          const snapshot = snapshotAgentArgs(args);
          send((client) => client.trackAgent(...snapshot));
        }
      }) as TrackAgent,
    };
    return {
      value,
      connect() {
        retired = false;
        lease = acquirePendo(options);
        early.splice(0).forEach((deliver) => { if (lease) deliver(lease); });
        return () => { retired = true; early.length = 0; lease?.release(); lease = undefined; };
      },
    };
  }, [publicAppId, enabled, region, visitorId, accountId, environment]);

  useEffect(() => connection.connect(), [connection]);
  return <PendoContext.Provider value={connection.value}>{children}</PendoContext.Provider>;
}

/** Optional custom/conversation events; a missing/disabled provider is a no-op. */
export function usePendo() {
  return useContext(PendoContext);
}
