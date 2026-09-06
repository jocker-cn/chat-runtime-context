# Markdown Inline Tokens

Use this reference for market-owned inline tokens. Ordinary markdown styling belongs with UI development.

## Inspect first

- `configuration/model/MarkdownConfig.ts`
- `app.yml` or the relevant `z_config/app-*.yml`
- `markdown/MarkdownMessage.tsx`
- `markdown/inlineTokens/runtime.ts`
- `markdown/inlineTokens/resolveInlineTokenPipeline.ts`
- `markdown/inlineTokens/createInlineTokenRenderPlugins.ts`
- `markdown/inlineTokens/yaml.ts`
- `markdown/inlineTokens/transformRegistry.ts`
- Market-owned transforms under `components/.../transform/`
- Caller context owners such as `components/chatbot/StructuredMessageContent.tsx`

## Pipeline and ownership

1. YAML selects a rule through `matcher` and `transform` names.
2. A market-owned transform provides `name`, `transform`, and optional `render` behavior.
3. The public registry binds the transform name to implementation code.
4. Remark emits minimal `inline-token` nodes.
5. The renderer reconstructs the token and passes runtime data through inline-token context.

- Keep markdown Core generic; business meaning and rendering belong to market transforms.
- Access configuration through `MarkdownConfig`; do not hardcode market branches in markdown Core.
- Keep transform output minimal and serializable, usually `{ value }` plus necessary metadata.
- Pass caller data through generic `InlineTokenContext`, not serialized business objects in node props.
- Prefer transform-owned rendering over business renderer maps in `MarkdownMessage` or feature components.
- Preserve inline flow and ordinary markdown output when enhanced data is absent or intentionally hidden.
- Use namespaced transform names and keep distinct rule identities when shared matchers have different behavior or data requirements.

## Validation and diagnosis

- Verify only affected layers: markdown rendering, pipeline resolution, transform registry, the owning market transform, or the ordinary fallback path.
- Works in tests but not runtime: inspect YAML escaping and configuration-pipeline reinitialization.
- Text assertion differs: inspect the containing paragraph and token wrapper before assuming a standalone text node.
- Architecture starts spreading: restore the boundary—YAML chooses, registry resolves, markdown Core transports, market code renders.
