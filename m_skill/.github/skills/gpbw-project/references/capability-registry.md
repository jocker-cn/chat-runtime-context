# Capability Registry

Use this reference for market- and version-specific functions or React components under `core/capability`.

## Ownership and imports

- `core/capability` owns registration, market/version resolution, lazy references, decorators, and capability lifecycle.
- Application composition decides which registration modules to load and which conditions to request.
- Import the public API from `@/core/capability`, not `@/core`.
- Keep business interpretation in the owning feature. Register only the lazy reference or constructor consumers need.

## Registration and loading

- Define top-level implementations with `defineFunctionCapability()` or `defineComponentCapability()`.
- Decorated methods must be public, return the original implementation, and not rely on `this`.
- Registration is an import side effect. Load established `*.capability.ts` or `*.capability.tsx` modules before resolution.
- Every registration declares a market plus a version, version range, or fallback. Duplicate signatures must fail during linking or first resolution.

## Resolution

- Resolve through `getFunction()` or `getComponent()` with a non-empty `condition.version`.
- Preserve precedence: market exact, global exact, market range, global range, market fallback, global fallback.
- Use `priority` only to break ties within one precedence level.
- Keep returned proxies stable at module scope and resolve only when invoked or rendered.
- Use `explain()` to diagnose an unexpected selection.

## Validation

- Test with an isolated `CapabilityRegistry`, or clear the shared registry after each test.
- Cover only affected cases among exact, fallback, range, priority, duplicate, unresolved, and synchronous or render-cycle behavior.
- Do not retain resolved implementations outside the lazy proxy or add a second capability mechanism for layout or transport semantics.
