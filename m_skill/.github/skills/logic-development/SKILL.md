---
name: logic-development
description: Implement business rules, data transformations, required field contracts, state transitions, defaults, validation, or compatibility behavior. Use when deciding whether data should be trusted, normalized, rejected, or given a fallback; do not use for CSS or visual layout.
---

# Logic Development

Implement the current business contract at the layer that owns it. Do not silently broaden the accepted input domain.

## Contract decision

1. Identify whether the value is trusted internal data or untrusted boundary input.
2. Treat user-stated invariants, required typed fields, and normalized internal values as guaranteed.
3. For untrusted input, validate or normalize once at the owning boundary.
4. After that boundary, rely on the normalized type and do not repeat defensive handling in consumers.

## Fallback threshold

Add a fallback, coercion, compatibility branch, or recovery path only when at least one of these exists:

- a documented product requirement;
- an observed payload or runtime case;
- an established compatibility contract;
- a focused test that represents supported behavior.

Do not add optional chaining, null checks, default values, `String(...)`, `Number(...)`, ad hoc normalization, or `try/catch` merely because a value could theoretically be malformed.

Keep validation and conversion reusable at the owner boundary. A fallback used for one field at one call site is normally evidence that the input contract has not been identified correctly.

If code or runtime evidence contradicts the stated contract, stop and report the mismatch rather than hiding it with defensive behavior.

Read [references/data-contracts.md](references/data-contracts.md) when choosing a boundary or reviewing a proposed fallback.
