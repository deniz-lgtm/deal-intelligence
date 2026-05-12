"use client";

import { useMemo } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Building2,
  ClipboardCheck,
  FileText,
  GanttChartSquare,
  HardHat,
  Search,
  ShieldAlert,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { classifyDealPhase, type PhaseSignals } from "@/lib/phase-classification";
import { cn, formatCurrency, formatNumber, titleCase } from "@/lib/utils";
import {
  DEAL_STAGE_LABELS,
  type Deal,
  type DealPhase,
  type DealStatus,
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

// Status → band. Drives the three rails of the Command Center. We sort by
// what the user does at that stage, not by "phase".
type StageBand = "screen" | "underwrite" | "execute";

const STATUS_TO_BAND: Record<DealStatus, StageBand | null> = {
  sourcing: "screen",
  screening: "screen",
  loi: "underwrite",
  under_contract: "underwrite",
  diligence: "underwrite",
  closing: "execute",
  closed: "execute",
  dead: null,
  archived: null,
};

const BAND_COPY: Record<StageBand, { title: string; helper: string }> = {
  screen: {
    title: "Screen",
    helper: "New inbound. Sorted by deal score so the best reads bubble up first.",
  },
  underwrite: {
    title: "Underwrite",
    helper: "LOI through DD. Sorted by days-to-decision.",
  },
  execute: {
    title: "Execute",
    helper: "Closing and post-close work. Urgency follows live signals.",
  },
};

const ROLE_STYLES: Record<DealPhase, string> = {
  acquisition: "border-[hsl(var(--phase-acq)/0.35)] bg-[hsl(var(--phase-acq)/0.12)] text-[hsl(var(--phase-acq))]",
  development: "border-[hsl(var(--phase-dev)/0.35)] bg-[hsl(var(--phase-dev)/0.12)] text-[hsl(var(--phase-dev))]",
  construction: "border-[hsl(var(--phase-con)/0.35)] bg-[hsl(var(--phase-con)/0.12)] text-[hsl(var(--phase-con))]",
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

function getStageLabel(deal: CommandCenterDeal) {
  return deal.status ? DEAL_STAGE_LABELS[deal.status] : "No stage";
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
  return `/deals/${deal.id}/schedule/acquisition`;
}

function compareScreen(a: CommandCenterDeal, b: CommandCenterDeal) {
  // Best score first; unscored go last; tiebreak by most recent.
  const sa = typeof a.quant_composite === "number" ? a.quant_composite : -1;
  const sb = typeof b.quant_composite === "number" ? b.quant_composite : -1;
  if (sa !== sb) return sb - sa;
  return new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime();
}

function compareUnderwrite(a: CommandCenterDeal, b: CommandCenterDeal, signals: Record<string, PhaseSignals>) {
  // Soonest next-milestone first; if neither has one, fall back to score.
  const aMs = signals[a.id]?.next_milestone_at ? new Date(signals[a.id]!.next_milestone_at!).getTime() : Number.MAX_SAFE_INTEGER;
  const bMs = signals[b.id]?.next_milestone_at ? new Date(signals[b.id]!.next_milestone_at!).getTime() : Number.MAX_SAFE_INTEGER;
  if (aMs !== bMs) return aMs - bMs;
  return compareScreen(a, b);
}

function compareExecute(a: CommandCenterDeal, b: CommandCenterDeal, signals: Record<string, PhaseSignals>) {
  // Attention-y first: overdue draws, then soonest milestone.
  const aDraw = signals[a.id]?.draws_pending ?? 0;
  const bDraw = signals[b.id]?.draws_pending ?? 0;
  if ((aDraw > 0) !== (bDraw > 0)) return aDraw > 0 ? -1 : 1;
  return compareUnderwrite(a, b, signals);
}

export function DealCommandCenter({ deals, signals, loading = false, search = "" }: DealCommandCenterProps) {
  const grouped = useMemo(() => {
    const buckets: Record<StageBand, CommandCenterDeal[]> = {
      screen: [],
      underwrite: [],
      execute: [],
    };
    deals.forEach((deal) => {
      const band = deal.status ? STATUS_TO_BAND[deal.status] : null;
      if (!band) return;
      buckets[band].push(deal);
    });
    buckets.screen.sort(compareScreen);
    buckets.underwrite.sort((a, b) => compareUnderwrite(a, b, signals));
    buckets.execute.sort((a, b) => compareExecute(a, b, signals));
    return buckets;
  }, [deals, signals]);

  const totalShown = grouped.screen.length + grouped.underwrite.length + grouped.execute.length;

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
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            <TrendingUp className="h-3.5 w-3.5" />
            Deal command center
          </div>
          <h2 className="mt-2 text-xl font-semibold tracking-tight text-foreground">What's moving the deal</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            One portfolio list grouped by where each deal is in the pipeline. Screen the best reads, underwrite by deadline, execute the live work.
          </p>
        </div>

        {totalShown === 0 ? (
          <div className="p-8 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-border/70 bg-background/70 text-muted-foreground">
              <Search className="h-5 w-5" />
            </div>
            <h3 className="mt-4 text-sm font-semibold text-foreground">No matching deals</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {search ? "Try a different search." : "Add a deal to start building the command center."}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border/60">
            {(["screen", "underwrite", "execute"] as StageBand[]).map((band) => {
              const rows = grouped[band];
              if (rows.length === 0) return null;
              return (
                <div key={band} className="p-4 sm:p-5">
                  <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">{BAND_COPY[band].title}</h3>
                      <p className="text-xs text-muted-foreground">{BAND_COPY[band].helper}</p>
                    </div>
                    <span className="text-xs text-muted-foreground">{rows.length} deal{rows.length === 1 ? "" : "s"}</span>
                  </div>

                  <div className="overflow-hidden rounded-lg border border-border/60 bg-background/45">
                    {rows.map((deal) => {
                      const classification = classifyDealPhase(deal);
                      const signal = signals[deal.id];
                      const nextDate = formatDate(signal?.next_milestone_at);
                      const metric = getPrimaryMetric(deal);
                      const chips = signalChips(signal);
                      const scheduleLink = scheduleHref(deal, classification.phases);
                      return (
                        <div
                          key={deal.id}
                          className="grid gap-4 border-b border-border/50 p-4 last:border-b-0 xl:grid-cols-[minmax(260px,1.25fr)_minmax(420px,1.75fr)_auto] xl:items-center"
                        >
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
                            <div className="mt-3 flex flex-wrap gap-1.5">
                              {classification.phases.map((phase) => (
                                <span
                                  key={phase}
                                  className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium", ROLE_STYLES[phase])}
                                >
                                  {titleCase(phase)}
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
                              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                                {band === "screen" ? "Sourced" : "Next schedule"}
                              </div>
                              {band === "screen" ? (
                                <div className="mt-1 text-sm text-foreground">
                                  {deal.created_at ? formatDate(deal.created_at) : "—"}
                                </div>
                              ) : (
                                <Link href={scheduleLink} className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                                  {nextDate ? nextDate : "Open schedule"}
                                  <ArrowRight className="h-3.5 w-3.5" />
                                </Link>
                              )}
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-2 xl:justify-end">
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-muted/35 px-2.5 py-1 text-xs text-muted-foreground">
                              <FileText className="h-3.5 w-3.5" />
                              {deal.document_count ?? 0} docs
                            </span>
                            {band === "screen" ? (
                              <Link
                                href={`/deals/${deal.id}/om-analysis`}
                                className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-muted/35 px-2.5 py-1 text-xs text-muted-foreground hover:border-primary/35 hover:text-foreground"
                              >
                                <Sparkles className="h-3.5 w-3.5" />
                                OM
                              </Link>
                            ) : (
                              <Link
                                href={`/deals/${deal.id}/decisions`}
                                className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-muted/35 px-2.5 py-1 text-xs text-muted-foreground hover:border-primary/35 hover:text-foreground"
                              >
                                <ClipboardCheck className="h-3.5 w-3.5" />
                                Decisions
                              </Link>
                            )}
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
                            ) : band !== "screen" ? (
                              <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-muted/25 px-2.5 py-1 text-xs text-muted-foreground">
                                <ShieldAlert className="h-3.5 w-3.5" />
                                No alerts
                              </span>
                            ) : null}
                            {band !== "screen" && (
                              <Button asChild size="sm" variant="outline" className="h-8 rounded-full">
                                <Link href={scheduleLink}>
                                  <GanttChartSquare className="mr-1.5 h-3.5 w-3.5" />
                                  Schedule
                                </Link>
                              </Button>
                            )}
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
