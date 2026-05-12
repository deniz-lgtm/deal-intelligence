import type { Deal } from "@/lib/types";
import type { PhaseSignals } from "@/lib/phase-classification";

export interface DealWithStats extends Deal {
  document_count?: number;
  checklist_complete?: number;
  checklist_total?: number;
  total_project_cost?: number | null;
}

export interface DashboardData {
  deals: DealWithStats[];
  signals: Record<string, PhaseSignals>;
  decisionsDueCount: number;
  followUpsCount: number;
}

export type WidgetSize = "sm" | "md" | "lg" | "xl";

export interface WidgetLayout {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
}

export interface DashboardWidgetInstance {
  id: string;
  type: string;
  config?: Record<string, unknown>;
}

export interface DashboardLayoutState {
  widgets: DashboardWidgetInstance[];
  layouts: Record<string, WidgetLayout[]>;
}

export interface WidgetDefinition {
  type: string;
  label: string;
  description: string;
  category: "kpi" | "chart" | "kanban" | "list";
  defaultSize: { w: number; h: number; minW: number; minH: number };
  // Component is rendered with these props
  render: (props: WidgetRenderProps) => React.ReactNode;
}

export interface WidgetRenderProps {
  data: DashboardData;
  instance: DashboardWidgetInstance;
  onConfigChange: (config: Record<string, unknown>) => void;
}
