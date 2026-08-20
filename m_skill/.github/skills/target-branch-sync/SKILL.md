---
name: target-branch-sync
description: Synchronize a working branch with its target branch during pull conflicts, before a push, or while updating a pull request. Use for conflict resolution and branch replay; do not use for ordinary commit-message generation.
---

# Target Branch Sync

Treat the target branch as the source of truth for structure, contracts, and behavior. Reapply only the working branch's still-required change on top.

## Workflow

1. Identify the target branch and inspect incoming target changes before resolving.
2. Resolve conflicts for target-branch correctness first.
3. Reapply the current branch's required behavior without restoring obsolete target code.
4. Inspect every file changed by the sync for missed imports, signatures, removals, or stale assumptions.
5. Run the narrowest relevant validation, then the delivery checks required for push or pull-request update.

## Stop condition

If it is unclear which behavior should survive, or the conflict implies a product or contract decision, stop and request human direction.

Avoid blindly taking either side, restoring an older local structure, minimizing the diff while preserving a broken contract, or guessing between plausible resolutions.

