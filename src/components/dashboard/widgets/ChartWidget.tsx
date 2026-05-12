"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { classifyDealPhase } from "@/lib/phase-classification";
import { DEAL_PIPELINE, DEAL_STAGE_LABELS, type DealStatus } from "@/lib/types";
import { formatCompact } from "@/lib/utils";
import type { WidgetRenderProps } from "../types";

type ChartType = "bar" | "pie";
type GroupBy = "stage" | "phase" | "property_type";
type Metric = "count" | "value" | "units" | "sf";

const PHASE_COLORS: Record<string, string> = {
  acquisition: "#6366f1",
  development: "#f59e0b",
  construction: "#10b981",
  none: "#71717a",
};

const STAGE_COLORS: Record<DealStatus, string> = {
  sourcing: "#a1a1aa",
  screening: "#60a5fa",
  loi: "#fbbf24",
  under_contract: "#fb923c",
  diligence: "#a78bfa",
  closing: "#34d399",
  closed: "#10b981",
  dead: "#f87171",
  archived: "#71717a",
};

const PALETTE = ["#6366f1", "#f59e0b", "#10b981", "#f87171", "#a78bfa", "#60a5fa", "#fbbf24", "#34d399"];

function metricValue(metric: Metric, d: WidgetRenderProps["data"]["deals"][number]) {
  switch (metric) {
    case "count":
      return 1;
    case "value":
      return (d.total_project_cost && d.total_project_cost > 0 ? d.total_project_cost : d.asking_price) || 0;
    case "units":
      return d.units ?? 0;
    case "sf":
      return d.square_footage ?? 0;
  }
}

export function ChartWidget({ data, instance }: WidgetRenderProps) {
  const chartType = (instance.config?.chartType as ChartType) ?? "bar";
  const groupBy = (instance.config?.groupBy as GroupBy) ?? "phase";
  const metric = (instance.config?.metric as Metric) ?? "count";
  const includeInactive = Boolean(instance.config?.includeInactive);

  const series = useMemo(() => {
    const deals = includeInactive
      ? data.deals
      : data.deals.filter((d) => !["dead", "archived"].includes(d.status));

    if (groupBy === "stage") {
      return DEAL_PIPELINE.map((stage) => {
        const subset = deals.filter((d) => d.status === stage);
        const value = subset.reduce((s, d) => s + metricValue(metric, d), 0);
        return { name: DEAL_STAGE_LABELS[stage], key: stage, value, color: STAGE_COLORS[stage] };
      }).filter((s) => s.value > 0 || metric === "count");
    }

    if (groupBy === "phase") {
      const buckets: Record<string, number> = { acquisition: 0, development: 0, construction: 0 };
      for (const d of deals) {
        const phases = classifyDealPhase(d).phases;
        if (phases.length === 0) {
          buckets.none = (buckets.none ?? 0) + metricValue(metric, d);
        } else {
          for (const p of phases) buckets[p] = (buckets[p] ?? 0) + metricValue(metric, d);
        }
      }
      return Object.entries(buckets).map(([key, value]) => ({
        name: key === "acquisition" ? "Acquisition" : key === "development" ? "Development" : key === "construction" ? "Under Construction" : "Unassigned",
        key,
        value,
        color: PHASE_COLORS[key],
      }));
    }

    // property_type
    const buckets: Record<string, number> = {};
    for (const d of deals) {
      const key = d.property_type ?? "other";
      buckets[key] = (buckets[key] ?? 0) + metricValue(metric, d);
    }
    return Object.entries(buckets).map(([key, value], idx) => ({
      name: key.replace(/_/g, " "),
      key,
      value,
      color: PALETTE[idx % PALETTE.length],
    }));
  }, [data.deals, groupBy, metric, includeInactive]);

  const fmt = (v: number) => (metric === "value" ? `$${formatCompact(v)}` : metric === "sf" ? formatCompact(v) : String(v));

  if (chartType === "pie") {
    return (
      <div className="h-full w-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={series} dataKey="value" nameKey="name" outerRadius="75%" innerRadius="45%" stroke="none">
              {series.map((s) => (
                <Cell key={s.key} fill={s.color} />
              ))}
            </Pie>
            <Tooltip formatter={(v) => fmt(Number(v))} contentStyle={{ background: "#0a0a0a", border: "1px solid #27272a", borderRadius: 8, fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
          </PieChart>
        </ResponsiveContainer>
      </div>
    );
  }

  return (
    <div className="h-full w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={series} margin={{ top: 10, right: 14, bottom: 6, left: 0 }}>
          <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#a1a1aa" }} axisLine={{ stroke: "#27272a" }} tickLine={false} interval={0} angle={-20} dy={6} height={50} />
          <YAxis tick={{ fontSize: 10, fill: "#a1a1aa" }} axisLine={{ stroke: "#27272a" }} tickLine={false} tickFormatter={(v) => fmt(v as number)} width={50} />
          <Tooltip formatter={(v) => fmt(Number(v))} contentStyle={{ background: "#0a0a0a", border: "1px solid #27272a", borderRadius: 8, fontSize: 12 }} cursor={{ fill: "#27272a40" }} />
          <Bar dataKey="value" radius={[6, 6, 0, 0]}>
            {series.map((s) => (
              <Cell key={s.key} fill={s.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ChartConfig({ instance, onConfigChange }: WidgetRenderProps) {
  const cfg = instance.config ?? {};
  const set = (patch: Record<string, unknown>) => onConfigChange({ ...cfg, ...patch });
  return (
    <div className="grid grid-cols-2 gap-3 text-xs">
      <label className="flex flex-col gap-1.5">
        <span className="font-medium uppercase tracking-[0.15em] text-muted-foreground">Chart Type</span>
        <select
          value={(cfg.chartType as string) ?? "bar"}
          onChange={(e) => set({ chartType: e.target.value })}
          className="rounded-md border border-border/60 bg-background px-2.5 py-1.5 text-sm"
        >
          <option value="bar">Bar</option>
          <option value="pie">Pie</option>
        </select>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="font-medium uppercase tracking-[0.15em] text-muted-foreground">Group By</span>
        <select
          value={(cfg.groupBy as string) ?? "phase"}
          onChange={(e) => set({ groupBy: e.target.value })}
          className="rounded-md border border-border/60 bg-background px-2.5 py-1.5 text-sm"
        >
          <option value="phase">Phase</option>
          <option value="stage">Pipeline Stage</option>
          <option value="property_type">Property Type</option>
        </select>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="font-medium uppercase tracking-[0.15em] text-muted-foreground">Metric</span>
        <select
          value={(cfg.metric as string) ?? "count"}
          onChange={(e) => set({ metric: e.target.value })}
          className="rounded-md border border-border/60 bg-background px-2.5 py-1.5 text-sm"
        >
          <option value="count">Deal Count</option>
          <option value="value">Pipeline Value</option>
          <option value="units">Units</option>
          <option value="sf">Square Footage</option>
        </select>
      </label>
      <label className="flex items-end gap-2">
        <input
          type="checkbox"
          checked={Boolean(cfg.includeInactive)}
          onChange={(e) => set({ includeInactive: e.target.checked })}
          className="h-4 w-4 rounded border-border/60"
        />
        <span className="text-xs text-muted-foreground">Include dead/archived</span>
      </label>
    </div>
  );
}
