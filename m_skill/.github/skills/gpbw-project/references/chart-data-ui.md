# Chart Data UI

## Inspect first

- `services/chart-data-service.ts`
- `configuration/model/ChartConfig.ts`
- `components/charts/lineChart/LineChart.tsx`
- `components/charts/lineChart/LinePerformanceChart.tsx`
- `components/charts/lineChart/lineChartUtils.ts`
- `components/charts/lineChart/types.ts`
- `components/charts/lineChart/TooltipContent.ts`
- `components/charts/pieChart/PieChart.tsx`
- `markdown/MarkdownChartComponent.tsx`

## Ownership

- Keep vendor selection in configuration and dispatch through a factory.
- Services return chart-ready UI shapes; raw backend payloads do not belong in components.
- `LineChart` owns lifecycle, option building, tooltip hooks, loading, and incremental series updates.
- A parent owns range controls, fund add/remove behavior, legend content, and composition layout.
- Shared date, range, and tooltip helpers belong in `lineChartUtils.ts`; shared chart models belong in `types.ts`.

## Runtime and validation

- Register only required ECharts modules, prefer the SVG renderer, and clean up listeners, observers, and chart instances.
- Keep tooltip rendering separate from the chart engine.
- Preserve stable series IDs and color order.
- If an issue looks visual, verify data shape, lifecycle cleanup, and container ownership before changing styling.
