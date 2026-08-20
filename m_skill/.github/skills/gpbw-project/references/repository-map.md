# Repository Map

Use this map to find likely owners. Confirm the current code before editing; paths may evolve.

## Application areas

- Configuration: `configuration/model/`, `configuration/ConfigurationManager.ts`, `configuration/ConfigLoaderImpl.ts`, `configuration/SchemaManifest.ts`
- Services: `services/`, `utils/apiClient.ts`, `utils/request.ts`
- Zustand: `state/zustand/`, `state/zustand/createZustandStore.ts`, `state/zustand/fundTable/fundTableStore.ts`
- Chart data and UI: `services/chart-data-service.ts`, `configuration/model/ChartConfig.ts`, `components/charts/lineChart/`, `components/charts/pieChart/`, `markdown/MarkdownChartComponent.tsx`
- Markdown inline extensions: `configuration/model/MarkdownConfig.ts`, `markdown/inlineTokens/`, `components/chatbot/message/transform/`, `components/chatbot/StructuredMessageContent.tsx`
- Responsive components and modals: the owning component and its paired `*.style.ts` or `*.styles.ts`

## Core areas

- Runtime contracts: `core/chat/contracts/chat-runtime.ts`
- Runtime, source, context, render layers: `core/chat/runtime/`, `core/chat/source/`, `core/chat/context/ChatContext.tsx`, `core/chat/frame/`, `core/chat/view/`
- Local errors and demo runtime: `core/chat/operations/errorMessages.ts`, `chat/demo/demoRuntime.ts`, `chat/demo/demoRenderer.tsx`, `pages/chat-runtime-context.tsx`
- Queue: `core/queue/`, `core/chat/queue/createChatRuntimeQueueTarget.ts`
- Capability registry: `core/capability/`, especially `CapabilityRegistry.tsx`, `decorators.ts`, and `README.md`

## Ownership chain to remember

For fund selection, inspect this order before unrelated rendering code:

`FundTable` -> `fundTableStore` -> `RightPanel` -> `FundComparisonModal`

