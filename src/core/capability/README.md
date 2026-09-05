# Capability Registry v2

Business capabilities select one implementation by name, kind, market and exact
version. Versions are case-sensitive identifiers (for example `2.1.0` or `v2`);
there is no semver range interpretation. Plain `getFunction(...)(...)` remains
supported and preserves synchronous values and Promise identity.

## Selection and migration

Selection order:

1. market + exact version;
2. global market (`*`) + exact version;
3. market + explicit versionless fallback;
4. global market (`*`) + explicit versionless fallback.

The query's `version` is optional. Omitting it, or passing an empty/whitespace
string, selects only market fallback then global fallback; exact implementations
are not considered. Invalid non-empty versions still fail validation. If no
fallback exists, lookup throws CapabilityNotFoundError. Registration metadata
still requires an explicit version or `fallback: true`.

`CapabilityCondition` is the optional query input. `NormalizedCapabilityCondition`
is the immutable internal snapshot with a resolved market and
`version: string | undefined`. Copy both definitions together when integrating
this directory; the query version must not be redeclared as required.

The unused `CapabilityTrace`/`CapabilityComponent` aliases and legacy `link()`
entry point have been removed. Registration and module commit already validate
their index atomically; no separate linking step is needed.

```ts
registry.getFunction<() => string[]>("columns", { market: "cn" })();
registry.getComponent<SummaryProps>("summary", {}); // global fallback
```

A fallback can serve all future versions without duplicate registrations:

```ts
{ name: "summary", market: "cn", version: "2.1.0" }
{ name: "summary", market: "cn", fallback: true }
{ name: "summary", market: "*", fallback: true }
```

A registration must have either `version` or `fallback: true`, never both.
Omitting market means `*`. The same slot cannot have two implementations.
`versionRange` and `priority` are removed, including runtime rejection of old
metadata from JavaScript. Replace a range with the explicit supported versions
(or a deliberate fallback). Duplicates now fail at registration/commit, not on
first render. Different market overrides are not duplicates.

## Registration-driven module lifecycle

The registry does not listen for Next.js, Webpack or Vite hot events. Handling
repeated registrations is a registry responsibility, regardless of why the
calling code executes again.

- Registering the exact same implementation object with the same metadata/source
  is a no-op. It neither adds a declaration nor emits an update notification.
- Re-evaluating a file can produce new function/component objects. Use a stable
  module ID and commit its declarations as a group: the new group replaces the
  previous group, without waiting for or requiring a dispose/hot callback.
- Different modules claiming the same slot still conflict. Class/method source
  strings are diagnostic labels and cannot identify a file unambiguously.
- Keep the shared registry instance in its own module. Declaration modules
  import that instance; they do not create a new registry per evaluation.

```tsx
import { createCapabilityDecorators } from "./core/capability";
import { registry } from "./registry";

const capabilities = registry.createModule(
  "src/features/fund/fund.capabilities.tsx",
);
const { RegisterComponent, RegisterFunction } =
  createCapabilityDecorators(capabilities);

class FundCapabilities {
  @RegisterComponent({ name: "summary", version: "2.1.0", market: "cn" })
  static Summary({ title }: { title: string }) {
    return <div>{title}</div>;
  }

  @RegisterFunction({ name: "columns", fallback: true })
  static columns() {
    return ["name", "price"];
  }
}
void FundCapabilities;
capabilities.commit();
```

Every evaluation creates a fresh collection handle with the SAME module ID.
Do not reuse a committed handle to collect another generation. The registry
itself can remain unchanged while any number of declaration modules re-evaluate.

Lifecycle:

- Declarations collect locally; consumers keep seeing the committed generation.
- `commit()` validates the entire new set before atomically replacing all
  declarations owned by that module ID. Renamed/deleted declarations disappear.
- A failed evaluation or conflicting commit preserves the old committed group.
- Registering the identical declaration twice while collecting is also a no-op.
- Call `capabilities.dispose()` explicitly when a feature/plugin is truly
  unloaded. This removes only the generation owned by that handle; a stale
  handle cannot remove a newer generation.
- To remove all declarations during re-evaluation, commit an empty module group.
  If a file is removed without executing any replacement/cleanup code, the
  registry cannot infer that deletion; the owner must explicitly dispose it.
- Change notifications are batched in a microtask after successful publication.
  No temporary deletion is needed when replacing a module group.

Use an explicit unique file path for module ID. Full module URLs also work;
Vite's `?t=...` timestamp is stripped, without adding any HMR callback handling.
Do not use a class name as the module ID.

Do not register inside React render or effects. Side-effect import implementation
modules before rendering consumers. Dynamic import is allowed, but the caller
must await it before first use. This is not an automatic module scanner.

Standalone registration supports identical-object idempotency. If re-evaluation
creates a new object, it needs module ownership to be recognized as replacement;
the registry deliberately does not silently overwrite based on source names.

## Const functions and components

Helpers accept a module registrar, so const declarations receive identical
cleanup behavior:

```ts
const capabilities = registry.createModule("src/features/fund/columns.ts");
export const columns = defineFunctionCapability(
  { name: "columns", fallback: true },
  () => ["name", "price"],
  capabilities,
);
capabilities.commit();
```

Decorators support public static/instance methods and React class components.
Method implementations do not receive a containing class instance. Do not use
`this` in decorated methods. Top-level functions cannot use TS decorator syntax.

## React updates and state

```tsx
const Summary = registry.getComponent<SummaryProps>("summary", condition);
return <Summary title="Fund" />;
```

Returned components subscribe to registry revisions internally. Committing or
disposing a module triggers mounted consumers without relying on parent renders.
Currently notification granularity is one registry: nested function changes also
refresh registered component consumers. Use separate registries for independent
application domains if broad refresh becomes expensive.

Function results in an ordinary React component need one boundary subscription:

```tsx
function Toolbar() {
  useCapabilityRevision(registry);
  const columns = registry.getFunction<() => string[]>("columns", condition)();
  return <div>{columns.join(", ")}</div>;
}
```

No useMemo is required for reference lookup. Results are not memoized. Event
handlers invoking existing lazy references resolve the latest implementation.

`getComponent` returns condition-bound types; changing market/version changes
that wrapper type and can reset state. If conditions may change in place, use:

```tsx
<CapabilityView
  registry={registry}
  name="summary"
  condition={condition}
  componentProps={{ title: "Fund" }}
/>
```

CapabilityView is a stable React boundary. If resolution selects the same
implementation (for example the same fallback for two versions), local state is
preserved. Selecting a different implementation still remounts it. State that
must survive implementation changes belongs above this boundary.

Replacing a component function during HMR may also reset its state; the registry
does not promise React Fast Refresh state preservation. A pure function can run
during rendering; requests and other effects still follow ordinary React rules.

## Shared TypeScript contracts (opt-in)

```tsx
interface Functions {
  columns: () => string[];
}
interface Components {
  summary: { title: string };
}
const api = createTypedCapabilities<Functions, Components>(registry);
const registration = api.forModule(capabilities);
registration.registerFunction("columns", { fallback: true }, () => ["name"]);
registration.registerComponent("summary", { fallback: true },
  ({ title }) => <div>{title}</div>);
const columns = api.getFunction("columns", condition)(); // inferred string[]
```

Use the same shared contract for all modules/consumers in a domain. Raw generic
getters and decorators remain flexible escape hatches; they cannot prove that
a string name has the signature claimed by its caller.

## Diagnostics

`explain(name, kind, condition)` reports selected module/source/level and every
candidate with one of: selected, version-mismatch, market-mismatch,
lower-precedence. It never executes an implementation. It is selection
diagnostics, not automatic tracing of a nested call graph.

## Boundaries

Synchronous function and ancestor component cycle checks remain conservative:
they reject recursive reuse even when application data would terminate it.
Cycles across await are not detected. Hooks belong in registered components,
not dynamically selected ordinary functions. No runtime Hook enforcement is
provided.

Registry declarations should be shared immutable implementations on the server;
do not place request/user state inside a global registry or mutate it per request.
Server and client must load equivalent selections for hydration. React server
components and cross-request async context are outside this client's runtime
contract. `clear()` removes declarations but keeps lazy-reference identities;
scope registry lifetime to the application/domain to bound reference caches.
