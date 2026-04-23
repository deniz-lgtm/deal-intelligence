"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { HardHat, ArrowRight, Compass } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { classifyDealPhase, type PhaseSignals } from "@/lib/phase-classification";
import type { Deal } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";

// Construction workspace — portfolio of deals under construction. Each card
// links into the existing per-deal construction sub-pages
// (/deals/[id]/construction). This is an aggregate view — the rich per-deal
// budget / draws / permits UI already lives under each deal's detail route.

interface DealWithStats extends Deal {
  total_project_cost?: number | null;
}

interface Row {
  deal: DealWithStats;
  signals: PhaseSignals;
}

export default function ConstructionPage() {
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
      .filter((d) => classifyDealPhase(d, signals[d.id] ?? {}).phases.includes("construction"))
      .map((deal) => ({ deal, signals: signals[deal.id] ?? {} }))
      .sort((a, b) => {
        const aAct =
          (a.signals.has_draws ? 3 : 0) +
          (a.signals.has_permits ? 2 : 0) +
          (a.signals.has_progress_reports ? 2 : 0) +
          (a.signals.has_hardcost_items ? 1 : 0);
        const bAct =
          (b.signals.has_draws ? 3 : 0) +
          (b.signals.has_permits ? 2 : 0) +
          (b.signals.has_progress_reports ? 2 : 0) +
          (b.signals.has_hardcost_items ? 1 : 0);
        if (aAct !== bAct) return bAct - aAct;
        return new Date(b.deal.updated_at).getTime() - new Date(a.deal.updated_at).getTime();
      });
  }, [deals, signals]);

  return (
    <AppShell>
      <div className="flex flex-col flex-1 min-h-0">
        <header className="relative overflow-hidden border-b border-border/40 shrink-0">
          <div className="absolute inset-0 gradient-mesh" />
          <div className="relative max-w-full mx-auto px-6 sm:px-8">
            <div className="flex items-center justify-between h-14 min-w-0">
              <div className="flex items-center gap-2.5">
                <HardHat className="h-4 w-4" style={{ color: "hsl(var(--phase-con))" }} />
                <span className="font-nameplate text-xl leading-none tracking-tight">Construction</span>
                <span className="text-2xs uppercase tracking-[0.15em] text-muted-foreground/70">Portfolio</span>
              </div>
              <div className="text-2xs tabular-nums text-muted-foreground">
                {rows.length} project{rows.length !== 1 ? "s" : ""}
              </div>
            </div>
          </div>
        </header>

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
                <ConDealCard key={deal.id} deal={deal} signals={s} />
              ))}
            </div>
          )}
        </main>
      </div>
    </AppShell>
  );
}

function ConDealCard({ deal, signals: s }: { deal: DealWithStats; signals: PhaseSignals }) {
  const cost =
    (deal.total_project_cost && deal.total_project_cost > 0 ? deal.total_project_cost : deal.asking_price) ?? null;
  const flags: string[] = [];
  if (s.has_draws) flags.push("Draws");
  if (s.has_permits) flags.push("Permits");
  if (s.has_progress_reports) flags.push("Reports");
  if (s.has_vendors) flags.push("Vendors");

  return (
    <Link
      href={`/deals/${deal.id}/construction`}
      className="group rounded-xl border border-border/40 bg-card/40 hover:bg-card/70 hover:border-[hsl(var(--phase-con)/0.5)] transition-all p-5 flex flex-col gap-3 min-h-[176px]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-display text-lg leading-tight tracking-tight text-foreground group-hover:text-[hsl(var(--phase-con))] transition-colors truncate">
            {deal.name}
          </div>
          <div className="text-2xs text-muted-foreground/70 mt-0.5 truncate">
            {[deal.city, deal.state].filter(Boolean).join(", ") || "—"}
          </div>
        </div>
        <ArrowRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-[hsl(var(--phase-con))] group-hover:translate-x-0.5 transition-all shrink-0" />
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        {flags.length > 0 ? (
          flags.map((f) => (
            <span
              key={f}
              className="uppercase tracking-wider text-[10px] px-2 py-0.5 rounded-full"
              style={{ background: "hsl(var(--phase-con) / 0.12)", color: "hsl(var(--phase-con))" }}
            >
              {f}
            </span>
          ))
        ) : (
          <span className="uppercase tracking-wider text-[10px] text-muted-foreground/50">Preparing</span>
        )}
      </div>

      <div className="mt-auto pt-3 border-t border-border/20 flex items-baseline justify-between">
        <span className="text-2xs uppercase tracking-wider text-muted-foreground/60">Project Cost</span>
        <span className="font-display text-lg tabular-nums">{cost ? formatCurrency(cost) : "—"}</span>
      </div>
    </Link>
  );
}

function EmptyState() {
  return (
    <div className="max-w-md mx-auto text-center py-24">
      <div
        className="w-14 h-14 rounded-2xl mx-auto mb-5 flex items-center justify-center"
        style={{ background: "hsl(var(--phase-con) / 0.1)" }}
      >
        <HardHat className="h-6 w-6" style={{ color: "hsl(var(--phase-con))" }} />
      </div>
      <h2 className="font-nameplate text-3xl mb-2">No projects under construction</h2>
      <p className="text-sm text-muted-foreground mb-6">
        Deals move here once hard-cost budgets, draws, or permits are recorded — or pin a deal to Construction from its detail page.
      </p>
      <Link
        href="/acquisition"
        className="inline-flex items-center gap-1.5 text-xs font-medium hover:gap-2 transition-all"
        style={{ color: "hsl(var(--phase-con))" }}
      >
        <Compass className="h-3.5 w-3.5" /> Go to Acquisition pipeline
      </Link>
    </div>
  );
}
