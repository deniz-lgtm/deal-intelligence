"use client";

// MaxBidPanel — three-mode goal-seek modal.
//
// Presents three bid-adjacent questions the analyst typically wants to
// answer before putting in a bid:
//
//   1. Price    — what's the max I can pay and still clear my hurdles?
//   2. Rents    — how much can rents drop before the deal breaks?
//   3. Exit cap — how much cap expansion can the deal absorb?
//
// All three share the same hurdle engine (IRR / EM / CoC / DSCR) and the
// same page-local calc(), so numbers line up with the Returns panel and
// the Scenario Wizard's legacy goal-seek modes (which this modal retires).

import React, { useMemo, useState } from "react";
import { X, Target, TrendingUp, TrendingDown, Sparkles, AlertCircle, DollarSign, Percent } from "lucide-react";
import { Button } from "@/components/ui/button";
import { solve, getMetricsAt, getMetricsAtZeroBasis, type CalcMode, type CalcFn, type SolveMode, type SolveResult, type MaxBidTargets } from "@/lib/max-bid";
import type { UWData } from "@/lib/underwriting-calc";

interface Props {
  data: UWData;
  mode: CalcMode;
  onClose: () => void;
  /**
   * Invoked when the analyst clicks the mode-specific Apply button.
   * `result.solve_mode` tells the caller which UWData field to touch:
   *   price    → purchase_price / land_cost
   *   rents    → scale unit_groups market rents by result.solved_value
   *   exit_cap → set exit_cap_rate
   */
  onApply: (result: SolveResult) => void;
  calcFn?: CalcFn;
}

const fc = (n: number) =>
  n || n === 0 ? "$" + Math.round(n).toLocaleString("en-US") : "—";

function NumInput({
  label, value, onChange, suffix,
}: {
  label: string; value: number | undefined; onChange: (v: number | undefined) => void; suffix?: string;
}) {
  const [raw, setRaw] = useState(value === undefined ? "" : String(value));
  React.useEffect(() => {
    setRaw(value === undefined ? "" : String(value));
  }, [value]);
  return (
    <div>
      <label className="block text-xs font-medium text-muted-foreground mb-1">{label}</label>
      <div className="flex items-center border rounded-md bg-background overflow-hidden">
        <input
          type="text"
          inputMode="decimal"
          value={raw}
          onChange={e => setRaw(e.target.value)}
          onBlur={() => {
            const trimmed = raw.trim();
            if (!trimmed) { onChange(undefined); return; }
            const v = parseFloat(trimmed);
            onChange(isFinite(v) ? v : undefined);
          }}
          className="flex-1 px-2 py-1.5 text-sm outline-none bg-transparent text-blue-300 tabular-nums"
          placeholder="—"
        />
        {suffix && <span className="px-2 text-sm text-muted-foreground bg-muted border-l">{suffix}</span>}
      </div>
    </div>
  );
}

// ── Mode-specific formatting ───────────────────────────────────────────────
// Each solve mode has its own headline label, display formatter, and
// "delta" formatter for the sensitivity strip. Centralized here so the
// render logic downstream stays readable.

interface ModeUI {
  key: SolveMode;
  label: string;
  shortLabel: string;
  icon: React.ComponentType<{ className?: string }>;
  headlineLabel: (d: UWData) => string;
  subtitle: (d: UWData) => string;
  /** Render the solved value as a headline string. */
  formatValue: (v: number, d: UWData) => string;
  /** Optional cushion/expansion line shown under the headline. */
  formatCushion: (v: number, d: UWData) => string | null;
  /** Format a sensitivity delta (delta is in the variable's native units). */
  formatDelta: (delta: number) => string;
  applyLabel: (d: UWData) => string;
  /** Compute the "current" value the analyst sees on the UW page for this mode. */
  currentValue: (d: UWData) => number;
  /** Delta vs. current in display format. */
  formatVsCurrent: (solved: number, d: UWData) => { text: string; positive: boolean } | null;
}

const MODE_UIS: Record<SolveMode, ModeUI> = {
  price: {
    key: "price",
    label: "Max Price",
    shortLabel: "Price",
    icon: DollarSign,
    headlineLabel: (d) => d.development_mode ? "Max Land Cost" : "Max Bid",
    subtitle: (d) => `Highest ${d.development_mode ? "land cost" : "purchase price"} that still clears your hurdles.`,
    formatValue: (v) => fc(v),
    formatCushion: () => null,
    formatDelta: (delta) => `${delta >= 0 ? "+" : "−"}${fc(Math.abs(delta))}`,
    applyLabel: (d) => d.development_mode ? "Apply as Land Cost" : "Apply as Purchase Price",
    currentValue: (d) => d.development_mode ? (d.land_cost || 0) : (d.purchase_price || 0),
    formatVsCurrent: (solved, d) => {
      const cur = d.development_mode ? (d.land_cost || 0) : (d.purchase_price || 0);
      if (cur <= 0) return null;
      const delta = solved - cur;
      return {
        text: `${delta >= 0 ? "+" : "−"}${fc(Math.abs(delta))} vs. current (${fc(cur)})`,
        positive: delta >= 0,
      };
    },
  },
  rents: {
    key: "rents",
    label: "Min Rent",
    shortLabel: "Rents",
    icon: TrendingDown,
    headlineLabel: () => "Rent Floor",
    subtitle: () => "Lowest rents — as a % of current market — the deal can sustain while clearing hurdles.",
    formatValue: (v) => `${(v * 100).toFixed(1)}% of market`,
    formatCushion: (v) => {
      const cushion = (1 - v) * 100;
      if (cushion > 0) return `${cushion.toFixed(1)}% rent cushion below current market`;
      if (cushion < 0) return `Needs ${Math.abs(cushion).toFixed(1)}% rent growth above current to clear hurdles`;
      return "At current market rents exactly";
    },
    formatDelta: (delta) => `${delta >= 0 ? "+" : "−"}${Math.abs(delta * 100).toFixed(1)} pct pts`,
    applyLabel: () => "Apply scaled rents",
    currentValue: () => 1.0, // current multiplier is definitionally 1.0x
    formatVsCurrent: () => null,
  },
  exit_cap: {
    key: "exit_cap",
    label: "Max Exit Cap",
    shortLabel: "Exit Cap",
    icon: Percent,
    headlineLabel: () => "Max Exit Cap",
    subtitle: () => "Highest exit cap the deal can absorb before hurdles break.",
    formatValue: (v) => `${v.toFixed(3)}%`,
    formatCushion: (v, d) => {
      const bps = (v - d.exit_cap_rate) * 100;
      if (bps > 0) return `${bps.toFixed(0)} bps of cap expansion from current ${d.exit_cap_rate.toFixed(2)}%`;
      if (bps < 0) return `Requires cap compression of ${Math.abs(bps).toFixed(0)} bps from current ${d.exit_cap_rate.toFixed(2)}%`;
      return "At current exit cap exactly";
    },
    formatDelta: (delta) => `${delta >= 0 ? "+" : "−"}${Math.abs(delta * 100).toFixed(0)} bps`,
    applyLabel: () => "Apply as Exit Cap",
    currentValue: (d) => d.exit_cap_rate,
    formatVsCurrent: (solved, d) => {
      const bps = (solved - d.exit_cap_rate) * 100;
      return {
        text: `${bps >= 0 ? "+" : "−"}${Math.abs(bps).toFixed(0)} bps vs. current (${d.exit_cap_rate.toFixed(2)}%)`,
        positive: bps >= 0,
      };
    },
  },
};

export default function MaxBidPanel({ data, mode, onClose, onApply, calcFn }: Props) {
  const [solveMode, setSolveMode] = useState<SolveMode>("price");

  // Default hurdles match what most acquisitions teams start from. Analyst
  // can blank any field to skip it.
  const [targetIrr, setTargetIrr] = useState<number | undefined>(15);
  const [targetEm, setTargetEm] = useState<number | undefined>(1.8);
  const [targetCoc, setTargetCoc] = useState<number | undefined>(undefined);
  const [targetDscr, setTargetDscr] = useState<number | undefined>(data.has_financing ? 1.25 : undefined);
  const [holdYears, setHoldYears] = useState<number>(data.hold_period_years || 5);

  const solverInput = useMemo<UWData>(() => ({
    ...data,
    hold_period_years: holdYears,
  }), [data, holdYears]);

  const targets = useMemo<MaxBidTargets>(() => ({
    target_irr_pct: targetIrr,
    target_equity_multiple: targetEm,
    target_coc_pct: targetCoc,
    target_dscr: targetDscr,
  }), [targetIrr, targetEm, targetCoc, targetDscr]);

  const result = useMemo(
    () => solve(solverInput, targets, mode, solveMode, calcFn),
    [solverInput, targets, mode, solveMode, calcFn]
  );

  const currentMetrics = useMemo(() => getMetricsAt(solverInput, mode, calcFn), [solverInput, mode, calcFn]);
  const zeroMetrics = useMemo(() => getMetricsAtZeroBasis(solverInput, mode, calcFn), [solverInput, mode, calcFn]);

  const ui = MODE_UIS[solveMode];
  const noHurdle = !targetIrr && !targetEm && !targetCoc && !targetDscr;
  const cushion = ui.formatCushion(result.solved_value, data);
  const vsCurrent = ui.formatVsCurrent(result.solved_value, data);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="bg-card rounded-xl border shadow-lifted-md w-full max-w-3xl max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b">
          <div>
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <Target className="h-4 w-4 text-primary" />
              Goal Seek
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">{ui.subtitle(data)}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── Mode tabs ── */}
        <div className="px-4 pt-3 border-b">
          <div className="flex items-center gap-1">
            {(Object.keys(MODE_UIS) as SolveMode[]).map(m => {
              const modeUI = MODE_UIS[m];
              const Icon = modeUI.icon;
              const active = solveMode === m;
              return (
                <button
                  key={m}
                  onClick={() => setSolveMode(m)}
                  className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
                    active
                      ? "text-primary border-primary"
                      : "text-muted-foreground border-transparent hover:text-foreground"
                  }`}
                >
                  <Icon className="h-3 w-3" />
                  {modeUI.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="p-5 space-y-5 overflow-y-auto">
          {/* ── Hurdles ── */}
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Return Hurdles</h4>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <NumInput label="Target IRR" value={targetIrr} onChange={setTargetIrr} suffix="%" />
              <NumInput label="Target EM" value={targetEm} onChange={setTargetEm} suffix="x" />
              <NumInput label="Target CoC" value={targetCoc} onChange={setTargetCoc} suffix="%" />
              <NumInput label="Target DSCR" value={targetDscr} onChange={setTargetDscr} suffix="x" />
              <NumInput label="Hold Years" value={holdYears} onChange={v => setHoldYears(v || 5)} suffix="yr" />
            </div>
          </div>

          {/* ── Result ── */}
          {noHurdle ? (
            <div className="p-4 rounded-lg border bg-muted/20 text-sm text-muted-foreground flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              Enter at least one hurdle above to solve.
            </div>
          ) : (
            <div className="rounded-lg border bg-gradient-to-br from-primary/10 to-primary/5 p-5">
              <div className="flex items-baseline justify-between gap-4 flex-wrap">
                <div>
                  <div className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">{ui.headlineLabel(data)}</div>
                  <div className="text-3xl font-bold tabular-nums mt-1">
                    {result.any_pass ? ui.formatValue(result.solved_value, data) : "— below target at any value"}
                  </div>
                  {result.any_pass && cushion && (
                    <div className="text-xs text-muted-foreground mt-1">{cushion}</div>
                  )}
                  {result.any_pass && vsCurrent && (
                    <div className={`text-xs mt-1 flex items-center gap-1 ${vsCurrent.positive ? "text-emerald-400" : "text-red-400"}`}>
                      {vsCurrent.positive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                      {vsCurrent.text}
                    </div>
                  )}
                </div>
                {result.any_pass && (
                  <div className="text-right text-xs space-y-0.5">
                    <div className="text-muted-foreground">At that value:</div>
                    <div className="tabular-nums">IRR <span className="text-blue-300 font-medium">{result.metrics_at_solved.irr.toFixed(2)}%</span></div>
                    <div className="tabular-nums">EM <span className="text-blue-300 font-medium">{result.metrics_at_solved.equity_multiple.toFixed(2)}x</span></div>
                    <div className="tabular-nums">CoC <span className="text-blue-300 font-medium">{result.metrics_at_solved.coc.toFixed(2)}%</span></div>
                    {data.has_financing && (
                      <div className="tabular-nums">DSCR <span className="text-blue-300 font-medium">{result.metrics_at_solved.dscr.toFixed(2)}x</span></div>
                    )}
                    <div className="tabular-nums">Cap rate <span className="text-blue-300 font-medium">{result.metrics_at_solved.cap_rate.toFixed(2)}%</span></div>
                  </div>
                )}
              </div>
              {!result.any_pass && (
                <div className="mt-3 text-xs text-amber-300 flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>
                    No {solveMode === "price" ? (data.development_mode ? "land cost" : "price")
                      : solveMode === "rents" ? "rent level"
                      : "exit cap"}
                    {" "}in the search range clears the{" "}
                    <strong className="font-semibold">{result.binding_constraint.replace("_", " ")}</strong> hurdle. Loosen the hurdle, or revisit rents / OpEx / debt structure.
                  </span>
                </div>
              )}
            </div>
          )}

          {/* ── Diagnostic: current vs zero-basis metrics ─── */}
          {!noHurdle && (
            <div className="border rounded-lg bg-muted/10 overflow-hidden">
              <div className="px-4 py-2 border-b bg-muted/20 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                Where the deal stands
              </div>
              <div className="grid grid-cols-3 text-xs">
                <div className="px-4 py-2 bg-muted/5">
                  <div className="text-2xs text-muted-foreground mb-1">Metric</div>
                  <div className="space-y-1">
                    <div>IRR</div>
                    <div>Equity multiple</div>
                    <div>Cash-on-cash (stab.)</div>
                    {data.has_financing && <div>DSCR (stab.)</div>}
                    <div>NOI</div>
                    <div>Cap rate</div>
                  </div>
                </div>
                <div className="px-4 py-2 border-l">
                  <div className="text-2xs text-muted-foreground mb-1">
                    At current {data.development_mode ? "land" : "basis"}
                  </div>
                  <div className="space-y-1 tabular-nums">
                    <div className={currentMetrics.irr >= (targetIrr ?? 0) ? "text-emerald-300" : "text-muted-foreground"}>
                      {currentMetrics.irr.toFixed(2)}%
                    </div>
                    <div className={currentMetrics.equity_multiple >= (targetEm ?? 0) ? "text-emerald-300" : "text-muted-foreground"}>
                      {currentMetrics.equity_multiple.toFixed(2)}x
                    </div>
                    <div className={currentMetrics.coc >= (targetCoc ?? 0) ? "text-emerald-300" : "text-muted-foreground"}>
                      {currentMetrics.coc.toFixed(2)}%
                    </div>
                    {data.has_financing && (
                      <div className={currentMetrics.dscr >= (targetDscr ?? 0) ? "text-emerald-300" : "text-muted-foreground"}>
                        {currentMetrics.dscr.toFixed(2)}x
                      </div>
                    )}
                    <div>{fc(currentMetrics.noi)}</div>
                    <div>{currentMetrics.cap_rate.toFixed(2)}%</div>
                  </div>
                </div>
                <div className="px-4 py-2 border-l">
                  <div className="text-2xs text-muted-foreground mb-1">
                    At zero {data.development_mode ? "land" : "basis"} (best case)
                  </div>
                  <div className="space-y-1 tabular-nums">
                    <div className={zeroMetrics.irr >= (targetIrr ?? 0) ? "text-emerald-300" : "text-red-300"}>
                      {zeroMetrics.irr.toFixed(2)}%
                    </div>
                    <div className={zeroMetrics.equity_multiple >= (targetEm ?? 0) ? "text-emerald-300" : "text-red-300"}>
                      {zeroMetrics.equity_multiple.toFixed(2)}x
                    </div>
                    <div className={zeroMetrics.coc >= (targetCoc ?? 0) ? "text-emerald-300" : "text-red-300"}>
                      {zeroMetrics.coc.toFixed(2)}%
                    </div>
                    {data.has_financing && (
                      <div className={zeroMetrics.dscr >= (targetDscr ?? 0) ? "text-emerald-300" : "text-red-300"}>
                        {zeroMetrics.dscr.toFixed(2)}x
                      </div>
                    )}
                    <div>{fc(zeroMetrics.noi)}</div>
                    <div>{zeroMetrics.cap_rate.toFixed(2)}%</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Sensitivity ── */}
          {!noHurdle && result.any_pass && result.sensitivity.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <Sparkles className="h-3 w-3 text-primary" />
                Sensitivity — answer moves if…
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {result.sensitivity.map((s, i) => {
                  const up = s.delta > 0;
                  return (
                    <div key={i} className="flex items-center justify-between border rounded-md px-3 py-2 bg-muted/10 text-xs">
                      <span className="text-muted-foreground">{s.label}</span>
                      <span className={`font-medium tabular-nums ${up ? "text-emerald-400" : s.delta < 0 ? "text-red-400" : "text-muted-foreground"}`}>
                        {ui.formatDelta(s.delta)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 p-4 border-t bg-muted/10">
          <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
          {!noHurdle && result.any_pass && (
            <Button size="sm" onClick={() => { onApply(result); onClose(); }}>
              {ui.applyLabel(data)}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
