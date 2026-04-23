"use client";

import { HardHat } from "lucide-react";
import { PhasePanel } from "./PhasePanel";
import { PhaseKPI } from "./PhaseKPI";
import { PhaseDealRow } from "./PhaseDealRow";
import type { Deal } from "@/lib/types";
import type { PhaseSignals } from "@/lib/phase-classification";

// Construction panel — making the project real. KPIs focus on active
// construction deals, how many have draws in flight, and how many have live
// permits. Rows emphasize flow-of-work signals (draws, permits) because
// that's what a construction operator scans for at a glance.

interface DealWithStats extends Deal {
  total_project_cost?: number | null;
}

interface Props {
  deals: DealWithStats[];
  signals: Record<string, PhaseSignals>;
}

export function ConstructionPanel({ deals, signals }: Props) {
  const withDraws = deals.filter((d) => signals[d.id]?.has_draws).length;
  const withPermits = deals.filter((d) => signals[d.id]?.has_permits).length;

  // Prioritize deals with the most active flow (draws + permits + reports)
  const rows = [...deals]
    .sort((a, b) => {
      const aSig = signals[a.id];
      const bSig = signals[b.id];
      const aActivity =
        (aSig?.has_draws ? 3 : 0) +
        (aSig?.has_permits ? 2 : 0) +
        (aSig?.has_progress_reports ? 2 : 0) +
        (aSig?.has_hardcost_items ? 1 : 0);
      const bActivity =
        (bSig?.has_draws ? 3 : 0) +
        (bSig?.has_permits ? 2 : 0) +
        (bSig?.has_progress_reports ? 2 : 0) +
        (bSig?.has_hardcost_items ? 1 : 0);
      if (aActivity !== bActivity) return bActivity - aActivity;
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    })
    .slice(0, 6);

  return (
    <PhasePanel
      phase="construction"
      label="Construction"
      href="/construction"
      accentVar="--phase-con"
      motif={HardHat}
      count={deals.length}
      isEmpty={deals.length === 0}
      emptyState={
        <p className="text-xs text-muted-foreground/50 text-center max-w-[24ch] font-nameplate italic">
          No projects are under construction yet.
        </p>
      }
      kpis={
        <>
          <PhaseKPI value={deals.length} label="Active" accentVar="--phase-con" />
          <PhaseKPI
            value={withDraws}
            label="With Draws"
            accentVar="--phase-con"
            muted={withDraws === 0}
          />
          <PhaseKPI
            value={withPermits}
            label="Permits"
            accentVar="--phase-con"
            muted={withPermits === 0}
          />
        </>
      }
    >
      {rows.map((d) => {
        const sig = signals[d.id];
        const flags: string[] = [];
        if (sig?.has_draws) flags.push("Draws");
        if (sig?.has_permits) flags.push("Permits");
        if (sig?.has_progress_reports) flags.push("Reports");
        return (
          <PhaseDealRow
            key={d.id}
            dealId={d.id}
            name={d.name}
            meta={[d.city, d.state].filter(Boolean).join(", ")}
            accentVar="--phase-con"
            signal={
              flags.length > 0 ? (
                <span
                  className="uppercase tracking-wider text-[10px] px-1.5 py-0.5 rounded"
                  style={{
                    background: `hsl(var(--phase-con) / 0.12)`,
                    color: `hsl(var(--phase-con))`,
                  }}
                >
                  {flags.join(" · ")}
                </span>
              ) : (
                <span className="text-[10px] text-muted-foreground/50 uppercase tracking-wider">
                  Preparing
                </span>
              )
            }
          />
        );
      })}
    </PhasePanel>
  );
}
