"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { Building, ArrowRight, Compass } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { classifyDealPhase, type PhaseSignals } from "@/lib/phase-classification";
import type { Deal } from "@/lib/types";
import { INVESTMENT_THESIS_LABELS, DEAL_SCOPE_LABELS } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";

// Development workspace — portfolio of deals in the shaping phase. Each
// project is a summary card that links into the existing per-deal pages
// (/deals/[id]/project, /programming, /site-zoning). This is a collection
// view, not a replacement for those screens.

interface DealWithStats extends Deal {
  total_project_cost?: number | null;
}

interface Row {
  deal: DealWithStats;
  signals: PhaseSignals;
}

export default function DevelopmentPage() {
  const [deals, setDeals] = useState<DealWithStats[]>([]);
  const [signals, setSignals] = useState<Record<string, PhaseSignals>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [d, s] = await Promise.all([
          fetch("/api/deals").then((r) => r.json()),
          fetch("/api/deals/phase-signals").then((r) => r.json()).catch(() => ({ data: {} })),
        ]);
        if (cancelled) return;
        setDeals(d.data ?? []);
        setSignals(s.data ?? {});
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const rows: Row[] = useMemo(() => {
    return deals
      .filter((d) => classifyDealPhase(d, signals[d.id] ?? {}).phases.includes("development"))
      .map((deal) => ({ deal, signals: signals[deal.id] ?? {} }))
      .sort((a, b) => {
        const aAct =
          (a.signals.has_ceqa ? 3 : 0) +
          (a.signals.has_programming ? 2 : 0) +
          (a.signals.has_predev_costs ? 1 : 0);
        const bAct =
          (b.signals.has_ceqa ? 3 : 0) +
          (b.signals.has_programming ? 2 : 0) +
          (b.signals.has_predev_costs ? 1 : 0);
        if (aAct !== bAct) return bAct - aAct;
        return new Date(b.deal.updated_at).getTime() - new Date(a.deal.updated_at).getTime();
      });
  }, [deals, signals]);

  return (
    <AppShell>
      <div className="flex flex-col flex-1 min-h-0">
        {/* Masthead */}
        <header className="relative overflow-hidden border-b border-border/40 shrink-0">
          <div className="absolute inset-0 gradient-mesh" />
          <div className="relative max-w-full mx-auto px-6 sm:px-8">
            <div className="flex items-center justify-between h-14 min-w-0">
              <div className="flex items-center gap-2.5">
                <Building className="h-4 w-4" style={{ color: "hsl(var(--phase-dev))" }} />
                <span className="font-nameplate text-xl leading-none tracking-tight">Development</span>
                <span className="text-2xs uppercase tracking-[0.15em] text-muted-foreground/70">Portfolio</span>
              </div>
              <div className="text-2xs tabular-nums text-muted-foreground">
                {rows.length} project{rows.length !== 1 ? "s" : ""}
              </div>
            </div>
          </div>
        </header>

        {/* Body */}
        <main className="flex-1 overflow-y-auto px-6 sm:px-8 py-8">
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-44 rounded-xl border border-border/30 bg-card/30 animate-pulse" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 animate-fade-up">
              {rows.map(({ deal, signals: s }) => (
                <DevDealCard key={deal.id} deal={deal} signals={s} />
              ))}
            </div>
          )}
        </main>
      </div>
    </AppShell>
  );
}

function DevDealCard({ deal, signals: s }: { deal: DealWithStats; signals: PhaseSignals }) {
  const scope = deal.deal_scope ? DEAL_SCOPE_LABELS[deal.deal_scope] : null;
  const thesis = deal.investment_strategy ? INVESTMENT_THESIS_LABELS[deal.investment_strategy] : null;
  const tag = scope ?? thesis ?? "Development";
  const cost =
    (deal.total_project_cost && deal.total_project_cost > 0 ? deal.total_project_cost : deal.asking_price) ?? null;

  return (
    <Link
      href={`/deals/${deal.id}/project`}
      className="group rounded-xl border border-border/40 bg-card/40 hover:bg-card/70 hover:border-[hsl(var(--phase-dev)/0.5)] transition-all p-5 flex flex-col gap-3 min-h-[176px]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-display text-lg leading-tight tracking-tight text-foreground group-hover:text-[hsl(var(--phase-dev))] transition-colors truncate">
            {deal.name}
          </div>
          <div className="text-2xs text-muted-foreground/70 mt-0.5 truncate">
            {[deal.city, deal.state].filter(Boolean).join(", ") || "—"}
          </div>
        </div>
        <ArrowRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-[hsl(var(--phase-dev))] group-hover:translate-x-0.5 transition-all shrink-0" />
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        <span
          className="uppercase tracking-wider text-[10px] px-2 py-0.5 rounded-full"
          style={{ background: "hsl(var(--phase-dev) / 0.12)", color: "hsl(var(--phase-dev))" }}
        >
          {tag}
        </span>
        {s.has_ceqa && <SignalChip label="CEQA" />}
        {s.has_programming && <SignalChip label="Programming" />}
        {s.has_predev_costs && <SignalChip label="Pre-Dev" />}
      </div>

      <div className="mt-auto pt-3 border-t border-border/20 flex items-baseline justify-between">
        <span className="text-2xs uppercase tracking-wider text-muted-foreground/60">Est. Cost</span>
        <span className="font-display text-lg tabular-nums">
          {cost ? formatCurrency(cost) : "—"}
        </span>
      </div>
    </Link>
  );
}

function SignalChip({ label }: { label: string }) {
  return (
    <span className="uppercase tracking-wider text-[10px] px-1.5 py-0.5 rounded border border-border/60 text-muted-foreground/80">
      {label}
    </span>
  );
}

function EmptyState() {
  return (
    <div className="max-w-md mx-auto text-center py-24">
      <div
        className="w-14 h-14 rounded-2xl mx-auto mb-5 flex items-center justify-center"
        style={{ background: "hsl(var(--phase-dev) / 0.1)" }}
      >
        <Building className="h-6 w-6" style={{ color: "hsl(var(--phase-dev))" }} />
      </div>
      <h2 className="font-nameplate text-3xl mb-2">No projects in development</h2>
      <p className="text-sm text-muted-foreground mb-6">
        Close a value-add or ground-up deal, or pin a deal to Development from its detail page.
      </p>
      <Link
        href="/acquisition"
        className="inline-flex items-center gap-1.5 text-xs font-medium hover:gap-2 transition-all"
        style={{ color: "hsl(var(--phase-dev))" }}
      >
        <Compass className="h-3.5 w-3.5" /> Go to Acquisition pipeline
      </Link>
    </div>
  );
}

