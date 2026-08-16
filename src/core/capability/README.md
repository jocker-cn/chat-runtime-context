# Capability Registry (v1)

The registry separates market/version-specific implementations from consuming
flows. Registration declarations are collected while modules are imported;
indexes are linked lazily on first resolution or explicitly with `link()`.

## Register with decorators

TypeScript decorators cannot target top-level functions. Decorator syntax is
therefore supported on public static methods (and class components):

```tsx
import { RegisterComponent, RegisterFunction } from "../../core";

class OrderCapabilities {
  @RegisterFunction({
    name: "order-validator",
    market: "cn",
    version: "2.1.0",
  })
  static validate(order: Order) {
    return order.items.length > 0;
  }

  @RegisterComponent({
    name: "order-submit",
    market: "cn",
    versionRange: ">=2 <3",
  })
  static Submit(props: SubmitProps) {
    return <button onClick={props.onSubmit}>Submit</button>;
  }
}
```

When a top-level function or function component is preferred, use the direct
definition helpers. They return the original implementation:

```tsx
export const Submit = defineComponentCapability(
  { name: "order-submit", version: "2.1.0" },
  function Submit(props: SubmitProps) {
    return <button>{props.label}</button>;
  },
);
```

## Get stable lazy references

`getFunction` and `getComponent` do not resolve immediately. They return stable
references bound to the supplied condition, so they are safe to declare at
module scope before every capability module has finished loading.

```ts
const validateOrder = capabilityRegistry.getFunction<
  (order: Order) => ValidationResult
>("order-validator", {
  market: "cn",
  version: "2.1.0",
});

const result = validateOrder(order);
```

The function return type is not constrained: synchronous implementations stay
synchronous and asynchronous implementations keep their Promise return type.

## Resolution order

1. current market exact version;
2. global (`*`) exact version;
3. current market version range;
4. global version range;
5. current market fallback;
6. global fallback.

Priority is applied only between candidates at the same resolution level.
An entry may declare both `version` and `versionRange`: its exact version is
indexed first, while the range remains available when no exact entry matches.

## Loading modules

Decorators execute only when their module is imported. A Vite application can
eagerly load capability modules with a naming convention:

```ts
import.meta.glob("./**/*.capability.{ts,tsx}", { eager: true });
```

## Cycle detection boundary

V1 detects component render cycles and synchronous function cycles. The trace
contract is reserved for a later async-context implementation, but V1 does not
claim to detect function cycles that cross an `await` boundary.

