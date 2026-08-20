# Data Contracts

## Trust by source

| Source | Default treatment |
| --- | --- |
| User explicitly states the value is guaranteed | Use it directly |
| Required TypeScript field | Use it directly |
| Value returned by an internal owner under a typed contract | Follow that contract |
| Data already parsed by the repository schema or adapter | Use the normalized value directly |
| Raw external API payload | Validate in the service or adapter boundary |
| User-entered value | Validate at the input or form boundary |
| Persisted legacy data | Add compatibility only when migration support is required |
| Hypothetical future absence or alternate type | Do not implement |

## Review questions

Before accepting defensive logic, ask:

1. Which supported input demonstrates the need?
2. Which layer owns validating or normalizing that input?
3. Does an existing type, schema, adapter, or test already establish the contract?
4. Is the handling reusable at that owner, or is it a one-field workaround?
5. Would rejecting or reporting a contract mismatch be more correct than silently changing the value?

## Examples

When the contract guarantees a string:

```ts
const label = item.label;
```

Do not add speculative handling:

```ts
const label = typeof item.label === 'string'
  ? item.label
  : String(item.label ?? '');
```

When an external payload is genuinely untrusted, normalize it once in the adapter and expose a required typed field to the rest of the application.
