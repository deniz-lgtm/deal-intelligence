"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppShell } from "@/components/AppShell";
import { DashboardGrid } from "@/components/dashboard/DashboardGrid";
import { usePermissions } from "@/lib/usePermissions";
import type { PhaseSignals } from "@/lib/phase-classification";
import type { DashboardData, DealWithStats } from "@/components/dashboard/types";

export default function HomePage() {
  const { can } = usePermissions();
  const [deals, setDeals] = useState<DealWithStats[]>([]);
  const [signals, setSignals] = useState<Record<string, PhaseSignals>>({});
  const [decisionsDueCount, setDecisionsDueCount] = useState(0);
  const [followUpsCount, setFollowUpsCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [dealsRes, sigRes, decRes, followRes] = await Promise.all([
          fetch("/api/deals"),
          fetch("/api/deals/phase-signals").catch(() => null),
          fetch("/api/home/decisions-due").catch(() => null),
          fetch("/api/contacts/follow-ups").catch(() => null),
        ]);
        const dealsJson = await dealsRes.json();
        const sigJson = sigRes ? await sigRes.json().catch(() => ({ data: {} })) : { data: {} };
        const decJson = decRes ? await decRes.json().catch(() => ({ data: [] })) : { data: [] };
        const followJson = followRes ? await followRes.json().catch(() => ({ data: [] })) : { data: [] };
        if (cancelled) return;
        if (dealsJson.data) setDeals(dealsJson.data);
        if (sigJson.data) setSignals(sigJson.data);
        setDecisionsDueCount(Array.isArray(decJson.data) ? decJson.data.length : Number(decJson.count ?? 0));
        setFollowUpsCount(Array.isArray(followJson.data) ? followJson.data.length : Number(followJson.count ?? 0));
      } catch (err) {
        console.error("Failed to load dashboard data:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const data: DashboardData = { deals, signals, decisionsDueCount, followUpsCount };

  return (
    <AppShell>
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="relative shrink-0 overflow-hidden border-b border-border/40">
          <div className="absolute inset-0 gradient-mesh" />
          <div className="relative mx-auto max-w-full px-6 sm:px-8">
            <div className="flex h-14 min-w-0 items-center justify-between">
              <div className="flex items-baseline gap-3">
                <span className="font-nameplate text-xl leading-none tracking-tight">Atelier</span>
                <span className="text-2xs uppercase tracking-[0.18em] text-muted-foreground/60">
                  Vol. 1 &middot; {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric" })}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
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

        {loading ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Loading pipeline…
          </div>
        ) : (
          <DashboardGrid data={data} />
        )}
      </div>
    </AppShell>
  );
}
