---
name: skill-design
description: Design, create, revise, split, merge, audit, or remove repository skills under `.github/skills/`. Use when skill discovery, responsibility boundaries, progressive disclosure, references, or maintenance structure must change; do not use for ordinary project documentation.
---

# Skill Design

Design for reliable discovery and decisions, not for maximum instruction volume.

## Workflow

1. Collect realistic requests that should and should not activate the skill.
2. Inventory existing skills, repository instructions, references, scripts, and callers that overlap the proposed responsibility.
3. Choose among revise, merge, split, create, or delete before writing content.
4. Define one observable responsibility and a discriminating description.
5. Put always-needed routing and constraints in `SKILL.md`; move conditional detail into focused resources.
6. Remove superseded text and resources, then run the regression checks in [references/review-checklist.md](references/review-checklist.md).

Read [references/structure-and-templates.md](references/structure-and-templates.md) when creating a folder, frontmatter, reference layout, or reusable template.

## Responsibility boundaries

- One skill owns one coherent capability or decision process with an independent trigger.
- Merge narrow repository facts into a parent domain skill when they do not have a distinct workflow or discovery need.
- Keep a subsystem independent when it has substantial non-obvious contracts, multiple focused references, or requests that should route to it directly.
- Split only when sections have different triggers, owners, or validation paths.
- Prefer revising or merging an overlap over adding a router whose only job is to point at other skills.

## Discovery

- Use a lowercase hyphenated folder and matching `name`.
- Make `description` state the capability and concrete trigger terms. Add exclusions only when they prevent likely misrouting.
- Treat frontmatter as discovery metadata, not as a second instruction document.
- Use only fields supported by every target host. For portable GPT/Copilot repository skills, default to `name` and `description`.
- Do not invent dependency metadata such as `pair_with`. Mention another skill in the body only when the host can resolve that name and the task genuinely needs both.

## Content

- Preserve non-obvious knowledge that changes routing, ownership, implementation, or validation decisions.
- Delete persona claims, generic model abilities, motivational language, duplicated repository rules, and speculative edge cases.
- Write contract facts directly. Examples and cultural references are useful only when the actionable rule remains clear without recognizing the reference.
- Link references from `SKILL.md` and say when to read them. Do not create orphan references, READMEs, changelogs, placeholders, or duplicate quick references.
- Put deterministic repeated operations in `scripts/` and reusable output resources in `assets/`; do not create either directory without a real consumer.
- Keep paths and APIs exact. If they cannot be verified, instruct the agent to inspect the owning definition and current consumers instead of inventing details.

## Editing existing skills

- Identify the non-obvious behavior that must survive before reducing or moving text.
- Compare triggers and ownership across neighboring skills, not just duplicated sentences.
- When merging, update the surviving description and routing so deleted trigger terms remain discoverable.
- When deleting, remove stale cross-links and verify that every retained fact has a new owner.
- Keep edits scoped to skill behavior; do not silently change product or repository policy while reorganizing it.
