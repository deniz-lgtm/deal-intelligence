"use client";

import type { WidgetDefinition, WidgetRenderProps } from "./types";
import { KpiWidget, KpiConfig } from "./widgets/KpiWidget";
import { ChartWidget, ChartConfig } from "./widgets/ChartWidget";
import { PhaseKanbanWidget } from "./widgets/PhaseKanbanWidget";

export const WIDGETS: Record<string, WidgetDefinition> = {
  kpi: {
    type: "kpi",
    label: "KPI Tile",
    description: "A single metric tile (active deals, pipeline value, etc.).",
    category: "kpi",
    defaultSize: { w: 3, h: 3, minW: 2, minH: 2 },
    render: (p) => <KpiWidget {...p} />,
  },
  chart: {
    type: "chart",
    label: "Chart",
    description: "Bar or pie chart grouped by stage, phase, or property type.",
    category: "chart",
    defaultSize: { w: 6, h: 7, minW: 4, minH: 5 },
    render: (p) => <ChartWidget {...p} />,
  },
  phase_kanban: {
    type: "phase_kanban",
    label: "Phase Pipeline",
    description: "Kanban of deals grouped by phase family (Acquisition / Development / Under Construction).",
    category: "kanban",
    defaultSize: { w: 12, h: 12, minW: 6, minH: 8 },
    render: (p) => <PhaseKanbanWidget {...p} />,
  },
};

export function renderWidgetConfig(type: string, props: WidgetRenderProps): React.ReactNode {
  switch (type) {
    case "kpi":
      return <KpiConfig {...props} />;
    case "chart":
      return <ChartConfig {...props} />;
    default:
      return <div className="text-xs text-muted-foreground">No configuration available.</div>;
  }
}

export const DEFAULT_DASHBOARD: { widgets: { id: string; type: string; config?: Record<string, unknown> }[]; layouts: { lg: { i: string; x: number; y: number; w: number; h: number }[] } } = {
  widgets: [
    { id: "kpi-active", type: "kpi", config: { metric: "active_deals" } },
    { id: "kpi-value", type: "kpi", config: { metric: "pipeline_value" } },
    { id: "kpi-decisions", type: "kpi", config: { metric: "decisions_due" } },
    { id: "kpi-followups", type: "kpi", config: { metric: "follow_ups" } },
    { id: "chart-phase", type: "chart", config: { chartType: "bar", groupBy: "phase", metric: "value" } },
    { id: "chart-stage", type: "chart", config: { chartType: "pie", groupBy: "stage", metric: "count" } },
    { id: "kanban-1", type: "phase_kanban" },
  ],
  layouts: {
    lg: [
      { i: "kpi-active", x: 0, y: 0, w: 3, h: 3 },
      { i: "kpi-value", x: 3, y: 0, w: 3, h: 3 },
      { i: "kpi-decisions", x: 6, y: 0, w: 3, h: 3 },
      { i: "kpi-followups", x: 9, y: 0, w: 3, h: 3 },
      { i: "chart-phase", x: 0, y: 3, w: 6, h: 7 },
      { i: "chart-stage", x: 6, y: 3, w: 6, h: 7 },
      { i: "kanban-1", x: 0, y: 10, w: 12, h: 12 },
    ],
  },
};
