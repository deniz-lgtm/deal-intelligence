"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Building2,
  CalendarDays,
  ClipboardCheck,
  FileText,
  GanttChartSquare,
  HardHat,
  Search,
  ShieldAlert,
  TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { classifyDealPhase, type PhaseSignals } from "@/lib/phase-classification";
import { cn, formatCurrency, formatNumber, titleCase } from "@/lib/utils";
import {
  DEAL_PHASE_LABELS,
  DEAL_STAGE_LABELS,
  type Deal,
  type DealPhase,
} from "@/lib/types";

export interface CommandCenterDeal extends Deal {
  document_count?: number;
  checklist_complete?: number;
  checklist_total?: number;
  total_project_cost?: number | null;
}

interface DealCommandCenterProps {
  deals: CommandCenterDeal[];
  signals: Record<string, PhaseSignals>;
  loading?: boolean;
  search?: string;
}

type RoleFilter = "all" | DealPhase;
type UrgencyBand = "attention" | "active" | "watching";

const ROLE_FILTERS: Array<{ value: RoleFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "acquisition", label: "Acquisition" },
  { value: "development", label: "Development" },
  { value: "construction", label: "Construction" },
];

const ROLE_STYLES: Record<DealPhase, string> = {
  acquisition: "border-[hsl(var(--phase-acq)/0.35)] bg-[hsl(var(--phase-acq)/0.12)] text-[hsl(var(--phase-acq))]",
  development: "border-[hsl(var(--phase-dev)/0.35)] bg-[hsl(var(--phase-dev)/0.12)] text-[hsl(var(--phase-dev))]",
  construction: "border-[hsl(var(--phase-con)/0.35)] bg-[hsl(var(--phase-con)/0.12)] text-[hsl(var(--phase-con))]",
};

const BAND_COPY: Record<UrgencyBand, { title: string; helper: string }> = {
  attention: {
    title: "Needs attention",
    helper: "Deals with near-term dates, low confidence, pending draws, or active construction signals.",
  },
  active: {
    title: "Active work",
    helper: "Deals with live schedules or open handoffs.",
  },
  watching: {
    title: "Watching",
    helper: "Deals without a clear near-term schedule signal yet.",
  },
};

function quantTone(score: number | null | undefined) {
  if (score === null || score === undefined) return "text-muted-foreground";
  if (score >= 75) return "text-emerald-500";
  if (score >= 55) return "text-amber-500";
  return "text-rose-500";
}

function formatScore(score: number | null | undefined) {
  if (score === null || score === undefined) return "Not scored";
  return `${Math.round(score)}/100`;
}

function formatDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function getUrgency(deal: CommandCenterDeal, signal?: PhaseSignals): UrgencyBand {
  const nextDate = signal?.next_milestone_at ? new Date(signal.next_milestone_at) : null;
  const now = new Date();
  const daysUntilNext = nextDate && !Number.isNaN(nextDate.getTime())
    ? (nextDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    : null;

  const lowQuant = typeof deal.quant_composite === "number" && deal.quant_composite < 55;
  const lowConfidence = typeof deal.quant_confidence === "number" && deal.quant_confidence < 0.55;
  const pendingDraws = (signal?.draws_pending ?? 0) > 0;
  const nearTerm = daysUntilNext !== null && daysUntilNext <= 14;
  const constructionSignal = Boolean(
    signal?.has_draws ||
      signal?.has_hardcost_items ||
      signal?.has_permits ||
      signal?.has_progress_reports ||
      signal?.has_vendors
  );

  if (pendingDraws || nearTerm || lowQuant || lowConfidence) return "attention";
  if (signal?.next_milestone_at || constructionSignal || deal.show_in_development || deal.show_in_construction) return "active";
  return "watching";
}

function getStageLabel(deal: CommandCenterDeal) {
  if (deal.status && DEAL_STAGE_LABELS[deal.status]) {
    return DEAL_STAGE_LABELS[deal.status];
  }
  return "No stage";
}

function getPrimaryMetric(deal: CommandCenterDeal) {
  if (typeof deal.total_project_cost === "number" && deal.total_project_cost > 0) {
    return { label: "TPC", value: formatCurrency(deal.total_project_cost) };
  }
  if (typeof deal.asking_price === "number" && deal.asking_price > 0) {
    return { label: "Ask", value: formatCurrency(deal.asking_price) };
  }
  return { label: "Value", value: "TBD" };
}

function getSizeMetric(deal: CommandCenterDeal) {
  if (typeof deal.units === "number" && deal.units > 0) {
    return `${formatNumber(deal.units)} units`;
  }
  if (typeof deal.square_footage === "number" && deal.square_footage > 0) {
    return `${formatNumber(deal.square_footage)} SF`;
  }
  return deal.property_type ? titleCase(deal.property_type) : "No size";
}

function signalChips(signal?: PhaseSignals) {
  if (!signal) return [];
  const chips: string[] = [];
  if ((signal.draws_pending ?? 0) > 0) chips.push(`${signal.draws_pending} draw${signal.draws_pending === 1 ? "" : "s"} pending`);
  if (signal.has_hardcost_items) chips.push("Hard costs");
  if (signal.has_permits) chips.push("Permits");
  if (signal.has_vendors) chips.push("Vendors");
  if (signal.has_progress_reports) chips.push("Reports");
  return chips.slice(0, 4);
}

function scheduleHref(deal: CommandCenterDeal, phases: DealPhase[]) {
  if (phases.includes("construction")) return `/deals/${deal.id}/construction/schedule`;
  if (phases.includes("development")) return `/deals/${deal.id}/project`;
  return `/deals/${deal.id}/schedule`;
}

export function DealCommandCenter({ deals, signals, loading = false, search = "" }: DealCommandCenterProps) {
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");

  const rows = useMemo(() => {
    return deals
      .map((deal) => {
        const classification = classifyDealPhase(deal);
        const signal = signals[deal.id];
        return {
          deal,
          phases: classification.phases,
          signal,
          band: getUrgency(deal, signal),
          nextDate: formatDate(signal?.next_milestone_at),
        };
      })
      .filter((row) => roleFilter === "all" || row.phases.includes(roleFilter))
      .sort((a, b) => {
        const bandRank: Record<UrgencyBand, number> = { attention: 0, active: 1, watching: 2 };
        if (bandRank[a.band] !== bandRank[b.band]) return bandRank[a.band] - bandRank[b.band];
        const aDate = a.signal?.next_milestone_at ? new Date(a.signal.next_milestone_at).getTime() : Number.MAX_SAFE_INTEGER;
        const bDate = b.signal?.next_milestone_at ? new Date(b.signal.next_milestone_at).getTime() : Number.MAX_SAFE_INTEGER;
        return aDate - bDate;
      });
  }, [deals, roleFilter, signals]);

  const counts = useMemo(() => {
    const base: Record<RoleFilter, number> = {
      all: deals.length,
      acquisition: 0,
      development: 0,
      construction: 0,
    };
    deals.forEach((deal) => {
      classifyDealPhase(deal).phases.forEach((phase) => {
        base[phase] += 1;
      });
    });
    return base;
  }, [deals]);

  const grouped = useMemo(() => {
    return rows.reduce<Record<UrgencyBand, typeof rows>>(
      (acc, row) => {
        acc[row.band].push(row);
        return acc;
      },
      { attention: [], active: [], watching: [] }
    );
  }, [rows]);

  if (loading) {
    return (
      <section className="px-4 py-4 sm:px-6 lg:px-8">
        <div className="rounded-xl border border-border/60 bg-card/45 p-5">
          <div className="h-5 w-48 animate-pulse rounded bg-muted" />
          <div className="mt-5 space-y-3">
            {[0, 1, 2].map((index) => (
              <div key={index} className="h-24 animate-pulse rounded-lg bg-muted/60" />
            ))}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="px-4 py-4 sm:px-6 lg:px-8">
      <div className="rounded-xl border border-border/60 bg-card/55 shadow-sm">
        <div className="border-b border-border/60 p-4 sm:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                <TrendingUp className="h-3.5 w-3.5" />
                Deal command center
              </div>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-foreground">What needs attention</h2>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                One portfolio list sorted by urgency, with roles as filters instead of separate inboxes.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {ROLE_FILTERS.map((filter) => {
                const active = roleFilter === filter.value;
                return (
                  <button
                    key={filter.value}
                    type="button"
                    onClick={() => setRoleFilter(filter.value)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-xs font-medium transition",
                      active
                        ? "border-primary/45 bg-primary/12 text-primary shadow-sm"
                        : "border-border/70 bg-background/60 text-muted-foreground hover:border-primary/30 hover:text-foreground"
                    )}
                  >
                    {filter.label}
                    <span className="ml-2 text-[10px] opacity-70">{counts[filter.value]}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="p-8 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-border/70 bg-background/70 text-muted-foreground">
              <Search className="h-5 w-5" />
            </div>
            <h3 className="mt-4 text-sm font-semibold text-foreground">No matching deals</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {search ? "Try a different search or role filter." : "Add a deal to start building the command center."}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border/60">
            {(["attention", "active", "watching"] as UrgencyBand[]).map((band) => {
              const bandRows = grouped[band];
              if (bandRows.length === 0) return null;
              return (
                <div key={band} className="p-4 sm:p-5">
                  <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">{BAND_COPY[band].title}</h3>
                      <p className="text-xs text-muted-foreground">{BAND_COPY[band].helper}</p>
                    </div>
                    <span className="text-xs text-muted-foreground">{bandRows.length} deal{bandRows.length === 1 ? "" : "s"}</span>
                  </div>

                  <div className="overflow-hidden rounded-lg border border-border/60 bg-background/45">
                    {bandRows.map(({ deal, phases, signal, nextDate }) => {
                      const metric = getPrimaryMetric(deal);
                      const chips = signalChips(signal);
                      const scheduleLink = scheduleHref(deal, phases);
                      return (
                        <div
                          key={deal.id}
                          className="grid gap-4 border-b border-border/50 p-4 last:border-b-0 xl:grid-cols-[minmax(260px,1.25fr)_minmax(420px,1.75fr)_auto] xl:items-center"
                        >
                          <div className="min-w-0">
                            <div className="flex min-w-0 items-start justify-between gap-3">
                              <div className="min-w-0">
                                <Link
                                  href={`/deals/${deal.id}`}
                                  className="block truncate text-sm font-semibold text-foreground hover:text-primary"
                                >
                                  {deal.name}
                                </Link>
                                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                  <span className="inline-flex items-center gap-1">
                                    <Building2 className="h-3.5 w-3.5" />
                                    {[deal.city, deal.state].filter(Boolean).join(", ") || "No market"}
                                  </span>
                                  <span className="rounded-full border border-border/60 bg-muted/40 px-2 py-0.5">
                                    {getStageLabel(deal)}
                                  </span>
                                </div>
                              </div>
                            </div>

                            <div className="mt-3 flex flex-wrap gap-1.5">
                              {phases.map((phase) => (
                                <span
                                  key={phase}
                                  className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium", ROLE_STYLES[phase])}
                                >
                                  {DEAL_PHASE_LABELS[phase]}
                                </span>
                              ))}
                            </div>
                          </div>

                          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                            <div>
                              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{metric.label}</div>
                              <div className="mt-1 text-sm font-semibold text-foreground">{metric.value}</div>
                            </div>
                            <div>
                              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Scale</div>
                              <div className="mt-1 text-sm text-foreground">{getSizeMetric(deal)}</div>
                            </div>
                            <div>
                              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Score</div>
                              <div className={cn("mt-1 text-sm font-semibold", quantTone(deal.quant_composite))}>
                                {formatScore(deal.quant_composite)}
                              </div>
                            </div>
                            <div>
                              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Next schedule</div>
                              <Link href={scheduleLink} className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                                {nextDate ? nextDate : "Open schedule"}
                                <ArrowRight className="h-3.5 w-3.5" />
                              </Link>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-2 xl:justify-end">
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-muted/35 px-2.5 py-1 text-xs text-muted-foreground">
                              <FileText className="h-3.5 w-3.5" />
                              {deal.document_count ?? 0} docs
                            </span>
                            <Link
                              href={`/deals/${deal.id}/decisions`}
                              className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-muted/35 px-2.5 py-1 text-xs text-muted-foreground hover:border-primary/35 hover:text-foreground"
                            >
                              <ClipboardCheck className="h-3.5 w-3.5" />
                              Decisions/RFIs
                            </Link>
                            {chips.length > 0 ? (
                              chips.map((chip) => (
                                <span
                                  key={chip}
                                  className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/25 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-600 dark:text-amber-300"
                                >
                                  <HardHat className="h-3.5 w-3.5" />
                                  {chip}
                                </span>
                              ))
                            ) : (
                              <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-muted/25 px-2.5 py-1 text-xs text-muted-foreground">
                                <ShieldAlert className="h-3.5 w-3.5" />
                                No alerts
                              </span>
                            )}
                            <Button asChild size="sm" variant="outline" className="h-8 rounded-full">
                              <Link href={scheduleLink}>
                                <GanttChartSquare className="mr-1.5 h-3.5 w-3.5" />
                                Schedule
                              </Link>
                            </Button>
                            <Button asChild size="sm" className="h-8 rounded-full">
                              <Link href={`/deals/${deal.id}`}>
                                Open
                                <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                              </Link>
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
