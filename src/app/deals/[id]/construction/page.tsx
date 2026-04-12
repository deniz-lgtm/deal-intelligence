"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  HardHat,
  DollarSign,
  Wallet,
  FileCheck,
  Users,
  ChevronRight,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  ArrowUpRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  EXECUTION_PHASES,
  EXECUTION_PHASE_CONFIG,
} from "@/lib/types";
import type { ExecutionPhase, HardCostItem, Draw, Permit, Vendor } from "@/lib/types";

interface DealInfo {
  id: string;
  name: string;
  execution_phase: ExecutionPhase | null;
}

const fc = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);

export default function ConstructionDashboard({
  params,
}: {
  params: { id: string };
}) {
  const [deal, setDeal] = useState<DealInfo | null>(null);
  const [costs, setCosts] = useState<HardCostItem[]>([]);
  const [draws, setDraws] = useState<Draw[]>([]);
  const [permits, setPermits] = useState<Permit[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [phaseUpdating, setPhaseUpdating] = useState(false);

  const load = useCallback(async () => {
    try {
      const [dealRes, costsRes, drawsRes, permitsRes, vendorsRes] = await Promise.all([
        fetch(`/api/deals/${params.id}`).then((r) => r.json()),
        fetch(`/api/deals/${params.id}/hardcost-items`).then((r) => r.json()).catch(() => ({ data: [] })),
        fetch(`/api/deals/${params.id}/draws`).then((r) => r.json()).catch(() => ({ data: [] })),
        fetch(`/api/deals/${params.id}/permits`).then((r) => r.json()).catch(() => ({ data: [] })),
        fetch(`/api/deals/${params.id}/vendors`).then((r) => r.json()).catch(() => ({ data: [] })),
      ]);
      setDeal(dealRes.data);
      setCosts(costsRes.data ?? []);
      setDraws(drawsRes.data ?? []);
      setPermits(permitsRes.data ?? []);
      setVendors(vendorsRes.data ?? []);
    } catch (err) {
      console.error("Failed to load construction dashboard:", err);
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => { load(); }, [load]);

  const advancePhase = async (phase: ExecutionPhase) => {
    setPhaseUpdating(true);
    try {
      await fetch(`/api/deals/${params.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ execution_phase: phase }),
      });
      setDeal((prev) => prev ? { ...prev, execution_phase: phase } : prev);
    } catch (err) {
      console.error(err);
    } finally {
      setPhaseUpdating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Loading...
      </div>
    );
  }

  // Budget aggregates
  const totalBudget = costs.reduce((s, c) => s + Number(c.amount || 0), 0);
  const committed = costs.filter((c) => ["committed", "incurred", "paid"].includes(c.status)).reduce((s, c) => s + Number(c.amount || 0), 0);
  const paid = costs.filter((c) => c.status === "paid").reduce((s, c) => s + Number(c.amount || 0), 0);
  const contingencyItems = costs.filter((c) => c.category === "Contingency");
  const contingencyTotal = contingencyItems.reduce((s, c) => s + Number(c.amount || 0), 0);
  const contingencyUsed = contingencyItems.filter((c) => ["incurred", "paid"].includes(c.status)).reduce((s, c) => s + Number(c.amount || 0), 0);

  // Draw aggregates
  const totalDrawn = draws.filter((d) => d.status === "funded").reduce((s, d) => s + Number(d.amount_approved ?? d.amount_requested ?? 0), 0);
  const pendingDraws = draws.filter((d) => ["draft", "submitted"].includes(d.status));

  // Permit aggregates
  const permitsApproved = permits.filter((p) => p.status === "approved").length;
  const permitsPending = permits.filter((p) => ["submitted", "in_review"].includes(p.status)).length;

  const currentPhase = deal?.execution_phase;
  const basePath = `/deals/${params.id}/construction`;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold flex items-center gap-2">
          <HardHat className="h-5 w-5 text-primary" />
          Construction Dashboard
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Post-closing execution overview for this deal.
        </p>
      </div>

      {/* Phase Stepper */}
      <div className="rounded-lg border border-border/40 bg-card/50 p-4">
        <div className="text-xs font-medium text-muted-foreground mb-3">Execution Phase</div>
        <div className="flex items-center gap-1">
          {EXECUTION_PHASES.map((phase, i) => {
            const config = EXECUTION_PHASE_CONFIG[phase];
            const isCurrent = phase === currentPhase;
            const currentIdx = currentPhase ? EXECUTION_PHASES.indexOf(currentPhase) : -1;
            const isPast = currentIdx >= 0 && i < currentIdx;

            return (
              <div key={phase} className="flex items-center flex-1 min-w-0">
                <button
                  onClick={() => advancePhase(phase)}
                  disabled={phaseUpdating}
                  className={cn(
                    "flex-1 py-2 px-2 rounded-md text-2xs font-medium text-center transition-all truncate",
                    isCurrent
                      ? config.color + " ring-1 ring-primary/30"
                      : isPast
                        ? "bg-emerald-500/10 text-emerald-400"
                        : "bg-muted/20 text-muted-foreground hover:bg-muted/40"
                  )}
                >
                  {isPast && <CheckCircle2 className="h-3 w-3 inline mr-1" />}
                  {config.label}
                </button>
                {i < EXECUTION_PHASES.length - 1 && (
                  <ChevronRight className="h-3 w-3 text-muted-foreground/40 flex-shrink-0 mx-0.5" />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Budget Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Link href={`${basePath}/budget`} className="rounded-lg border border-border/40 bg-card/50 p-4 hover:bg-card/80 transition-all group">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 text-muted-foreground text-xs">
              <DollarSign className="h-3.5 w-3.5" />
              Total Budget
            </div>
            <ArrowUpRight className="h-3 w-3 text-muted-foreground/40 group-hover:text-primary transition-colors" />
          </div>
          <p className="text-xl font-bold">{fc(totalBudget)}</p>
          <p className="text-2xs text-muted-foreground mt-1">{costs.length} line items</p>
        </Link>

        <div className="rounded-lg border border-border/40 bg-card/50 p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-2">
            <DollarSign className="h-3.5 w-3.5" />
            Committed
          </div>
          <p className="text-xl font-bold">{fc(committed)}</p>
          {totalBudget > 0 && (
            <div className="mt-2">
              <div className="h-1.5 rounded-full bg-muted/30 overflow-hidden">
                <div
                  className="h-full rounded-full bg-blue-500 transition-all"
                  style={{ width: `${Math.min(Math.round((committed / totalBudget) * 100), 100)}%` }}
                />
              </div>
              <p className="text-2xs text-muted-foreground mt-1">
                {Math.round((committed / totalBudget) * 100)}% of budget
              </p>
            </div>
          )}
        </div>

        <Link href={`${basePath}/draws`} className="rounded-lg border border-border/40 bg-card/50 p-4 hover:bg-card/80 transition-all group">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 text-muted-foreground text-xs">
              <Wallet className="h-3.5 w-3.5" />
              Draws
            </div>
            <ArrowUpRight className="h-3 w-3 text-muted-foreground/40 group-hover:text-primary transition-colors" />
          </div>
          <p className="text-xl font-bold">{fc(totalDrawn)}</p>
          <p className="text-2xs text-muted-foreground mt-1">
            {draws.length} total, {pendingDraws.length} pending
          </p>
        </Link>

        <div className="rounded-lg border border-border/40 bg-card/50 p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-2">
            {contingencyTotal > 0 && contingencyUsed / contingencyTotal > 0.7 ? (
              <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
            ) : (
              <DollarSign className="h-3.5 w-3.5" />
            )}
            Contingency
          </div>
          <p className="text-xl font-bold">{fc(contingencyTotal - contingencyUsed)}</p>
          {contingencyTotal > 0 && (
            <p className="text-2xs text-muted-foreground mt-1">
              {Math.round((contingencyUsed / contingencyTotal) * 100)}% used of {fc(contingencyTotal)}
            </p>
          )}
        </div>
      </div>

      {/* Quick Links */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Link href={`${basePath}/permits`} className="rounded-lg border border-border/40 bg-card/50 p-4 hover:bg-card/80 transition-all group flex items-center gap-4">
          <div className="h-10 w-10 rounded-lg bg-amber-500/20 flex items-center justify-center flex-shrink-0">
            <FileCheck className="h-5 w-5 text-amber-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">Permits & Approvals</h3>
            <p className="text-2xs text-muted-foreground">
              {permitsApproved} approved, {permitsPending} pending of {permits.length} total
            </p>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-primary transition-colors flex-shrink-0" />
        </Link>

        <Link href={`${basePath}/vendors`} className="rounded-lg border border-border/40 bg-card/50 p-4 hover:bg-card/80 transition-all group flex items-center gap-4">
          <div className="h-10 w-10 rounded-lg bg-blue-500/20 flex items-center justify-center flex-shrink-0">
            <Users className="h-5 w-5 text-blue-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">Vendor Directory</h3>
            <p className="text-2xs text-muted-foreground">
              {vendors.filter((v) => v.status === "active").length} active of {vendors.length} vendors
            </p>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-primary transition-colors flex-shrink-0" />
        </Link>
      </div>
    </div>
  );
}
