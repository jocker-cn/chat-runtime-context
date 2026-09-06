import {
  createContext,
  createElement,
  useContext,
  useSyncExternalStore,
  type ComponentType,
} from "react";
import type {
  CapabilityCandidate,
  CapabilityCondition,
  CapabilityDeclaration,
  CapabilityFunction,
  CapabilityKind,
  CapabilityRegistrar,
  CapabilityRegistration,
  CapabilityResolution,
  CapabilityResolutionExplanation,
  NormalizedCapabilityCondition,
  NormalizedCapabilityRegistration,
} from "./contracts";
import {
  CapabilityNotFoundError,
  CapabilityRegistrationError,
  CircularCapabilityError,
} from "./errors";

const GLOBAL_MARKET = "*";
type CapabilityIndex = Map<string, CapabilityDeclaration>;
let nextRegistryId = 1;
const CapabilityRenderPathContext = createContext<readonly string[]>([]);

export class CapabilityRegistry implements CapabilityRegistrar {
  readonly registryId = nextRegistryId++;
  private declarations: readonly CapabilityDeclaration[] = [];
  private index: CapabilityIndex = new Map();
  private nextDeclarationId = 1;
  private referenceCache = new Map<string, unknown>();
  private synchronousFunctionStack: string[] = [];
  private moduleOwners = new Map<string, symbol>();
  private listeners = new Set<() => void>();
  private revision = 0;
  private notificationPending = false;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  readonly getSnapshot = (): number => this.revision;

  createModule(moduleId: string): CapabilityModule {
    return new CapabilityModule(this, normalizeModuleId(moduleId));
  }

  registerFunction<T extends CapabilityFunction>(
    registration: CapabilityRegistration,
    implementation: T,
    source?: string,
  ): T {
    this.registerStandalone("function", registration, implementation, source);
    return implementation;
  }

  registerComponent<P>(
    registration: CapabilityRegistration,
    implementation: ComponentType<P>,
    source?: string,
  ): ComponentType<P> {
    this.registerStandalone("component", registration, implementation, source);
    return implementation;
  }

  getFunction<T extends CapabilityFunction>(
    name: string,
    condition: CapabilityCondition,
  ): T {
    const stableCondition = freezeCondition(condition);
    const stableName = requireText(name, "name");
    const key = referenceKey("function", stableName, stableCondition);
    const existing = this.referenceCache.get(key);
    if (existing) return existing as T;

    const reference = ((...args: Parameters<T>) => {
      const resolution = this.resolve<T>(stableName, "function", stableCondition);
      const executionKey = this.executionKey(resolution.declaration);
      const circularIndex = this.synchronousFunctionStack.indexOf(executionKey);
      if (circularIndex >= 0) {
        throw new CircularCapabilityError([
          ...this.synchronousFunctionStack.slice(circularIndex), executionKey,
        ]);
      }
      this.synchronousFunctionStack.push(executionKey);
      try {
        // No implicit receiver: implementations are standalone functions.
        const implementation = resolution.declaration.implementation;
        return implementation(...args);
      } finally {
        this.synchronousFunctionStack.pop();
      }
    }) as T;
    this.referenceCache.set(key, reference);
    return reference;
  }

  getComponent<P>(name: string, condition: CapabilityCondition): ComponentType<P> {
    const stableCondition = freezeCondition(condition);
    const stableName = requireText(name, "name");
    const key = referenceKey("component", stableName, stableCondition);
    const existing = this.referenceCache.get(key);
    if (existing) return existing as ComponentType<P>;

    const registry = this;
    function CapabilityComponentReference(props: P) {
      return createElement(CapabilityView<P>, {
        registry, name: stableName, condition: stableCondition, componentProps: props,
      });
    }
    CapabilityComponentReference.displayName = `Capability(${stableName})`;
    this.referenceCache.set(key, CapabilityComponentReference);
    return CapabilityComponentReference;
  }

  resolve<T = unknown>(
    name: string,
    kind: CapabilityKind,
    condition: CapabilityCondition,
  ): CapabilityResolution<T> {
    const normalized = freezeCondition(condition);
    const stableName = requireText(name, "name");
    const market = normalized.market ?? GLOBAL_MARKET;
    const local = normalized.version === undefined ? undefined
      : this.index.get(indexKey(kind, stableName, market, normalized.version));
    const global = normalized.version === undefined ? undefined
      : this.index.get(indexKey(kind, stableName, GLOBAL_MARKET, normalized.version));
    const localFallback = this.index.get(indexKey(kind, stableName, market, undefined));
    const globalFallback = this.index.get(indexKey(kind, stableName, GLOBAL_MARKET, undefined));
    const choices: Array<[CapabilityDeclaration | undefined, CapabilityResolution["level"]]> = [
      [local, market === GLOBAL_MARKET ? "global-exact" : "market-exact"],
      [global, "global-exact"],
      [localFallback, market === GLOBAL_MARKET ? "global-fallback" : "market-fallback"],
      [globalFallback, "global-fallback"],
    ];
    const match = choices.find(([declaration]) => declaration !== undefined);
    if (!match) throw new CapabilityNotFoundError(stableName, kind, normalized);
    return {
      declaration: match[0] as CapabilityDeclaration<T>,
      condition: normalized,
      level: match[1],
    };
  }

  explain(
    name: string, kind: CapabilityKind, condition: CapabilityCondition,
  ): CapabilityResolutionExplanation {
    const normalized = freezeCondition(condition);
    const stableName = requireText(name, "name");
    let resolution: CapabilityResolution | undefined;
    try {
      resolution = this.resolve(stableName, kind, normalized);
    } catch (error) {
      if (!(error instanceof CapabilityNotFoundError)) throw error;
    }
    const selected = resolution && {
      source: resolution.declaration.source,
      moduleId: resolution.declaration.moduleId,
      level: resolution.level,
      registration: resolution.declaration.registration,
    };
    const candidates = this.declarations
      .filter((item) => item.kind === kind && item.registration.name === stableName)
      .map((item): CapabilityCandidate => ({
        source: item.source,
        moduleId: item.moduleId,
        registration: item.registration,
        selected: item === resolution?.declaration,
        reason: candidateReason(item, normalized, resolution?.declaration),
      }));
    return { name: stableName, kind, condition: normalized, selected, candidates };
  }

  list(): readonly CapabilityDeclaration[] {
    return this.declarations;
  }

  clear(): void {
    this.moduleOwners.clear();
    // Keep lazy reference identities: previously obtained references remain valid.
    this.publish([]);
  }

  executionKey(declaration: CapabilityDeclaration): string {
    return JSON.stringify([this.registryId, declaration.kind,
      declaration.registration.name, declaration.id]);
  }

  /** @internal Called by a module transaction, never by individual decorators. */
  commitModule(
    moduleId: string, owner: symbol, pending: readonly PendingDeclaration[],
  ): void {
    const next = this.declarations.filter((item) => item.moduleId !== moduleId);
    const additions = pending.map((item) => this.declaration(item, moduleId));
    const declarations = [...next, ...additions];
    // Validate before replacing the previous generation or its owner.
    const index = buildIndex(declarations);
    this.moduleOwners.set(moduleId, owner);
    this.publish(declarations, index);
  }

  /** @internal An old HMR disposal must not remove a newer generation. */
  disposeModule(moduleId: string, owner: symbol): void {
    if (this.moduleOwners.get(moduleId) !== owner) return;
    this.moduleOwners.delete(moduleId);
    this.publish(this.declarations.filter((item) => item.moduleId !== moduleId));
  }

  private registerStandalone(
    kind: CapabilityKind, registration: CapabilityRegistration,
    implementation: unknown, source?: string,
  ): void {
    const normalized = normalizeRegistration(registration);
    const unchanged = this.declarations.some((item) =>
      item.moduleId === undefined &&
      sameDeclaration(item, { kind, registration: normalized, implementation, source }),
    );
    if (unchanged) return;
    const item = this.declaration({
      kind, registration: normalized, implementation, source,
    });
    this.publish([...this.declarations, item]);
  }

  private declaration(item: PendingDeclaration, moduleId?: string): CapabilityDeclaration {
    return Object.freeze({ ...item, id: this.nextDeclarationId++, moduleId });
  }

  private publish(
    declarations: readonly CapabilityDeclaration[],
    index = buildIndex(declarations),
  ): void {
    this.declarations = Object.freeze([...declarations]);
    this.index = index;
    this.revision++;
    this.scheduleNotification();
  }

  private scheduleNotification(): void {
    // Batch registration changes in the same task, independently of the host.
    if (this.notificationPending) return;
    this.notificationPending = true;
    queueMicrotask(() => {
      this.notificationPending = false;
      for (const listener of [...this.listeners]) listener();
    });
  }
}

interface PendingDeclaration {
  kind: CapabilityKind;
  registration: NormalizedCapabilityRegistration;
  implementation: unknown;
  source?: string;
}

/** Collect declarations locally and atomically publish them with commit(). */
export class CapabilityModule implements CapabilityRegistrar {
  private readonly owner = Symbol();
  private pending: PendingDeclaration[] = [];
  private state: "collecting" | "committed" | "disposed" = "collecting";

  constructor(
    private readonly registry: CapabilityRegistry,
    readonly moduleId: string,
  ) {}

  readonly dispose = (): void => {
    if (this.state === "disposed") return;
    this.state = "disposed";
    this.pending = [];
    this.registry.disposeModule(this.moduleId, this.owner);
  };

  commit(): void {
    if (this.state !== "collecting") {
      throw new CapabilityRegistrationError(`Module "${this.moduleId}" is ${this.state}.`);
    }
    this.registry.commitModule(this.moduleId, this.owner, this.pending);
    this.state = "committed";
    this.pending = [];
  }

  registerFunction<T extends CapabilityFunction>(
    registration: CapabilityRegistration, implementation: T, source?: string,
  ): T {
    this.add("function", registration, implementation, source);
    return implementation;
  }

  registerComponent<P>(
    registration: CapabilityRegistration, implementation: ComponentType<P>, source?: string,
  ): ComponentType<P> {
    this.add("component", registration, implementation, source);
    return implementation;
  }

  private add(
    kind: CapabilityKind, registration: CapabilityRegistration,
    implementation: unknown, source?: string,
  ): void {
    if (this.state !== "collecting") {
      throw new CapabilityRegistrationError(`Module "${this.moduleId}" is ${this.state}.`);
    }
    const item = { kind, registration: normalizeRegistration(registration), implementation, source };
    if (this.pending.some((existing) => sameDeclaration(existing, item))) return;
    this.pending.push(item);
  }
}

/** Subscribe function-derived UI and diagnostic panels once at their boundary. */
export function useCapabilityRevision(registry: CapabilityRegistry): number {
  return useSyncExternalStore(registry.subscribe, registry.getSnapshot, registry.getSnapshot);
}

/** Stable React boundary when condition changes; matching implementation retains state. */
export function CapabilityView<P>({
  registry, name, condition, componentProps,
}: {
  registry: CapabilityRegistry;
  name: string;
  condition: CapabilityCondition;
  componentProps: P;
}) {
  useCapabilityRevision(registry);
  const parentPath = useContext(CapabilityRenderPathContext);
  const resolution = registry.resolve<ComponentType<P>>(name, "component", condition);
  const executionKey = registry.executionKey(resolution.declaration);
  const circularIndex = parentPath.indexOf(executionKey);
  if (circularIndex >= 0) {
    throw new CircularCapabilityError([...parentPath.slice(circularIndex), executionKey]);
  }
  return createElement(
    CapabilityRenderPathContext.Provider,
    { value: [...parentPath, executionKey] },
    createElement(resolution.declaration.implementation as ComponentType<any>, componentProps as any),
  );
}

function sameDeclaration(left: PendingDeclaration, right: PendingDeclaration): boolean {
  return left.kind === right.kind &&
    left.implementation === right.implementation &&
    left.source === right.source &&
    left.registration.name === right.registration.name &&
    left.registration.version === right.registration.version &&
    left.registration.fallback === right.registration.fallback &&
    left.registration.markets.length === right.registration.markets.length &&
    left.registration.markets.every((market) => right.registration.markets.includes(market));
}

function candidateReason(
  item: CapabilityDeclaration, condition: CapabilityCondition,
  selected?: CapabilityDeclaration,
): CapabilityCandidate["reason"] {
  if (item === selected) return "selected";
  if (!item.registration.fallback && item.registration.version !== condition.version) return "version-mismatch";
  const markets = item.registration.markets;
  if (!markets.includes(condition.market ?? GLOBAL_MARKET) && !markets.includes(GLOBAL_MARKET)) {
    return "market-mismatch";
  }
  return "lower-precedence";
}

function buildIndex(declarations: readonly CapabilityDeclaration[]): CapabilityIndex {
  const index: CapabilityIndex = new Map();
  for (const declaration of declarations) {
    for (const market of declaration.registration.markets) {
      const { name, version } = declaration.registration;
      const key = indexKey(declaration.kind, name, market, version);
      const duplicate = index.get(key);
      if (duplicate) {
        throw new CapabilityRegistrationError(
          `Duplicate ${declaration.kind} capability "${name}" (${market}, ${version}). Sources: ${describeSource(duplicate)} and ${describeSource(declaration)}.`,
        );
      }
      index.set(key, declaration);
    }
  }
  return index;
}

function describeSource(item: CapabilityDeclaration): string {
  return `${item.moduleId ?? "<standalone>"}:${item.source ?? "<anonymous>"}`;
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new CapabilityRegistrationError(`Capability ${label} must be a non-empty string.`);
  }
  return value.trim();
}

function normalizeModuleId(value: string): string {
  const id = requireText(value, "moduleId");
  try {
    const url = new URL(id);
    // Vite appends a new timestamp to import.meta.url for each HMR generation.
    url.searchParams.delete("t");
    return url.href;
  } catch {
    return id;
  }
}

function exactVersion(value: unknown): string {
  const version = requireText(value, "version");
  // Versions are exact identifiers, not semver ranges.
  if (!/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(version)) {
    throw new CapabilityRegistrationError(`Invalid exact version "${version}". Ranges are not supported.`);
  }
  return version;
}

function normalizeRegistration(registration: CapabilityRegistration): NormalizedCapabilityRegistration {
  for (const removed of ["versionRange", "priority"]) {
    if (removed in registration) {
      throw new CapabilityRegistrationError(`"${removed}" is no longer supported; use an exact version and market.`);
    }
  }
  const name = requireText(registration.name, "name");
  const fallback = registration.fallback === true;
  if (fallback && registration.version !== undefined) {
    throw new CapabilityRegistrationError("Declare either an exact version or fallback, not both.");
  }
  const version = fallback ? undefined : exactVersion(registration.version);
  const input = registration.market ?? GLOBAL_MARKET;
  const rawMarkets = typeof input === "string" ? [input] : input;
  const markets = [...new Set(rawMarkets.map((market) => requireText(market, "market")))];
  if (!markets.length) throw new CapabilityRegistrationError(`Capability "${name}" has no markets.`);
  return Object.freeze({ name, version, fallback, markets: Object.freeze(markets) });
}

function freezeCondition(condition: CapabilityCondition): NormalizedCapabilityCondition {
  const rawVersion = condition.version;
  const version = rawVersion === undefined ||
    (typeof rawVersion === "string" && !rawVersion.trim())
    ? undefined
    : exactVersion(rawVersion);
  const rawMarket = condition.market;
  const market = rawMarket === undefined ||
    (typeof rawMarket === "string" && !rawMarket.trim())
    ? GLOBAL_MARKET
    : requireText(rawMarket, "market");
  return Object.freeze({
    version,
    market,
  });
}

function indexKey(kind: CapabilityKind, name: string, market: string, version: string | undefined): string {
  return JSON.stringify([kind, name, market, version]);
}

function referenceKey(kind: CapabilityKind, name: string, condition: CapabilityCondition): string {
  return indexKey(kind, name, condition.market ?? GLOBAL_MARKET, condition.version);
}
