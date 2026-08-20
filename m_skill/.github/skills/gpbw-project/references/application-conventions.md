# Application Conventions

Read only the sections relevant to the files being changed.

## Configuration and services

- Access configuration through `ConfigurationManager.getConfig(SomeConfigClass)`.
- Put config models in `configuration/model/` and annotate them with `ConfigurationProperties('<prefix>')`.
- Preserve `next.config.js` profile, alias, `basePath`, and YAML loader behavior unless the task changes those contracts.
- Follow the existing `defaultRequest` or request-factory path for new service calls and pass query values through `params`.
- Preserve the wrapped response and interceptor conventions in `utils/apiClient.ts`.
- Do not mutate production configuration instances; development-only overrides belong in the development workflow.

## State

- Put new application state in `state/zustand/`; use `stores/` only as a legacy bridge.
- Keep ownership, normalization, persistence, cross-field rules, and high-frequency updates in the owning store or component.
- If a root provider changes, mock the new top-level owner in shallow tests.

## Component i18n

- Use `useAppTranslation('<prefix>')` for UI text.
- Add keys to `i18n/locales/en_GB/index.ts` and the matching locale files.
- Do not import `@/locales/*` inside components.
- Use `useCurrentLanguage()` when a language change must trigger recomputation outside `t(...)`.

## Non-component i18n

- Reuse boundaries such as `getFundNameWithI18N` or `rawTranslate`.
- Move locale work in this order: storage/source -> hook or config -> consumer -> test.
- Prefer the repository's i18n subscriptions over custom window events.

## Runtime UI state

- Use `runtimeKeyValueStore` only for low-frequency runtime UI state that does not need a domain store.
- Use string keys; prefer `namespace:key` for ownership and reserve `namespace` for future namespace operations.
- Subscribe to one key with `useValue(key, fallback)` instead of selecting the full values map.
- Use stable object or array defaults from `state/zustand/runtimeDefaults`; do not pass inline mutable fallbacks.

