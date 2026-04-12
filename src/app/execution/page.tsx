"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  HardHat,
  DollarSign,
  TrendingUp,
  Building2,
  FileCheck,
  Loader2,
  ClipboardList,
  ShieldCheck,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { cn } from "@/lib/utils";
import { EXECUTION_PHASES, EXECUTION_PHASE_CONFIG } from "@/lib/types";
import type { ExecutionPhase } from "@/lib/types";

interface ExecutionDeal {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  property_type: string;
  execution_phase: ExecutionPhase;
  execution_started_at: string | null;
  hardcost_total_budget: number;
  hardcost_total_committed: number;
  hardcost_total_paid: number;
  total_drawn: number;
  draw_count: number;
  permit_count: number;
  permits_approved: number;
}

const fc = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);

const PHASE_COLUMN_COLORS: Record<
  ExecutionPhase,
  { dot: string; count: string; bar: string; barBg: string }
> = {
  preconstruction: {
    dot: "bg-blue-400",
    count: "text-blue-400",
    bar: "bg-blue-500",
    barBg: "bg-blue-400/5 border-blue-400/30",
  },
  construction: {
    dot: "bg-amber-400",
    count: "text-amber-400",
    bar: "bg-amber-500",
    barBg: "bg-amber-400/5 border-amber-400/30",
  },
  punch_list: {
    dot: "bg-orange-400",
    count: "text-orange-400",
    bar: "bg-orange-500",
    barBg: "bg-orange-400/5 border-orange-400/30",
  },
  lease_up: {
    dot: "bg-purple-400",
    count: "text-purple-400",
    bar: "bg-purple-500",
    barBg: "bg-purple-400/5 border-purple-400/30",
  },
  stabilization: {
    dot: "bg-emerald-400",
    count: "text-emerald-400",
    bar: "bg-emerald-500",
    barBg: "bg-emerald-400/5 border-emerald-400/30",
  },
};

export default function ExecutionPage() {
  const [deals, setDeals] = useState<ExecutionDeal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/execution")
      .then((r) => r.json())
      .then((j) => setDeals(j.data ?? []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const totalBudget = deals.reduce(
    (s, d) => s + Number(d.hardcost_total_budget || 0),
    0,
  );
  const totalCommitted = deals.reduce(
    (s, d) => s + Number(d.hardcost_total_committed || 0),
    0,
  );
  const totalPaid = deals.reduce(
    (s, d) => s + Number(d.hardcost_total_paid || 0),
    0,
  );

  const committedPct =
    totalBudget > 0 ? Math.round((totalCommitted / totalBudget) * 100) : 0;
  const paidPct =
    totalBudget > 0 ? Math.round((totalPaid / totalBudget) * 100) : 0;

  const dealsByPhase: Record<ExecutionPhase, ExecutionDeal[]> =
    EXECUTION_PHASES.reduce(
      (acc, phase) => {
        acc[phase] = deals.filter((d) => d.execution_phase === phase);
        return acc;
      },
      {} as Record<ExecutionPhase, ExecutionDeal[]>,
    );

  return (
    <AppShell>
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="px-6 sm:px-8 pt-6 pb-0">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold font-display">
                Execution Portfolio
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                Construction management for deals in post-closing execution.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-10 w-10 rounded-lg gradient-gold flex items-center justify-center">
                <HardHat className="h-5 w-5 text-primary-foreground" />
              </div>
            </div>
          </div>

          {/* Summary Stats Bar */}
          {deals.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
              <div className="rounded-lg border border-border/40 bg-card/50 p-4">
                <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                  <Building2 className="h-3.5 w-3.5" />
                  Active Deals
                </div>
                <div className="flex items-baseline gap-2">
                  <p className="text-2xl font-bold">{deals.length}</p>
                  <span className="text-2xs text-muted-foreground/60">
                    across {Object.values(dealsByPhase).filter((d) => d.length > 0).length} phases
                  </span>
                </div>
              </div>

              <div className="rounded-lg border border-border/40 bg-card/50 p-4">
                <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                  <DollarSign className="h-3.5 w-3.5" />
                  Total Budget
                </div>
                <div className="flex items-baseline gap-2">
                  <p className="text-2xl font-bold">{fc(totalBudget)}</p>
                </div>
              </div>

              <div className="rounded-lg border border-border/40 bg-card/50 p-4">
                <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                  <TrendingUp className="h-3.5 w-3.5" />
                  Committed
                </div>
                <div className="flex items-baseline gap-2">
                  <p className="text-2xl font-bold">{fc(totalCommitted)}</p>
                  <span
                    className={cn(
                      "text-2xs font-medium tabular-nums",
                      committedPct > 90
                        ? "text-red-400"
                        : committedPct > 70
                          ? "text-amber-400"
                          : "text-emerald-400",
                    )}
                  >
                    {committedPct}%
                  </span>
                </div>
              </div>

              <div className="rounded-lg border border-border/40 bg-card/50 p-4">
                <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                  <FileCheck className="h-3.5 w-3.5" />
                  Paid
                </div>
                <div className="flex items-baseline gap-2">
                  <p className="text-2xl font-bold">{fc(totalPaid)}</p>
                  <span className="text-2xs font-medium tabular-nums text-blue-400">
                    {paidPct}%
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Phase Columns — Kanban Layout */}
        <div className="flex-1 overflow-hidden px-6 sm:px-8 pb-6">
          {loading ? (
            <div className="flex gap-4 overflow-x-auto min-w-max">
              {EXECUTION_PHASES.map((phase) => (
                <div key={phase} className="w-72 shrink-0">
                  <div className="h-8 w-32 rounded bg-muted/30 animate-pulse mb-3" />
                  <div className="space-y-3">
                    {[1, 2].map((i) => (
                      <div
                        key={i}
                        className="h-32 rounded-lg border border-border/30 bg-card/30 animate-pulse"
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : deals.length === 0 ? (
            <div className="text-center py-20 animate-fade-up">
              <HardHat className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-muted-foreground mb-2">
                No deals in execution yet
              </h3>
              <p className="text-sm text-muted-foreground/60 max-w-md mx-auto">
                When a closed deal is handed off from the Project tab, it will
                appear here with construction budget tracking, draw scheduling,
                and permit management.
              </p>
            </div>
          ) : (
            <div className="flex gap-4 overflow-x-auto min-w-max h-full animate-fade-up">
              {EXECUTION_PHASES.map((phase) => {
                const colDeals = dealsByPhase[phase];
                const phaseConfig = EXECUTION_PHASE_CONFIG[phase];
                const colors = PHASE_COLUMN_COLORS[phase];
                const isEmpty = colDeals.length === 0;

                return (
                  <div
                    key={phase}
                    className="w-72 shrink-0 flex flex-col"
                  >
                    {/* Column header */}
                    <div className="flex items-center justify-between mb-3 px-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn("w-2 h-2 rounded-full", colors.dot)}
                        />
                        <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider">
                          {phaseConfig.label}
                        </h3>
                      </div>
                      <span
                        className={cn(
                          "text-xs font-bold tabular-nums",
                          colors.count,
                        )}
                      >
                        {colDeals.length}
                      </span>
                    </div>

                    {/* Column body */}
                    <div
                      className={cn(
                        "flex-1 rounded-xl border p-2 space-y-2 min-h-[120px]",
                        isEmpty
                          ? "bg-muted/5 border-border/30 border-dashed"
                          : "bg-muted/10 border-border/30",
                      )}
                    >
                      {isEmpty ? (
                        <div className="flex items-center justify-center h-full min-h-[100px]">
                          <p className="text-2xs text-muted-foreground/30">
                            No deals
                          </p>
                        </div>
                      ) : (
                        colDeals.map((deal) => {
                          const budget = Number(
                            deal.hardcost_total_budget || 0,
                          );
                          const committed = Number(
                            deal.hardcost_total_committed || 0,
                          );
                          const pctCommitted =
                            budget > 0
                              ? Math.round((committed / budget) * 100)
                              : 0;

                          return (
                            <Link
                              key={deal.id}
                              href={`/deals/${deal.id}/construction`}
                              className="group block rounded-lg border border-border/40 bg-card/80 hover:bg-card hover:border-border p-3 transition-all"
                            >
                              {/* Deal name + location */}
                              <div className="mb-2">
                                <h4 className="text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors">
                                  {deal.name}
                                </h4>
                                <p className="text-2xs text-muted-foreground truncate">
                                  {deal.city}, {deal.state}
                                  {deal.property_type && (
                                    <span className="text-muted-foreground/40">
                                      {" "}
                                      &middot; {deal.property_type}
                                    </span>
                                  )}
                                </p>
                              </div>

                              {/* Budget progress */}
                              {budget > 0 && (
                                <div className="mb-2.5">
                                  <div className="flex items-center justify-between text-2xs text-muted-foreground mb-1">
                                    <span>Budget</span>
                                    <span
                                      className={cn(
                                        "font-medium tabular-nums",
                                        pctCommitted > 90
                                          ? "text-red-400"
                                          : pctCommitted > 70
                                            ? "text-amber-400"
                                            : "text-muted-foreground",
                                      )}
                                    >
                                      {pctCommitted}% committed
                                    </span>
                                  </div>
                                  <div className="h-1.5 rounded-full bg-muted/30 overflow-hidden">
                                    <div
                                      className={cn(
                                        "h-full rounded-full transition-all",
                                        pctCommitted > 90
                                          ? "bg-red-500"
                                          : pctCommitted > 70
                                            ? "bg-amber-500"
                                            : colors.bar,
                                      )}
                                      style={{
                                        width: `${Math.min(pctCommitted, 100)}%`,
                                      }}
                                    />
                                  </div>
                                  <div className="flex items-center justify-between text-2xs text-muted-foreground/50 mt-1">
                                    <span>{fc(committed)}</span>
                                    <span>{fc(budget)}</span>
                                  </div>
                                </div>
                              )}

                              {/* Quick stats row */}
                              <div className="flex items-center gap-3 text-2xs text-muted-foreground">
                                <span className="flex items-center gap-1">
                                  <ClipboardList className="h-3 w-3 text-muted-foreground/50" />
                                  {deal.draw_count} draw
                                  {Number(deal.draw_count) !== 1 ? "s" : ""}
                                </span>
                                <span className="flex items-center gap-1">
                                  <ShieldCheck className="h-3 w-3 text-muted-foreground/50" />
                                  {deal.permit_count} permit
                                  {Number(deal.permit_count) !== 1 ? "s" : ""}
                                </span>
                              </div>
                            </Link>
                          );
                        })
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
