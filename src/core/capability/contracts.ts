import type { ComponentType } from "react";

export type CapabilityKind = "component" | "function";
// `any` is intentional at this erased registry boundary; public generics retain
// the concrete parameter and return types supplied by callers.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CapabilityFunction = (...args: any[]) => any;
export type CapabilityComponent<TProps = Record<string, never>> =
  ComponentType<TProps>;

export interface CapabilityCondition {
  market?: string;
  version: string;
}

export interface CapabilityRegistration {
  name: string;
  market?: string | readonly string[];
  version?: string;
  versionRange?: string;
  priority?: number;
  fallback?: boolean;
}

export interface NormalizedCapabilityRegistration {
  name: string;
  markets: readonly string[];
  version?: string;
  versionRange?: string;
  priority: number;
  fallback: boolean;
}

export interface CapabilityDeclaration<TImplementation = unknown> {
  id: number;
  kind: CapabilityKind;
  implementation: TImplementation;
  registration: NormalizedCapabilityRegistration;
  source?: string;
}

export interface CapabilityResolution<TImplementation = unknown> {
  condition: Readonly<CapabilityCondition>;
  declaration: CapabilityDeclaration<TImplementation>;
  level:
    | "market-exact"
    | "global-exact"
    | "market-range"
    | "global-range"
    | "market-fallback"
    | "global-fallback";
}

export interface CapabilityResolutionExplanation {
  name: string;
  kind: CapabilityKind;
  condition: Readonly<CapabilityCondition>;
  selected?: {
    source?: string;
    level: CapabilityResolution["level"];
    registration: NormalizedCapabilityRegistration;
  };
}

export interface CapabilityTrace {
  traceId: string;
  stack: readonly string[];
}
