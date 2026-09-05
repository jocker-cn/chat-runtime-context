import type { ComponentType } from "react";

export type CapabilityKind = "component" | "function";
export type CapabilityFunction = (...args: any[]) => any;
/** Query input: omitted/blank version means fallback-only lookup. */
export interface CapabilityCondition {
  market?: string | undefined;
  version?: string | undefined;
}

/** Internal query snapshot: market is resolved, version may remain absent. */
export interface NormalizedCapabilityCondition {
  readonly market: string;
  readonly version: string | undefined;
}

interface CapabilityRegistrationBase {
  name: string;
  market?: string | readonly string[];
}

export type CapabilityRegistration = CapabilityRegistrationBase & (
  | { version: string; fallback?: never }
  | { version?: never; fallback: true }
);

export interface NormalizedCapabilityRegistration {
  name: string;
  markets: readonly string[];
  version?: string;
  fallback: boolean;
}

export interface CapabilityDeclaration<TImplementation = unknown> {
  readonly id: number;
  readonly kind: CapabilityKind;
  readonly implementation: TImplementation;
  readonly registration: NormalizedCapabilityRegistration;
  readonly source?: string;
  readonly moduleId?: string;
}

export interface CapabilityResolution<TImplementation = unknown> {
  condition: NormalizedCapabilityCondition;
  declaration: CapabilityDeclaration<TImplementation>;
  level: "market-exact" | "global-exact" | "market-fallback" | "global-fallback";
}

export interface CapabilityCandidate {
  source?: string;
  moduleId?: string;
  registration: NormalizedCapabilityRegistration;
  selected: boolean;
  reason: "selected" | "version-mismatch" | "market-mismatch" | "lower-precedence";
}

export interface CapabilityResolutionExplanation {
  name: string;
  kind: CapabilityKind;
  condition: NormalizedCapabilityCondition;
  selected?: {
    source?: string;
    moduleId?: string;
    level: CapabilityResolution["level"];
    registration: NormalizedCapabilityRegistration;
  };
  candidates: CapabilityCandidate[];
}

/** Shared by standalone and transactional module registration. */
export interface CapabilityRegistrar {
  registerFunction<T extends CapabilityFunction>(
    registration: CapabilityRegistration, implementation: T, source?: string,
  ): T;
  registerComponent<P>(
    registration: CapabilityRegistration, implementation: ComponentType<P>, source?: string,
  ): ComponentType<P>;
}
