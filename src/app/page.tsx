"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppShell } from "@/components/AppShell";
import { TodayStrip } from "@/components/today/TodayStrip";
import { AcquisitionPanel } from "@/components/home/AcquisitionPanel";
import { DevelopmentPanel } from "@/components/home/DevelopmentPanel";
import { ConstructionPanel } from "@/components/home/ConstructionPanel";
import { usePermissions } from "@/lib/usePermissions";
import { classifyDealPhase, type PhaseSignals } from "@/lib/phase-classification";
import type { Deal, DealPhase } from "@/lib/types";

// The triptych home. Three side-by-side "departments" — Acquisition,
// Development, Construction — each owned by one role on a team but reading
// the same underlying data. A deal is auto-classified into one or more
// panels by stage + data signals, with an owner override available on each
// deal's detail page (PhasePinControl). Below xl, panels stack vertically
// in the user's primaryPhase-first order from localStorage.

interface DealWithStats extends Deal {
  document_count?: number;
  checklist_complete?: number;
  checklist_total?: number;
  total_project_cost?: number | null;
}

type PrimaryPhase = DealPhase;

const PANEL_COMPONENTS: Record<DealPhase, (typeof AcquisitionPanel) | (typeof DevelopmentPanel) | (typeof ConstructionPanel)> = {
  acquisition: AcquisitionPanel,
  development: DevelopmentPanel,
  construction: ConstructionPanel,
};

export default function HomePage() {
  const { can } = usePermissions();
  const [deals, setDeals] = useState<DealWithStats[]>([]);
  const [signals, setSignals] = useState<Record<string, PhaseSignals>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [primaryPhase, setPrimaryPhase] = useState<PrimaryPhase>("acquisition");

  useEffect(() => {
    const stored = localStorage.getItem("primaryPhase") as PrimaryPhase | null;
    if (stored === "acquisition" || stored === "development" || stored === "construction") {
      setPrimaryPhase(stored);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [dealsRes, sigRes] = await Promise.all([
          fetch("/api/deals"),
          fetch("/api/deals/phase-signals").catch(() => null),
        ]);
        const dealsJson = await dealsRes.json();
        const sigJson = sigRes ? await sigRes.json().catch(() => ({ data: {} })) : { data: {} };
        if (cancelled) return;
        if (dealsJson.data) setDeals(dealsJson.data);
        if (sigJson.data) setSignals(sigJson.data);
      } catch (err) {
        console.error("Failed to load home data:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Apply search filter once, then phase classification fans out from there.
  const filtered = useMemo(() => {
    if (!search) return deals;
    const q = search.toLowerCase();
    return deals.filter(
      (d) =>
        d.name.toLowerCase().includes(q) ||
        d.address?.toLowerCase().includes(q) ||
        d.city?.toLowerCase().includes(q),
    );
  }, [deals, search]);

  // Bucket deals into phases via the classifier (handles overrides + signals).
  const buckets = useMemo(() => {
    const acq: DealWithStats[] = [];
    const dev: DealWithStats[] = [];
    const con: DealWithStats[] = [];
    for (const deal of filtered) {
      const result = classifyDealPhase(deal);
      if (result.phases.includes("acquisition")) acq.push(deal);
      if (result.phases.includes("development")) dev.push(deal);
      if (result.phases.includes("construction")) con.push(deal);
    }
    return { acquisition: acq, development: dev, construction: con };
  }, [filtered, signals]);

  // Stacked-mobile order: primary phase first. On xl+, the grid always flows
  // Acq → Dev → Con in reading order (the triptych's canonical sequence).
  const stackedOrder: DealPhase[] = [
    primaryPhase,
    ...(["acquisition", "development", "construction"] as DealPhase[]).filter(
      (p) => p !== primaryPhase,
    ),
  ];

  return (
    <AppShell>
      <div className="flex flex-col flex-1 min-h-0">
        {/* ── Masthead band ── */}
        <header className="relative overflow-hidden border-b border-border/40 shrink-0">
          <div className="absolute inset-0 gradient-mesh" />
          <div className="relative max-w-full mx-auto px-6 sm:px-8">
            <div className="flex items-center justify-between h-14 min-w-0">
              <div className="flex items-baseline gap-3">
                <span className="font-nameplate text-xl leading-none tracking-tight">
                  Atelier
                </span>
                <span className="text-2xs uppercase tracking-[0.18em] text-muted-foreground/60">
                  Vol. 1 &middot; {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric" })}
                </span>
              </div>
              <div className="flex items-center gap-1 sm:gap-2 shrink-0">
                <div className="relative hidden md:block">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/40" />
                  <input
                    type="text"
                    placeholder="Search deals…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-60 pl-7 pr-3 py-1.5 text-xs border border-border/40 rounded-full bg-background/40 focus:bg-background focus:outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary/40 transition-all placeholder:text-muted-foreground/30"
                  />
                </div>
                <div className="w-px h-5 bg-border/40 mx-1 hidden sm:block" />
                {can("deals.create") && (
                  <Link href="/deals/new">
                    <Button size="sm" className="text-xs">
                      <Plus className="h-3.5 w-3.5 mr-1.5" />
                      New Deal
                    </Button>
                  </Link>
                )}
              </div>
            </div>
          </div>
        </header>

        {/* Today strip — slim AI summary band */}
        <TodayStrip />

        {/* Mobile search (header version is hidden on small viewports) */}
        <div className="md:hidden shrink-0 border-b border-border/30 bg-card/20 px-6 py-2.5">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/40" />
            <input
              type="text"
              placeholder="Search deals…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-xs border border-border/50 rounded-lg bg-background/50 focus:bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all placeholder:text-muted-foreground/30"
            />
          </div>
        </div>

        {/* ── The triptych ── */}
        {loading ? (
          <TriptychSkeleton />
        ) : (
          <div className="flex-1 overflow-y-auto">
            <div
              className="grid grid-cols-1 xl:grid-cols-3 xl:divide-x divide-border/30"
              style={{ gridTemplateAreas: undefined }}
            >
              {/* Order rendering so that on stacked mobile, primary phase comes
                  first. On xl+ the natural DOM order renders left-to-right in
                  the triptych, so we have to keep canonical order there.
                  Solution: render canonical order but apply `order-N` classes
                  below xl based on stacked preference. */}
              {(["acquisition", "development", "construction"] as DealPhase[]).map((phase) => {
                const Panel = PANEL_COMPONENTS[phase];
                const panelDeals = buckets[phase];
                const staggerIdx = ["acquisition", "development", "construction"].indexOf(phase);
                const staggerClass = ["stagger-1", "stagger-3", "stagger-4"][staggerIdx];
                const orderIdx = stackedOrder.indexOf(phase);
                const orderClass = ["order-1", "order-2", "order-3"][orderIdx] ?? "order-3";

                return (
                  <div
                    key={phase}
                    className={`${orderClass} xl:order-none animate-fade-up ${staggerClass}`}
                  >
                    {phase === "acquisition" && (
                      <AcquisitionPanel deals={panelDeals} allDeals={buckets.acquisition} />
                    )}
                    {phase === "development" && (
                      <DevelopmentPanel deals={panelDeals} signals={signals} />
                    )}
                    {phase === "construction" && (
                      <ConstructionPanel deals={panelDeals} signals={signals} />
                    )}
                    {/* Panel component is unused above but keeps type-inference */}
                    <span className="sr-only">{Panel.name}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function TriptychSkeleton() {
  return (
    <div className="flex-1 grid grid-cols-1 xl:grid-cols-3 xl:divide-x divide-border/30">
      {[0, 1, 2].map((i) => (
        <div key={i} className="px-6 py-8 min-h-[70vh] animate-pulse">
          <div className="flex items-baseline justify-between">
            <div className="h-7 w-36 rounded bg-muted/30" />
            <div className="h-3 w-12 rounded bg-muted/20" />
          </div>
          <div className="h-px bg-border/30 mt-3" />
          <div className="grid grid-cols-3 gap-4 mt-7">
            {[0, 1, 2].map((k) => (
              <div key={k}>
                <div className="h-8 w-16 rounded bg-muted/30 mb-2" />
                <div className="h-2.5 w-12 rounded bg-muted/20" />
              </div>
            ))}
          </div>
          <div className="mt-7 space-y-3">
            {[0, 1, 2, 3, 4].map((k) => (
              <div key={k} className="flex items-center justify-between">
                <div className="h-4 w-48 rounded bg-muted/20" />
                <div className="h-3 w-14 rounded bg-muted/15" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
