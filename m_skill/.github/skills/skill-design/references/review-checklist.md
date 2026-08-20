# Skill Regression Checklist

## Discovery

- Folder name and frontmatter `name` match.
- YAML parses and contains the fields supported by the target host.
- The description distinguishes this skill from its nearest neighbors.
- Trigger terms removed during a merge still appear in the surviving skill's discovery text when needed.

## Responsibility

- The skill has one coherent capability or decision process.
- No neighboring skill owns the same rule, workflow, or reference.
- Repository-wide policy remains in `AGENTS.md` or the host instruction file rather than being copied into multiple skills.
- Narrow facts without an independent workflow live in the relevant parent skill reference.

## Resources

- Every linked reference exists and every retained reference is reachable from `SKILL.md`.
- No deleted skill is still named by routing text or instructions.
- Scripts are deterministic, executable in the target environment, and tested when present.
- No README, changelog, placeholder, empty resource directory, or stale example remains.

## Behavior

- Test at least one request that should activate the skill.
- Test an adjacent request that should route elsewhere.
- Confirm conditional references are loaded only for their branch.
- Confirm constraints are actionable without relying on a quotation, named principle, or unstated background knowledge.
- Run the available skill validator; otherwise parse frontmatter and check local links programmatically.
