"use client";

import { Building } from "lucide-react";
import { PhasePanel } from "./PhasePanel";
import { PhaseKPI } from "./PhaseKPI";
import { PhaseDealRow } from "./PhaseDealRow";
import type { Deal } from "@/lib/types";
import { INVESTMENT_THESIS_LABELS, DEAL_SCOPE_LABELS } from "@/lib/types";
import type { PhaseSignals } from "@/lib/phase-classification";

// Development panel — shaping the project. KPIs focus on the portfolio of
// deals in development, and within that, how many have programming or
// entitlement (CEQA) activity under way. Rows lean on each deal's scope /
// thesis as the primary signal since a development-phase deal's identity is
// defined by its strategy.

interface DealWithStats extends Deal {
  total_project_cost?: number | null;
}

interface Props {
  deals: DealWithStats[];
  signals: Record<string, PhaseSignals>;
}

export function DevelopmentPanel({ deals, signals }: Props) {
  const withProgramming = deals.filter((d) => signals[d.id]?.has_programming).length;
  const withCeqa = deals.filter((d) => signals[d.id]?.has_ceqa).length;

  // Find the nearest upcoming milestone across dev deals. Only surface
  // on the nameplate if it's within two weeks — otherwise it's noise.
  // `next_milestone_at` on the signals payload is already filtered to
  // uncomplete + >= today by the SQL aggregate.
  const nearest = (() => {
    let soonest: string | null = null;
    let soonestDealId: string | null = null;
    for (const d of deals) {
      const at = signals[d.id]?.next_milestone_at;
      if (!at) continue;
      if (!soonest || at < soonest) {
        soonest = at;
        soonestDealId = d.id;
      }
    }
    if (!soonest) return null;
    const daysOut = Math.ceil(
      (new Date(soonest).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
    );
    if (daysOut > 14 || daysOut < 0) return null;
    return { daysOut, dealId: soonestDealId };
  })();

  const action = nearest
    ? {
        label:
          nearest.daysOut <= 0
            ? "Milestone today"
            : nearest.daysOut === 1
            ? "Milestone tomorrow"
            : `Milestone in ${nearest.daysOut}d`,
        href: nearest.dealId ? `/deals/${nearest.dealId}/project` : "/development",
      }
    : null;

  // Surface the most-active dev deals first: those with real signals
  // (CEQA / programming / predev) ahead of bare closed-fallback entries.
  const rows = [...deals]
    .sort((a, b) => {
      const aSig = signals[a.id];
      const bSig = signals[b.id];
      const aActivity =
        (aSig?.has_ceqa ? 3 : 0) + (aSig?.has_programming ? 2 : 0) + (aSig?.has_predev_costs ? 1 : 0);
      const bActivity =
        (bSig?.has_ceqa ? 3 : 0) + (bSig?.has_programming ? 2 : 0) + (bSig?.has_predev_costs ? 1 : 0);
      if (aActivity !== bActivity) return bActivity - aActivity;
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    })
    .slice(0, 6);

  return (
    <PhasePanel
      phase="development"
      label="Development"
      href="/development"
      accentVar="--phase-dev"
      motif={Building}
      count={deals.length}
      isEmpty={deals.length === 0}
      action={action}
      emptyState={
        <p className="text-xs text-muted-foreground/50 text-center max-w-[24ch] font-nameplate italic">
          Close a value-add or ground-up deal to begin development.
        </p>
      }
      kpis={
        <>
          <PhaseKPI value={deals.length} label="In Development" accentVar="--phase-dev" />
          <PhaseKPI
            value={withProgramming}
            label="Programming"
            accentVar="--phase-dev"
            muted={withProgramming === 0}
          />
          <PhaseKPI
            value={withCeqa}
            label="CEQA Active"
            accentVar="--phase-dev"
            muted={withCeqa === 0}
          />
        </>
      }
    >
      {rows.map((d) => {
        const scopeLabel = d.deal_scope ? DEAL_SCOPE_LABELS[d.deal_scope] : null;
        const thesisLabel = d.investment_strategy ? INVESTMENT_THESIS_LABELS[d.investment_strategy] : null;
        const tag = scopeLabel ?? thesisLabel ?? "Development";
        const sig = signals[d.id];
        return (
          <PhaseDealRow
            key={d.id}
            dealId={d.id}
            name={d.name}
            meta={[d.city, d.state].filter(Boolean).join(", ")}
            accentVar="--phase-dev"
            signal={
              <>
                <span
                  className="uppercase tracking-wider text-[10px] px-1.5 py-0.5 rounded"
                  style={{
                    background: `hsl(var(--phase-dev) / 0.12)`,
                    color: `hsl(var(--phase-dev))`,
                  }}
                >
                  {tag}
                </span>
                {sig?.has_ceqa && (
                  <span className="text-[10px] text-muted-foreground/70">CEQA</span>
                )}
              </>
            }
          />
        );
      })}
    </PhasePanel>
  );
}
