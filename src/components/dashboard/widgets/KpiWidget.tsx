"use client";

import { useMemo } from "react";
import {
  Building2,
  CheckCircle2,
  DollarSign,
  ShieldAlert,
  TrendingUp,
  Users,
  Activity,
  Ruler,
  Home as HomeIcon,
} from "lucide-react";
import { cn, formatCompact, formatNumber } from "@/lib/utils";
import { classifyDealPhase } from "@/lib/phase-classification";
import type { WidgetRenderProps } from "../types";

type KpiMetric =
  | "active_deals"
  | "pipeline_value"
  | "decisions_due"
  | "follow_ups"
  | "total_units"
  | "total_sf"
  | "acquisition_count"
  | "development_count"
  | "construction_count"
  | "avg_score";

const METRIC_LABEL: Record<KpiMetric, string> = {
  active_deals: "Active Deals",
  pipeline_value: "Pipeline Value",
  decisions_due: "Tasks Due",
  follow_ups: "Follow-Ups",
  total_units: "Total Units",
  total_sf: "Total SF",
  acquisition_count: "Acquisition",
  development_count: "Development",
  construction_count: "Under Construction",
  avg_score: "Avg Quant Score",
};

const METRIC_ICON: Record<KpiMetric, typeof Building2> = {
  active_deals: Building2,
  pipeline_value: DollarSign,
  decisions_due: ShieldAlert,
  follow_ups: Users,
  total_units: HomeIcon,
  total_sf: Ruler,
  acquisition_count: Activity,
  development_count: TrendingUp,
  construction_count: CheckCircle2,
  avg_score: TrendingUp,
};

export const KPI_METRICS: { value: KpiMetric; label: string }[] = (
  Object.keys(METRIC_LABEL) as KpiMetric[]
).map((k) => ({ value: k, label: METRIC_LABEL[k] }));

function computeMetric(metric: KpiMetric, data: WidgetRenderProps["data"]): { value: string; sub?: string } {
  const { deals, decisionsDueCount, followUpsCount } = data;
  const active = deals.filter((d) => !["dead", "archived"].includes(d.status));
  const dealCost = (d: (typeof deals)[number]) =>
    (d.total_project_cost && d.total_project_cost > 0 ? d.total_project_cost : d.asking_price) || 0;
  const phaseOf = (d: (typeof deals)[number]) => classifyDealPhase(d).phases;

  switch (metric) {
    case "active_deals":
      return { value: formatNumber(active.length), sub: `${deals.length} total` };
    case "pipeline_value": {
      const total = active.reduce((s, d) => s + dealCost(d), 0);
      return { value: `$${formatCompact(total)}` };
    }
    case "decisions_due":
      return { value: formatNumber(decisionsDueCount) };
    case "follow_ups":
      return { value: formatNumber(followUpsCount) };
    case "total_units":
      return { value: formatNumber(active.reduce((s, d) => s + (d.units ?? 0), 0)) };
    case "total_sf":
      return { value: formatCompact(active.reduce((s, d) => s + (d.square_footage ?? 0), 0)) };
    case "acquisition_count":
      return { value: formatNumber(active.filter((d) => phaseOf(d).includes("acquisition")).length) };
    case "development_count":
      return { value: formatNumber(active.filter((d) => phaseOf(d).includes("development")).length) };
    case "construction_count":
      return { value: formatNumber(active.filter((d) => phaseOf(d).includes("construction")).length) };
    case "avg_score": {
      const scored = active.filter((d) => d.quant_composite != null);
      if (scored.length === 0) return { value: "—" };
      const avg = scored.reduce((s, d) => s + (d.quant_composite || 0), 0) / scored.length;
      return { value: avg.toFixed(1), sub: `${scored.length} scored` };
    }
  }
}

export function KpiWidget({ data, instance }: WidgetRenderProps) {
  const metric = (instance.config?.metric as KpiMetric) ?? "active_deals";
  const Icon = METRIC_ICON[metric];
  const result = useMemo(() => computeMetric(metric, data), [metric, data]);

  return (
    <div className="flex h-full flex-col justify-between gap-2 p-4">
      <div className="flex items-center justify-between text-2xs font-medium uppercase tracking-[0.18em] text-muted-foreground/70">
        <span className="truncate">{METRIC_LABEL[metric]}</span>
        <Icon className="h-3.5 w-3.5 flex-shrink-0 text-primary/60" />
      </div>
      <div className="min-w-0">
        <div className={cn("font-nameplate tracking-tight text-foreground", "text-3xl xl:text-4xl")}>
          {result.value}
        </div>
        {result.sub && <div className="mt-1 text-xs text-muted-foreground">{result.sub}</div>}
      </div>
    </div>
  );
}

export function KpiConfig({ instance, onConfigChange }: WidgetRenderProps) {
  const current = (instance.config?.metric as KpiMetric) ?? "active_deals";
  return (
    <label className="flex flex-col gap-2 text-xs">
      <span className="font-medium uppercase tracking-[0.15em] text-muted-foreground">Metric</span>
      <select
        value={current}
        onChange={(e) => onConfigChange({ ...(instance.config ?? {}), metric: e.target.value })}
        className="rounded-md border border-border/60 bg-background px-2.5 py-1.5 text-sm"
      >
        {KPI_METRICS.map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
      </select>
    </label>
  );
}
