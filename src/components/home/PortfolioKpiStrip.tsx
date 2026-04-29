"use client";

import { DollarSign, Ruler, Home, Compass, Building, HardHat } from "lucide-react";
import type { Deal, DealPhase } from "@/lib/types";
import { classifyDealPhase } from "@/lib/phase-classification";
import { formatCompact, formatCompactCurrency } from "@/lib/utils";

// Team-wide portfolio strip on the home dashboard. Lives above the triptych
// so anyone on the team — not just the acquisitions lead — can see where
// everything stands at a glance: total pipeline dollars, square footage,
// and units across the whole book of business.
//
// Scope: every deal that isn't dead or archived. Each tile shows the
// portfolio total and a phase breakdown (Acq / Dev / Con) underneath so
// readers can see how the value distributes across the three departments.

interface DealLike extends Deal {
  total_project_cost?: number | null;
}

interface Props {
  deals: DealLike[];
}

const TERMINAL_STAGES = new Set(["dead", "archived"]);

interface PhaseTotals {
  value: number;
  sf: number;
  units: number;
}

function dealCost(d: DealLike): number {
  return (d.total_project_cost && d.total_project_cost > 0 ? d.total_project_cost : d.asking_price) || 0;
}

function emptyPhaseTotals(): Record<DealPhase, PhaseTotals> {
  return {
    acquisition: { value: 0, sf: 0, units: 0 },
    development: { value: 0, sf: 0, units: 0 },
    construction: { value: 0, sf: 0, units: 0 },
  };
}

export function PortfolioKpiStrip({ deals }: Props) {
  const live = deals.filter((d) => !TERMINAL_STAGES.has(d.status));

  const totals: PhaseTotals = { value: 0, sf: 0, units: 0 };
  const byPhase = emptyPhaseTotals();
  // A deal can belong to more than one phase (multi-pinned). Sum into each
  // phase it classifies into; portfolio totals stay deduped per deal.
  for (const d of live) {
    const cost = dealCost(d);
    const sf = d.square_footage ?? 0;
    const units = d.units ?? 0;
    totals.value += cost;
    totals.sf += sf;
    totals.units += units;
    const { phases } = classifyDealPhase(d);
    for (const phase of phases) {
      byPhase[phase].value += cost;
      byPhase[phase].sf += sf;
      byPhase[phase].units += units;
    }
  }

  const tiles: Array<{
    icon: typeof DollarSign;
    iconClass: string;
    label: string;
    valueLabel: string;
    suffix?: string;
    pickPhase: (t: PhaseTotals) => number;
    format: (n: number) => string;
  }> = [
    {
      icon: DollarSign,
      iconClass: "text-emerald-400",
      label: "Pipeline $",
      valueLabel: totals.value > 0 ? formatCompactCurrency(totals.value) : "—",
      pickPhase: (t) => t.value,
      format: formatCompactCurrency,
    },
    {
      icon: Ruler,
      iconClass: "text-cyan-400",
      label: "Pipeline SF",
      valueLabel: totals.sf > 0 ? formatCompact(totals.sf) : "—",
      suffix: totals.sf > 0 ? "SF" : undefined,
      pickPhase: (t) => t.sf,
      format: formatCompact,
    },
    {
      icon: Home,
      iconClass: "text-amber-400",
      label: "Pipeline Units",
      valueLabel: totals.units > 0 ? formatCompact(totals.units) : "—",
      pickPhase: (t) => t.units,
      format: formatCompact,
    },
  ];

  return (
    <div className="shrink-0 border-b border-border/30 bg-card/20 backdrop-blur-sm">
      <div className="max-w-full mx-auto px-6 sm:px-8 py-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-8">
          {tiles.map((tile) => {
            const Icon = tile.icon;
            const acq = tile.pickPhase(byPhase.acquisition);
            const dev = tile.pickPhase(byPhase.development);
            const con = tile.pickPhase(byPhase.construction);
            return (
              <div key={tile.label} className="flex items-center gap-3 min-w-0">
                <div className="shrink-0 h-9 w-9 rounded-lg bg-card/60 border border-border/40 flex items-center justify-center">
                  <Icon className={`h-4 w-4 ${tile.iconClass}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-1.5">
                    <span className="font-display text-2xl leading-none tabular-nums tracking-tight">
                      {tile.valueLabel}
                    </span>
                    {tile.suffix && (
                      <span className="text-xs text-muted-foreground/70">{tile.suffix}</span>
                    )}
                  </div>
                  <div className="mt-1 text-[10px] uppercase tracking-[0.16em] text-muted-foreground/70">
                    {tile.label}
                  </div>
                  <div className="mt-1.5 flex items-center gap-3 text-[10px] text-muted-foreground/70 tabular-nums">
                    <PhaseChip
                      icon={Compass}
                      accentVar="--phase-acq"
                      value={acq > 0 ? tile.format(acq) : "—"}
                    />
                    <PhaseChip
                      icon={Building}
                      accentVar="--phase-dev"
                      value={dev > 0 ? tile.format(dev) : "—"}
                    />
                    <PhaseChip
                      icon={HardHat}
                      accentVar="--phase-con"
                      value={con > 0 ? tile.format(con) : "—"}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function PhaseChip({
  icon: Icon,
  accentVar,
  value,
}: {
  icon: typeof Compass;
  accentVar: string;
  value: string;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <Icon className="h-2.5 w-2.5" style={{ color: `hsl(var(${accentVar}))` }} strokeWidth={1.75} />
      <span>{value}</span>
    </span>
  );
}
