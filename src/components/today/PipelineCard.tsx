"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Coins, Loader2, ArrowRight, Compass, Building, HardHat } from "lucide-react";
import { classifyDealPhase } from "@/lib/phase-classification";
import type { Deal, DealPhase } from "@/lib/types";
import { formatCompact, formatCompactCurrency } from "@/lib/utils";

// Pipeline card on the Today strip — sits between Upcoming and Market so
// every team member, not just the acquisitions lead, sees the portfolio's
// $/SF/Units snapshot the moment they land on the home page.
//
// Three rows, one per metric. Each row shows the portfolio total and a
// per-phase breakdown (Acq / Dev / Con) so readers can see how the value
// distributes across the triptych below.

interface DealLike extends Deal {
  total_project_cost?: number | null;
}

const TERMINAL_STAGES = new Set(["dead", "archived"]);

interface PhaseTotals {
  value: number;
  sf: number;
  units: number;
}

function dealCost(d: DealLike): number {
  return (
    (d.total_project_cost && d.total_project_cost > 0
      ? d.total_project_cost
      : d.asking_price) || 0
  );
}

function emptyPhaseTotals(): Record<DealPhase, PhaseTotals> {
  return {
    acquisition: { value: 0, sf: 0, units: 0 },
    development: { value: 0, sf: 0, units: 0 },
    construction: { value: 0, sf: 0, units: 0 },
  };
}

export function PipelineCard() {
  const [deals, setDeals] = useState<DealLike[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/deals")
      .then((r) => r.json())
      .then((j) => setDeals(j.data || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const live = (deals ?? []).filter((d) => !TERMINAL_STAGES.has(d.status));

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

  const isEmpty = !loading && live.length === 0;

  return (
    <section className="group/panel relative flex flex-col px-6 py-8 transition-colors duration-300 hover:bg-card/10">
      {/* Editorial nameplate — mirrors UpcomingMilestonesCard / MarketWidgetsCard
          so the strip reads as one magazine spread. */}
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-3 min-w-0">
          <Link
            href="/acquisition"
            className="font-nameplate text-3xl leading-none tracking-tight text-foreground hover:text-primary transition-colors"
          >
            Pipeline
          </Link>
          {live.length > 0 && (
            <span
              className="text-2xs font-medium tabular-nums uppercase tracking-[0.15em]"
              style={{ color: "hsl(var(--primary) / 0.8)" }}
            >
              {live.length} active
            </span>
          )}
        </div>
        <Coins
          className="h-4 w-4 transition-transform duration-500 group-hover/panel:rotate-[8deg] text-primary"
          strokeWidth={1.5}
        />
      </div>
      <div
        className="mt-3 h-px origin-left transition-transform duration-[500ms] ease-out scale-x-[0.35] group-hover/panel:scale-x-100"
        style={{ background: "hsl(var(--primary))" }}
      />

      <div className="mt-7 flex-1 min-h-0">
        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground/60" />
          </div>
        ) : isEmpty ? (
          <div className="h-full flex items-center justify-center py-10">
            <p className="text-xs text-muted-foreground/50 text-center max-w-[36ch] font-nameplate italic">
              No active deals yet. Create one to start sizing the pipeline.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border/15">
            <MetricRow
              label="$"
              value={totals.value > 0 ? formatCompactCurrency(totals.value) : "—"}
              acq={byPhase.acquisition.value}
              dev={byPhase.development.value}
              con={byPhase.construction.value}
              format={formatCompactCurrency}
            />
            <MetricRow
              label="SF"
              value={totals.sf > 0 ? formatCompact(totals.sf) : "—"}
              acq={byPhase.acquisition.sf}
              dev={byPhase.development.sf}
              con={byPhase.construction.sf}
              format={formatCompact}
            />
            <MetricRow
              label="Units"
              value={totals.units > 0 ? formatCompact(totals.units) : "—"}
              acq={byPhase.acquisition.units}
              dev={byPhase.development.units}
              con={byPhase.construction.units}
              format={formatCompact}
            />
          </ul>
        )}
      </div>

      {!loading && !isEmpty && (
        <div className="mt-6 pt-4 border-t border-border/20">
          <Link
            href="/acquisition"
            className="inline-flex items-center gap-1.5 text-xs font-medium tracking-wide text-primary transition-all hover:gap-2"
          >
            <span>See pipeline</span>
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      )}
    </section>
  );
}

interface MetricRowProps {
  label: string;
  value: string;
  acq: number;
  dev: number;
  con: number;
  format: (n: number) => string;
}

function MetricRow({ label, value, acq, dev, con, format }: MetricRowProps) {
  return (
    <li className="py-2.5 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-2xs uppercase tracking-[0.18em] text-muted-foreground/70">
          {label}
        </div>
        <div className="mt-1 flex items-center gap-3 text-[10px] text-muted-foreground/70 tabular-nums">
          <PhaseChip icon={Compass} accentVar="--phase-acq" value={acq > 0 ? format(acq) : "—"} />
          <PhaseChip icon={Building} accentVar="--phase-dev" value={dev > 0 ? format(dev) : "—"} />
          <PhaseChip icon={HardHat} accentVar="--phase-con" value={con > 0 ? format(con) : "—"} />
        </div>
      </div>
      <div className="font-display text-3xl leading-none tabular-nums tracking-tight text-foreground shrink-0">
        {value}
      </div>
    </li>
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
      <Icon
        className="h-2.5 w-2.5"
        style={{ color: `hsl(var(${accentVar}))` }}
        strokeWidth={1.75}
      />
      <span>{value}</span>
    </span>
  );
}
