"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Search, LayoutGrid, Ruler, Building, Trash2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { cn, formatCurrency } from "@/lib/utils";
import {
  UNIT_TYPES,
  UNIT_CATEGORY_LABELS,
  type UnitCategory,
  getUnitTypeById,
} from "@/lib/floor-plan-unit-types";

interface FloorPlanSummary {
  id: string;
  name: string;
  unit_type: string;
  bedrooms: number;
  bathrooms: number;
  square_footage: number | null;
  description: string | null;
  updated_at: string;
}

interface MetricSummary {
  floor_plan_id: string;
  rent_low: number | null;
  rent_high: number | null;
  market_count: number;
}

export default function FloorPlanLibraryPage() {
  const [plans, setPlans] = useState<FloorPlanSummary[]>([]);
  const [metricsByPlan, setMetricsByPlan] = useState<Record<string, MetricSummary>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [unitFilter, setUnitFilter] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<UnitCategory | "all">("all");

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/floor-plans");
        const json = await res.json();
        if (cancelled) return;
        const rows = (json.data ?? []) as FloorPlanSummary[];
        setPlans(rows);
        // Fan-out fetch metric summaries. Small N expected; if this grows we
        // add a dedicated summary endpoint.
        const summaries: Record<string, MetricSummary> = {};
        await Promise.all(
          rows.map(async (p) => {
            try {
              const r = await fetch(`/api/floor-plans/${p.id}`);
              const j = await r.json();
              const ms = (j.data?.metrics ?? []) as Array<{ monthly_rent: number | null }>;
              const rents = ms.map((m) => Number(m.monthly_rent)).filter((n) => Number.isFinite(n) && n > 0);
              summaries[p.id] = {
                floor_plan_id: p.id,
                rent_low: rents.length ? Math.min(...rents) : null,
                rent_high: rents.length ? Math.max(...rents) : null,
                market_count: ms.length,
              };
            } catch {
              summaries[p.id] = { floor_plan_id: p.id, rent_low: null, rent_high: null, market_count: 0 };
            }
          })
        );
        if (!cancelled) setMetricsByPlan(summaries);
      } catch (err) {
        console.error("Failed to load floor plans", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    return plans.filter((p) => {
      if (unitFilter && p.unit_type !== unitFilter) return false;
      if (categoryFilter !== "all") {
        const def = getUnitTypeById(p.unit_type);
        if (!def || def.category !== categoryFilter) return false;
      }
      if (search) {
        const q = search.toLowerCase();
        if (!p.name.toLowerCase().includes(q) && !p.description?.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [plans, unitFilter, categoryFilter, search]);

  const groupedByCategory = useMemo(() => {
    const groups: Record<UnitCategory, FloorPlanSummary[]> = { multifamily: [], townhouse: [], sfr: [] };
    for (const p of filtered) {
      const def = getUnitTypeById(p.unit_type);
      if (def) groups[def.category].push(p);
    }
    return groups;
  }, [filtered]);

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    await fetch(`/api/floor-plans/${id}`, { method: "DELETE" });
    setPlans((ps) => ps.filter((p) => p.id !== id));
  };

  return (
    <AppShell>
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="relative shrink-0 overflow-hidden border-b border-border/40">
          <div className="absolute inset-0 gradient-mesh" />
          <div className="relative px-6 py-5 sm:px-8">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h1 className="font-nameplate text-2xl leading-none tracking-tight">Floor Plan Repository</h1>
                <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                  Reusable unit-type plans with per-market rent &amp; cost metrics. Draw it once,
                  pull it into any deal.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/40" />
                  <input
                    type="text"
                    placeholder="Search plans..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-56 rounded-full border border-border/40 bg-background/60 py-1.5 pl-8 pr-3 text-xs placeholder:text-muted-foreground/40 focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/15"
                  />
                </div>
                <Button asChild size="sm">
                  <Link href="/floor-plans/new">
                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                    New Plan
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </header>

        <div className="shrink-0 border-b border-border/30 bg-card/30 px-6 py-3 sm:px-8">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/60 mr-1">Category</span>
            <CategoryChip label="All" active={categoryFilter === "all"} onClick={() => setCategoryFilter("all")} />
            {(Object.keys(UNIT_CATEGORY_LABELS) as UnitCategory[]).map((c) => (
              <CategoryChip
                key={c}
                label={UNIT_CATEGORY_LABELS[c]}
                active={categoryFilter === c}
                onClick={() => setCategoryFilter(c)}
              />
            ))}
            <div className="ml-2 h-4 w-px bg-border/40" />
            <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/60 mr-1">Type</span>
            <CategoryChip label="Any" active={!unitFilter} onClick={() => setUnitFilter(null)} />
            {UNIT_TYPES
              .filter((u) => categoryFilter === "all" || u.category === categoryFilter)
              .map((u) => (
                <CategoryChip
                  key={u.id}
                  label={u.shortLabel}
                  active={unitFilter === u.id}
                  onClick={() => setUnitFilter(unitFilter === u.id ? null : u.id)}
                />
              ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6 sm:px-8">
          {loading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-44 animate-pulse rounded-xl border border-border/40 bg-muted/30" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState search={search} hasFilters={!!unitFilter || categoryFilter !== "all"} />
          ) : (
            <div className="space-y-8">
              {(Object.keys(groupedByCategory) as UnitCategory[]).map((cat) => {
                const list = groupedByCategory[cat];
                if (list.length === 0) return null;
                return (
                  <section key={cat}>
                    <div className="mb-3 flex items-baseline justify-between">
                      <h2 className="font-display text-lg tracking-tight">{UNIT_CATEGORY_LABELS[cat]}</h2>
                      <span className="text-xs text-muted-foreground">{list.length} plan{list.length === 1 ? "" : "s"}</span>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {list.map((plan) => (
                        <PlanCard
                          key={plan.id}
                          plan={plan}
                          metrics={metricsByPlan[plan.id]}
                          onDelete={() => handleDelete(plan.id, plan.name)}
                        />
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function CategoryChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-2.5 py-1 text-[11px] font-medium transition",
        active
          ? "border-primary/50 bg-primary/15 text-primary"
          : "border-border/60 bg-background/40 text-muted-foreground hover:border-primary/30 hover:text-foreground"
      )}
    >
      {label}
    </button>
  );
}

function PlanCard({
  plan,
  metrics,
  onDelete,
}: {
  plan: FloorPlanSummary;
  metrics?: MetricSummary;
  onDelete: () => void;
}) {
  const def = getUnitTypeById(plan.unit_type);
  return (
    <div className="group relative flex flex-col rounded-xl border border-border/50 bg-card/55 transition-colors hover:border-primary/40">
      <Link href={`/floor-plans/${plan.id}`} className="flex flex-1 flex-col p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-foreground group-hover:text-primary">{plan.name}</div>
            <div className="mt-1 text-xs text-muted-foreground">{def?.label ?? plan.unit_type}</div>
          </div>
          <span className="rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {def?.shortLabel ?? "—"}
          </span>
        </div>

        <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Ruler className="h-3 w-3" />
            {plan.square_footage ? `${plan.square_footage.toLocaleString()} SF` : "— SF"}
          </span>
          <span className="inline-flex items-center gap-1">
            <Building className="h-3 w-3" />
            {plan.bedrooms} BR / {plan.bathrooms} BA
          </span>
        </div>

        {metrics && metrics.market_count > 0 ? (
          <div className="mt-3 rounded-md border border-border/40 bg-background/40 px-2.5 py-2">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
              Rent · {metrics.market_count} market{metrics.market_count === 1 ? "" : "s"}
            </div>
            <div className="mt-0.5 text-sm font-semibold tabular-nums">
              {metrics.rent_low && metrics.rent_high
                ? metrics.rent_low === metrics.rent_high
                  ? formatCurrency(metrics.rent_low)
                  : `${formatCurrency(metrics.rent_low)} – ${formatCurrency(metrics.rent_high)}`
                : "—"}
            </div>
          </div>
        ) : (
          <div className="mt-3 rounded-md border border-dashed border-border/40 px-2.5 py-2 text-[11px] text-muted-foreground/70">
            No metrics yet
          </div>
        )}

        {plan.description ? (
          <p className="mt-3 line-clamp-2 text-xs text-muted-foreground">{plan.description}</p>
        ) : null}
      </Link>
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(); }}
        className="absolute right-2 top-2 rounded-md p-1 text-muted-foreground/50 opacity-0 transition-all hover:bg-red-500/10 hover:text-red-500 group-hover:opacity-100"
        aria-label={`Delete ${plan.name}`}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function EmptyState({ search, hasFilters }: { search: string; hasFilters: boolean }) {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-border/60 bg-background/60 text-muted-foreground">
        <LayoutGrid className="h-5 w-5" />
      </div>
      <h2 className="mt-4 text-sm font-semibold">
        {search || hasFilters ? "No matching plans" : "No floor plans yet"}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {search || hasFilters
          ? "Try a different search or clear the filters."
          : "Start a new plan — the wizard will ask which unit type you're designing."}
      </p>
      {!search && !hasFilters && (
        <Button asChild size="sm" className="mt-4">
          <Link href="/floor-plans/new">
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            New Floor Plan
          </Link>
        </Button>
      )}
    </div>
  );
}
