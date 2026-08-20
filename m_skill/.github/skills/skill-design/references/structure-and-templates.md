# Structure and Templates

## Default structure

```text
.github/skills/<skill-name>/
├── SKILL.md
├── references/   # optional, loaded only for the relevant branch
├── scripts/      # optional deterministic operations
└── assets/       # optional reusable output resources
```

Only `SKILL.md` is required. Omit empty optional directories.

## Minimal portable `SKILL.md`

```markdown
---
name: capability-name
description: Perform a concrete capability. Use when requests mention observable trigger A, B, or C; do not use for adjacent concern D.
---

# Capability Name

State the outcome or governing boundary in one sentence.

## Workflow

1. Inspect the concrete owner or input.
2. Make the decision that this skill uniquely governs.
3. Apply the smallest correct operation.
4. Validate the affected behavior.

Read the relevant file under `references/` only when its stated condition applies.

## Constraints

- Include only rules that materially change execution.
```

## Reference design

- Give each reference one topic and a descriptive filename.
- Put schemas, long examples, subsystem maps, and mode-specific procedures in references.
- Keep the decision that selects a reference in `SKILL.md`.
- Avoid reference chains deeper than one hop unless the domain cannot be represented clearly otherwise.
