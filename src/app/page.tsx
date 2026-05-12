"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { LayoutDashboard, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppShell } from "@/components/AppShell";
import { ScheduleHero } from "@/components/home/ScheduleHero";
import { DealCommandCenter } from "@/components/home/DealCommandCenter";
import { DecisionsDueStrip } from "@/components/home/DecisionsDueStrip";
import { FollowUpsStrip } from "@/components/home/FollowUpsStrip";
import { TodayStrip } from "@/components/today/TodayStrip";
import { usePermissions } from "@/lib/usePermissions";
import type { PhaseSignals } from "@/lib/phase-classification";
import type { Deal } from "@/lib/types";

interface DealWithStats extends Deal {
  document_count?: number;
  checklist_complete?: number;
  checklist_total?: number;
  total_project_cost?: number | null;
}

export default function HomePage() {
  const { can } = usePermissions();
  const [deals, setDeals] = useState<DealWithStats[]>([]);
  const [signals, setSignals] = useState<Record<string, PhaseSignals>>({});
  const [thesis, setThesis] = useState<Record<string, { thesis: string | null; next_decision: { title: string; due_date: string | null } | null }>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [dealsRes, sigRes, thesisRes] = await Promise.all([
          fetch("/api/deals"),
          fetch("/api/deals/phase-signals").catch(() => null),
          fetch("/api/deals/thesis-lines").catch(() => null),
        ]);
        const dealsJson = await dealsRes.json();
        const sigJson = sigRes ? await sigRes.json().catch(() => ({ data: {} })) : { data: {} };
        const thesisJson = thesisRes ? await thesisRes.json().catch(() => ({ data: {} })) : { data: {} };
        if (cancelled) return;
        if (dealsJson.data) setDeals(dealsJson.data);
        if (sigJson.data) setSignals(sigJson.data);
        if (thesisJson.data) setThesis(thesisJson.data);
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

  const filtered = useMemo(() => {
    if (!search) return deals;
    const q = search.toLowerCase();
    return deals.filter(
      (deal) =>
        deal.name.toLowerCase().includes(q) ||
        deal.address?.toLowerCase().includes(q) ||
        deal.city?.toLowerCase().includes(q)
    );
  }, [deals, search]);

  return (
    <AppShell>
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="relative shrink-0 overflow-hidden border-b border-border/40">
          <div className="absolute inset-0 gradient-mesh" />
          <div className="relative mx-auto max-w-full px-6 sm:px-8">
            <div className="flex h-14 min-w-0 items-center justify-between">
              <div className="flex items-baseline gap-3">
                <span className="font-nameplate text-xl leading-none tracking-tight">
                  Atelier
                </span>
                <span className="text-2xs uppercase tracking-[0.18em] text-muted-foreground/60">
                  Vol. 1 &middot; {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric" })}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-1 sm:gap-2">
                <div className="relative hidden md:block">
                  <Search className="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground/40" />
                  <input
                    type="text"
                    placeholder="Search deals..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-60 rounded-full border border-border/40 bg-background/40 py-1.5 pl-7 pr-3 text-xs transition-all placeholder:text-muted-foreground/30 focus:border-primary/40 focus:bg-background focus:outline-none focus:ring-2 focus:ring-primary/15"
                  />
                </div>
                <Link
                  href="/floor-plans"
                  className="hidden items-center gap-1.5 rounded-full border border-border/40 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground sm:inline-flex"
                  title="Floor plan sketchpad"
                >
                  <LayoutDashboard className="h-3.5 w-3.5" />
                  <span>Floor Plans</span>
                </Link>
                <div className="mx-1 hidden h-5 w-px bg-border/40 sm:block" />
                {can("deals.create") && (
                  <Button asChild size="sm" className="text-xs">
                    <Link href="/deals/new">
                      <Plus className="mr-1.5 h-3.5 w-3.5" />
                      New Deal
                    </Link>
                  </Button>
                )}
              </div>
            </div>
          </div>
        </header>

        <DecisionsDueStrip />
        <FollowUpsStrip />
        <ScheduleHero />

        <div className="shrink-0 border-b border-border/30 bg-card/20 px-6 py-2.5 md:hidden">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/40" />
            <input
              type="text"
              placeholder="Search deals..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-border/50 bg-background/50 py-2 pl-9 pr-4 text-xs transition-all placeholder:text-muted-foreground/30 focus:border-primary/40 focus:bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <DealCommandCenter deals={filtered} signals={signals} thesis={thesis} loading={loading} search={search} />
          <TodayStrip />
        </div>
      </div>
    </AppShell>
  );
}
