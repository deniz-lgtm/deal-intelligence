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
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { cn } from "@/lib/utils";
import { EXECUTION_PHASE_CONFIG } from "@/lib/types";
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

  const totalBudget = deals.reduce((s, d) => s + Number(d.hardcost_total_budget || 0), 0);
  const totalCommitted = deals.reduce((s, d) => s + Number(d.hardcost_total_committed || 0), 0);
  const totalPaid = deals.reduce((s, d) => s + Number(d.hardcost_total_paid || 0), 0);

  return (
    <AppShell>
      <div className="p-6 max-w-7xl mx-auto w-full">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold font-display">Execution Portfolio</h1>
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

        {/* Summary Stats */}
        {deals.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-8">
            <div className="rounded-lg border border-border/40 bg-card/50 p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                <Building2 className="h-3.5 w-3.5" />
                Active Deals
              </div>
              <p className="text-2xl font-bold">{deals.length}</p>
            </div>
            <div className="rounded-lg border border-border/40 bg-card/50 p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                <DollarSign className="h-3.5 w-3.5" />
                Total Budget
              </div>
              <p className="text-2xl font-bold">{fc(totalBudget)}</p>
            </div>
            <div className="rounded-lg border border-border/40 bg-card/50 p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                <TrendingUp className="h-3.5 w-3.5" />
                Committed
              </div>
              <p className="text-2xl font-bold">{fc(totalCommitted)}</p>
            </div>
            <div className="rounded-lg border border-border/40 bg-card/50 p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                <FileCheck className="h-3.5 w-3.5" />
                Paid
              </div>
              <p className="text-2xl font-bold">{fc(totalPaid)}</p>
            </div>
          </div>
        )}

        {/* Deal Cards */}
        {loading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            Loading execution deals...
          </div>
        ) : deals.length === 0 ? (
          <div className="text-center py-20">
            <HardHat className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-muted-foreground mb-2">
              No deals in execution yet
            </h3>
            <p className="text-sm text-muted-foreground/60 max-w-md mx-auto">
              When a closed deal is handed off from the Project tab, it will appear here
              with construction budget tracking, draw scheduling, and permit management.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {deals.map((deal) => {
              const budget = Number(deal.hardcost_total_budget || 0);
              const committed = Number(deal.hardcost_total_committed || 0);
              const pctSpent = budget > 0 ? Math.round((committed / budget) * 100) : 0;
              const phaseConfig = EXECUTION_PHASE_CONFIG[deal.execution_phase];

              return (
                <Link
                  key={deal.id}
                  href={`/deals/${deal.id}/construction`}
                  className="group rounded-lg border border-border/40 bg-card/50 hover:bg-card/80 hover:border-border/60 transition-all p-4"
                >
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div className="min-w-0">
                      <h3 className="font-medium text-sm text-foreground truncate group-hover:text-primary transition-colors">
                        {deal.name}
                      </h3>
                      <p className="text-2xs text-muted-foreground truncate">
                        {deal.city}, {deal.state}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "text-2xs px-2 py-0.5 rounded-full font-medium flex-shrink-0",
                        phaseConfig?.color ?? "bg-muted text-muted-foreground"
                      )}
                    >
                      {phaseConfig?.label ?? deal.execution_phase}
                    </span>
                  </div>

                  {/* Budget bar */}
                  {budget > 0 && (
                    <div className="mb-3">
                      <div className="flex items-center justify-between text-2xs text-muted-foreground mb-1">
                        <span>Budget</span>
                        <span>{pctSpent}% committed</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted/30 overflow-hidden">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all",
                            pctSpent > 90 ? "bg-red-500" : pctSpent > 70 ? "bg-amber-500" : "bg-primary"
                          )}
                          style={{ width: `${Math.min(pctSpent, 100)}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-2xs text-muted-foreground/60 mt-1">
                        <span>{fc(committed)} committed</span>
                        <span>{fc(budget)} total</span>
                      </div>
                    </div>
                  )}

                  {/* Quick stats */}
                  <div className="flex items-center gap-4 text-2xs text-muted-foreground">
                    <span>{deal.draw_count} draw{Number(deal.draw_count) !== 1 ? "s" : ""}</span>
                    <span>{deal.permits_approved}/{deal.permit_count} permits approved</span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
