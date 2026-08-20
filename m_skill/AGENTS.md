# Repository Guidance

Keep this file limited to repository-wide facts and constraints that should affect nearly every task. Task-specific workflows live in `.github/skills/` and should be loaded only when their descriptions match the request.

## Repository baseline

- This is a Next.js and TypeScript front end for an AI chat experience.
- Use `pnpm` for project commands.
- Primary areas are `pages/`, `components/`, `core/`, `state/`, `services/`, `configuration/`, and `utils/`.
- Runtime configuration comes from `app.yml` and `z_config/app-*.yml`, is loaded by `configuration/ConfigLoaderImpl.ts`, and is read through `ConfigurationManager`.

## Change boundaries

- Locate the behavior's actual owner and failing boundary before choosing the edit scope.
- Follow nearby working patterns and reuse an existing owner, repository path, or utility before adding a parallel abstraction or dependency.
- Keep the requested change focused. Do not include unrelated cleanup, formatting churn, speculative hooks, flags, caches, or future-path configuration.
- When replacing legacy behavior, migrate one owner at a time: add, validate, switch, then remove.
- Preserve public contracts unless the requested behavior requires changing them.

## Data contracts

- Treat user-stated invariants, required typed fields, and data already normalized by an owning boundary as guaranteed.
- Access guaranteed fields directly. Do not add optional chaining, null checks, default values, type coercion, normalization, fallback branches, or `try/catch` merely in case the contract is violated.
- Validate or normalize untrusted data once at its owning boundary. Downstream code should rely on the resulting contract instead of repeating defensive checks.
- Add fallback or compatibility behavior only for a documented requirement, an observed input case, an existing compatibility contract, or a focused test. Do not create a one-off fallback for a single field or call site without such evidence.
- If repository evidence contradicts a stated invariant, report the contract conflict instead of silently broadening the implementation.

## High-value invariants

- Read configuration through `ConfigurationManager.getConfig(...)`; do not hardcode environment branches into features.
- Put new configuration models in `configuration/model/` and new application state in `state/zustand/`; treat `stores/` as a legacy bridge.
- Follow the existing request factory and `utils/apiClient.ts` response/interceptor conventions for service calls.
- Core chat runtime uses AG-UI `Message`, `AnswerSource`, `MessageReader`, turn/branch snapshots, and Frame-named render primitives. Do not reintroduce retired frame-commit APIs.
- Generic queue contracts, scheduling, policies, and React bindings belong in `core/queue/`; chat-runtime conversion belongs at the chat queue adapter boundary.
- Capability registrations are import-driven. Ensure registration modules load before resolving a capability.

## Validation and delivery

- Run the narrowest relevant check after a change, then expand only when the risk or delivery step warrants it.
- Report exact commands and outcomes. State clearly when a broader check was not run or is failing for an unrelated reason.
- Before a commit, push, or pull request, run affected tests or the closest relevant verification when no direct test exists.
- If the branch contains exactly one clear ticket such as `GPBWAI-3836`, prefix commit subjects and pull request titles with it. Do not guess an absent or ambiguous ticket.

## Terminal execution

- For one-off terminal checks such as tests, lint, build, `git diff`, or `git status`, end the command with `status=$?; exit $status` so the IDEA terminal wrapper stops waiting while preserving the command's real exit code.
- Do not use this pattern for long-running commands such as development servers, watch mode, interactive processes, or mock servers.
