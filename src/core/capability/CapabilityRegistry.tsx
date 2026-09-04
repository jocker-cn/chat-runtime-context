import {
  createContext,
  createElement,
  useContext,
  type ComponentType,
} from "react";
import { Range, satisfies } from "semver";
import type {
  CapabilityCondition,
  CapabilityDeclaration,
  CapabilityFunction,
  CapabilityKind,
  CapabilityRegistration,
  CapabilityResolution,
  CapabilityResolutionExplanation,
  NormalizedCapabilityRegistration,
} from "./contracts";
import {
  CapabilityNotFoundError,
  CapabilityRegistrationError,
  CircularCapabilityError,
} from "./errors";

const GLOBAL_MARKET = "*";
let nextRegistryId = 1;

interface RangedDeclaration {
  declaration: CapabilityDeclaration;
  range: Range;
}

interface VersionBucket {
  exact: Map<string, CapabilityDeclaration[]>;
  ranged: RangedDeclaration[];
  fallback: CapabilityDeclaration[];
}

interface CapabilityBucket {
  byMarket: Map<string, VersionBucket>;
}

interface CapabilityIndex {
  component: Map<string, CapabilityBucket>;
  function: Map<string, CapabilityBucket>;
}

const CapabilityRenderPathContext = createContext<readonly string[]>([]);

export class CapabilityRegistry {
  private readonly registryId = nextRegistryId++;
  private declarations: CapabilityDeclaration[] = [];
  private index: CapabilityIndex = createEmptyIndex();
  private linked = false;
  private nextDeclarationId = 1;
  private resolutionCache = new Map<string, CapabilityResolution>();
  private referenceCache = new Map<string, unknown>();
  private synchronousFunctionStack: string[] = [];

  registerFunction<TFunction extends CapabilityFunction>(
    registration: CapabilityRegistration,
    implementation: TFunction,
    source?: string,
  ): TFunction {
    this.addDeclaration("function", registration, implementation, source);
    return implementation;
  }

  registerComponent<TProps>(
    registration: CapabilityRegistration,
    implementation: ComponentType<TProps>,
    source?: string,
  ): ComponentType<TProps> {
    this.addDeclaration("component", registration, implementation, source);
    return implementation;
  }

  getFunction<TFunction extends CapabilityFunction>(
    name: string,
    condition: CapabilityCondition,
  ): TFunction {
    const stableCondition = freezeCondition(condition);
    const referenceKey = createReferenceKey("function", name, stableCondition);
    const existing = this.referenceCache.get(referenceKey);
    if (existing) {
      return existing as TFunction;
    }

    const reference = ((...args: Parameters<TFunction>) => {
      const resolution = this.resolve<TFunction>(
        name,
        "function",
        stableCondition,
      );
      const executionKey = createExecutionKey(
        this.registryId,
        resolution.declaration,
      );
      const circularIndex = this.synchronousFunctionStack.indexOf(executionKey);
      if (circularIndex >= 0) {
        throw new CircularCapabilityError([
          ...this.synchronousFunctionStack.slice(circularIndex),
          executionKey,
        ]);
      }

      this.synchronousFunctionStack.push(executionKey);
      try {
        return resolution.declaration.implementation(...args);
      } finally {
        this.synchronousFunctionStack.pop();
      }
    }) as TFunction;

    this.referenceCache.set(referenceKey, reference);
    return reference;
  }

  getComponent<TProps>(
    name: string,
    condition: CapabilityCondition,
  ): ComponentType<TProps> {
    const stableCondition = freezeCondition(condition);
    const referenceKey = createReferenceKey("component", name, stableCondition);
    const existing = this.referenceCache.get(referenceKey);
    if (existing) {
      return existing as ComponentType<TProps>;
    }

    const registry = this;
    function CapabilityComponentReference(props: TProps) {
      const parentPath = useContext(CapabilityRenderPathContext);
      const resolution = registry.resolve<ComponentType<TProps>>(
        name,
        "component",
        stableCondition,
      );
      const executionKey = createExecutionKey(
        registry.registryId,
        resolution.declaration,
      );
      const circularIndex = parentPath.indexOf(executionKey);
      if (circularIndex >= 0) {
        throw new CircularCapabilityError([
          ...parentPath.slice(circularIndex),
          executionKey,
        ]);
      }

      return createElement(
        CapabilityRenderPathContext.Provider,
        { value: [...parentPath, executionKey] },
        createElement(
          resolution.declaration.implementation as ComponentType<any>,
          props as any,
        ),
      );
    }

    CapabilityComponentReference.displayName = `Capability(${name})`;
    this.referenceCache.set(referenceKey, CapabilityComponentReference);
    return CapabilityComponentReference;
  }

  link(): void {
    const nextIndex = createEmptyIndex();
    const signatures = new Map<string, CapabilityDeclaration>();

    for (const declaration of this.declarations) {
      for (const market of declaration.registration.markets) {
        const signature = createRegistrationSignature(declaration, market);
        const duplicate = signatures.get(signature);
        if (duplicate) {
          throw new CapabilityRegistrationError(
            `Duplicate ${declaration.kind} capability registration for "${declaration.registration.name}" (${market}, ${describeVersion(declaration.registration)}). Sources: ${duplicate.source ?? "unknown"} and ${declaration.source ?? "unknown"}.`,
          );
        }
        signatures.set(signature, declaration);
        addToIndex(nextIndex, declaration, market);
      }
    }

    sortIndex(nextIndex);
    this.index = nextIndex;
    this.linked = true;
    this.resolutionCache.clear();
  }

  explain(
    name: string,
    kind: CapabilityKind,
    condition: CapabilityCondition,
  ): CapabilityResolutionExplanation {
    const stableCondition = freezeCondition(condition);
    try {
      const resolution = this.resolve(name, kind, stableCondition);
      return {
        name,
        kind,
        condition: stableCondition,
        selected: {
          source: resolution.declaration.source,
          level: resolution.level,
          registration: resolution.declaration.registration,
        },
      };
    } catch (error) {
      if (!(error instanceof CapabilityNotFoundError)) {
        throw error;
      }
      return { name, kind, condition: stableCondition };
    }
  }

  list(): readonly CapabilityDeclaration[] {
    return this.declarations;
  }

  clear(): void {
    this.declarations = [];
    this.index = createEmptyIndex();
    this.linked = false;
    this.nextDeclarationId = 1;
    this.resolutionCache.clear();
    this.referenceCache.clear();
    this.synchronousFunctionStack = [];
  }

  private addDeclaration<TImplementation>(
    kind: CapabilityKind,
    registration: CapabilityRegistration,
    implementation: TImplementation,
    source?: string,
  ) {
    const normalized = normalizeRegistration(registration);
    const existingIndex = source
      ? this.declarations.findIndex(
          (declaration) =>
            declaration.kind === kind &&
            declaration.registration.name === normalized.name &&
            declaration.source === source,
        )
      : -1;
    const existing = this.declarations[existingIndex];
    const declaration: CapabilityDeclaration<TImplementation> = {
      id: existing?.id ?? this.nextDeclarationId++,
      kind,
      implementation,
      registration: normalized,
      source,
    };

    if (existingIndex >= 0) {
      this.declarations[existingIndex] = declaration;
    } else {
      this.declarations.push(declaration);
    }
    this.linked = false;
    this.resolutionCache.clear();
  }

  private resolve<TImplementation>(
    name: string,
    kind: CapabilityKind,
    condition: Readonly<CapabilityCondition>,
  ): CapabilityResolution<TImplementation> {
    this.ensureLinked();
    const cacheKey = createReferenceKey(kind, name, condition);
    const cached = this.resolutionCache.get(cacheKey);
    if (cached) {
      return cached as CapabilityResolution<TImplementation>;
    }

    const bucket = this.index[kind].get(name);
    const marketBucket = condition.market
      ? bucket?.byMarket.get(condition.market)
      : undefined;
    const globalBucket = bucket?.byMarket.get(GLOBAL_MARKET);

    const candidates: Array<CapabilityResolution | undefined> = [
      fromExact(marketBucket, condition.version, condition, "market-exact"),
      fromExact(globalBucket, condition.version, condition, "global-exact"),
      fromRange(marketBucket, condition.version, condition, "market-range"),
      fromRange(globalBucket, condition.version, condition, "global-range"),
      fromFallback(marketBucket, condition, "market-fallback"),
      fromFallback(globalBucket, condition, "global-fallback"),
    ];
    const resolution = firstDefined(candidates);
    if (!resolution) {
      throw new CapabilityNotFoundError(name, kind, condition);
    }

    this.resolutionCache.set(cacheKey, resolution);
    return resolution as CapabilityResolution<TImplementation>;
  }

  private ensureLinked() {
    if (!this.linked) {
      this.link();
    }
  }
}

function normalizeRegistration(
  registration: CapabilityRegistration,
): NormalizedCapabilityRegistration {
  const name = registration.name.trim();
  if (!name) {
    throw new CapabilityRegistrationError("Capability name cannot be empty.");
  }

  const rawMarkets = Array.isArray(registration.market)
    ? registration.market
    : registration.market
      ? [registration.market]
      : [GLOBAL_MARKET];
  const markets = [...new Set(rawMarkets.map((market) => market.trim()))];
  if (markets.some((market) => !market)) {
    throw new CapabilityRegistrationError(
      `Capability "${name}" contains an empty market.`,
    );
  }

  const version = registration.version?.trim() || undefined;
  const versionRange = registration.versionRange?.trim() || undefined;
  if (versionRange) {
    try {
      new Range(versionRange);
    } catch {
      throw new CapabilityRegistrationError(
        `Capability "${name}" has an invalid versionRange "${versionRange}".`,
      );
    }
  }

  const fallback =
    registration.fallback ?? (version === undefined && versionRange === undefined);
  if (!version && !versionRange && !fallback) {
    throw new CapabilityRegistrationError(
      `Capability "${name}" must define version, versionRange, or fallback.`,
    );
  }

  return Object.freeze({
    name,
    markets: Object.freeze(markets),
    version,
    versionRange,
    priority: registration.priority ?? 0,
    fallback,
  });
}

function createEmptyIndex(): CapabilityIndex {
  return {
    component: new Map(),
    function: new Map(),
  };
}

function addToIndex(
  index: CapabilityIndex,
  declaration: CapabilityDeclaration,
  market: string,
) {
  const capabilityBucket = getOrCreate(
    index[declaration.kind],
    declaration.registration.name,
    () => ({ byMarket: new Map() }),
  );
  const versionBucket = getOrCreate(
    capabilityBucket.byMarket,
    market,
    (): VersionBucket => ({ exact: new Map(), ranged: [], fallback: [] }),
  );
  const { version, versionRange, fallback } = declaration.registration;

  if (version) {
    getOrCreate(
      versionBucket.exact,
      version,
      (): CapabilityDeclaration[] => [],
    ).push(declaration);
  }
  if (versionRange) {
    versionBucket.ranged.push({
      declaration,
      range: new Range(versionRange),
    });
  }
  if (fallback) {
    versionBucket.fallback.push(declaration);
  }
}

function sortIndex(index: CapabilityIndex): void {
  sortKindIndex(index.component);
  sortKindIndex(index.function);
}

function sortKindIndex(kindIndex: Map<string, CapabilityBucket>): void {
  for (const capability of kindIndex.values()) {
    sortCapabilityBucket(capability);
  }
}

function sortCapabilityBucket(capability: CapabilityBucket): void {
  for (const bucket of capability.byMarket.values()) {
    sortVersionBucket(bucket);
  }
}

function sortVersionBucket(bucket: VersionBucket): void {
  for (const exact of bucket.exact.values()) {
    exact.sort(comparePriority);
  }
  bucket.ranged.sort((left, right) =>
    comparePriority(left.declaration, right.declaration),
  );
  bucket.fallback.sort(comparePriority);
}

function comparePriority(
  left: CapabilityDeclaration,
  right: CapabilityDeclaration,
) {
  return right.registration.priority - left.registration.priority;
}

function fromExact(
  bucket: VersionBucket | undefined,
  version: string,
  condition: Readonly<CapabilityCondition>,
  level: CapabilityResolution["level"],
) {
  const declaration = bucket?.exact.get(version)?.[0];
  return declaration ? { declaration, condition, level } : undefined;
}

function fromRange(
  bucket: VersionBucket | undefined,
  version: string,
  condition: Readonly<CapabilityCondition>,
  level: CapabilityResolution["level"],
) {
  const declaration = bucket?.ranged.find((candidate) =>
    satisfies(version, candidate.range, { includePrerelease: true }),
  )?.declaration;
  return declaration ? { declaration, condition, level } : undefined;
}

function fromFallback(
  bucket: VersionBucket | undefined,
  condition: Readonly<CapabilityCondition>,
  level: CapabilityResolution["level"],
) {
  const declaration = bucket?.fallback[0];
  return declaration ? { declaration, condition, level } : undefined;
}

function firstDefined<T>(values: readonly (T | undefined)[]): T | undefined {
  return values.find((value): value is T => value !== undefined);
}

function getOrCreate<TKey, TValue>(
  map: Map<TKey, TValue>,
  key: TKey,
  create: () => TValue,
) {
  const existing = map.get(key);
  if (existing !== undefined) {
    return existing;
  }
  const value = create();
  map.set(key, value);
  return value;
}

function freezeCondition(
  condition: CapabilityCondition,
): Readonly<CapabilityCondition> {
  const version = condition.version.trim();
  if (!version) {
    throw new CapabilityRegistrationError(
      "Capability condition version cannot be empty.",
    );
  }
  const market = condition.market?.trim() || undefined;
  return Object.freeze({ market, version });
}

function createReferenceKey(
  kind: CapabilityKind,
  name: string,
  condition: Readonly<CapabilityCondition>,
) {
  return `${kind}:${name}:${condition.market ?? GLOBAL_MARKET}:${condition.version}`;
}

function createExecutionKey(
  registryId: number,
  declaration: CapabilityDeclaration,
) {
  return `${registryId}:${declaration.kind}:${declaration.registration.name}#${declaration.id}`;
}

function createRegistrationSignature(
  declaration: CapabilityDeclaration,
  market: string,
) {
  const registration = declaration.registration;
  return [
    declaration.kind,
    registration.name,
    market,
    registration.version ?? "",
    registration.versionRange ?? "",
    registration.fallback ? "fallback" : "",
    registration.priority,
  ].join(":");
}

function describeVersion(registration: NormalizedCapabilityRegistration) {
  return [
    registration.version ? `version=${registration.version}` : undefined,
    registration.versionRange
      ? `versionRange=${registration.versionRange}`
      : undefined,
    registration.fallback ? "fallback" : undefined,
  ]
    .filter(Boolean)
    .join(", ");
}
