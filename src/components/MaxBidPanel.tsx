"use client";

// MaxBidPanel — reverse-underwriting modal.
//
// Takes the current UWData + calc mode, lets the analyst punch in return
// hurdles (IRR / EM / CoC / DSCR), and back-solves the maximum price
// that still clears every hurdle. Also renders a sensitivity strip
// showing how the answer moves when rents, exit cap, or interest rate
// twist. Everything runs client-side — the solver reuses calc() from
// underwriting-calc.ts so the numbers stay consistent with the main UW
// page.

import React, { useMemo, useState } from "react";
import { X, Target, TrendingUp, TrendingDown, Sparkles, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { solveMaxBid, getMetricsAt, getMetricsAtZeroBasis, type CalcMode, type MaxBidTargets } from "@/lib/max-bid";
import type { UWData } from "@/lib/underwriting-calc";

interface Props {
  data: UWData;
  mode: CalcMode;
  onClose: () => void;
  onApply: (price: number) => void;
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

export default function MaxBidPanel({ data, mode, onClose, onApply }: Props) {
  // Default hurdles match what most acquisitions teams start from. Analyst
  // can blank any field to skip it.
  const [targetIrr, setTargetIrr] = useState<number | undefined>(15);
  const [targetEm, setTargetEm] = useState<number | undefined>(1.8);
  const [targetCoc, setTargetCoc] = useState<number | undefined>(undefined);
  const [targetDscr, setTargetDscr] = useState<number | undefined>(data.has_financing ? 1.25 : undefined);
  const [holdYears, setHoldYears] = useState<number>(data.hold_period_years || 5);
  const [showDebug, setShowDebug] = useState(false);

  // Clone the data so we can override the hold period without mutating
  // upstream state — analyst often wants to see max-bid at 3yr/5yr/7yr.
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

  // Only solve once per input change. The solver is synchronous but runs
  // calc() ~40x (bisection) + 5x (sensitivity × 40) = ~240 calc() calls.
  // For a typical deal calc() is sub-millisecond, so this is instant.
  const result = useMemo(() => solveMaxBid(solverInput, targets, mode), [solverInput, targets, mode]);

  // Diagnostic baselines — rendered in the footer so the analyst can
  // sanity-check the solver against the main page's displayed numbers.
  // If the Max-Bid modal says "15% IRR at $5M land" but the UW page
  // shows the CURRENT-basis IRR at 11%, the analyst can see the shape
  // of the tradeoff at a glance: "yes, my deal's on the margin, need
  // to trim land to get to 15%."
  const currentMetrics = useMemo(() => getMetricsAt(solverInput, mode), [solverInput, mode]);
  const zeroMetrics = useMemo(() => getMetricsAtZeroBasis(solverInput, mode), [solverInput, mode]);

  const currentBasis = data.development_mode ? (data.land_cost || 0) : (data.purchase_price || 0);
  const basisLabel = data.development_mode ? "Current Land Cost" : "Current Purchase Price";
  const bidLabel = data.development_mode ? "Max Land Cost" : "Max Bid";
  const delta = result.max_bid - currentBasis;

  const noHurdle = !targetIrr && !targetEm && !targetCoc && !targetDscr;
  const zeroBid = result.max_bid === 0 && !noHurdle;

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
              Max Bid Calculator
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Reverse-solve the {data.development_mode ? "max land cost" : "max purchase price"} that clears your return hurdles.
            </p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
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
            <p className="text-2xs text-muted-foreground mt-2">
              Leave any field blank to skip that hurdle. All other UW assumptions (rents, OpEx, financing, exit cap) are taken from the current underwriting.
            </p>
          </div>

          {/* ── Result ── */}
          {noHurdle ? (
            <div className="p-4 rounded-lg border bg-muted/20 text-sm text-muted-foreground flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              Enter at least one hurdle above to solve for the max bid.
            </div>
          ) : (
            <div className="rounded-lg border bg-gradient-to-br from-primary/10 to-primary/5 p-5">
              <div className="flex items-baseline justify-between gap-4 flex-wrap">
                <div>
                  <div className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">{bidLabel}</div>
                  <div className="text-3xl font-bold tabular-nums mt-1">{zeroBid ? "— below target at any price" : fc(result.max_bid)}</div>
                  {!zeroBid && currentBasis > 0 && (
                    <div className={`text-xs mt-1 flex items-center gap-1 ${delta >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {delta >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                      {delta >= 0 ? "+" : "−"}{fc(Math.abs(delta))} vs. {basisLabel.toLowerCase()} ({fc(currentBasis)})
                    </div>
                  )}
                </div>
                {!zeroBid && (
                  <div className="text-right text-xs space-y-0.5">
                    <div className="text-muted-foreground">At that {data.development_mode ? "land cost" : "price"}:</div>
                    <div className="tabular-nums">IRR <span className="text-blue-300 font-medium">{result.metrics_at_max_bid.irr.toFixed(2)}%</span></div>
                    <div className="tabular-nums">EM <span className="text-blue-300 font-medium">{result.metrics_at_max_bid.equity_multiple.toFixed(2)}x</span></div>
                    <div className="tabular-nums">CoC <span className="text-blue-300 font-medium">{result.metrics_at_max_bid.coc.toFixed(2)}%</span></div>
                    {data.has_financing && (
                      <div className="tabular-nums">DSCR <span className="text-blue-300 font-medium">{result.metrics_at_max_bid.dscr.toFixed(2)}x</span></div>
                    )}
                    <div className="tabular-nums">Cap rate <span className="text-blue-300 font-medium">{result.metrics_at_max_bid.cap_rate.toFixed(2)}%</span></div>
                  </div>
                )}
              </div>
              {zeroBid && (
                <div className="mt-3 text-xs text-amber-300 flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>
                    Even at zero {data.development_mode ? "land cost" : "basis"}, the best achievable{" "}
                    <strong className="font-semibold">{result.binding_constraint.replace("_", " ")}</strong> is{" "}
                    <span className="tabular-nums font-semibold text-blue-300">
                      {result.binding_constraint === "irr" ? `${zeroMetrics.irr.toFixed(2)}%`
                        : result.binding_constraint === "equity_multiple" ? `${zeroMetrics.equity_multiple.toFixed(2)}x`
                        : result.binding_constraint === "coc" ? `${zeroMetrics.coc.toFixed(2)}%`
                        : result.binding_constraint === "dscr" ? `${zeroMetrics.dscr.toFixed(2)}x`
                        : "—"}
                    </span>
                    {" "}— below your target. Loosen the hurdle, or revisit rents / OpEx / debt structure.
                  </span>
                </div>
              )}
            </div>
          )}

          {/* ── Diagnostic: current-basis and zero-basis metrics ─────
              Side-by-side table so the analyst can cross-check against
              what the main UW page shows. If Max-Bid's "current basis
              IRR" disagrees with the page's returns table, the inputs
              in the two paths don't match — usually a scenario/override
              layering issue — and the analyst can see it at a glance. */}
          {!noHurdle && (
            <div className="border rounded-lg bg-muted/10 overflow-hidden">
              <div className="px-4 py-2 border-b bg-muted/20 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                Where the deal stands — diagnostic
              </div>
              <div className="grid grid-cols-3 text-xs">
                <div className="px-4 py-2 bg-muted/5">
                  <div className="text-2xs text-muted-foreground mb-1">Metric</div>
                  <div className="space-y-1">
                    <div>IRR</div>
                    <div>Equity multiple</div>
                    <div>Cash-on-cash (Yr 1)</div>
                    {data.has_financing && <div>DSCR</div>}
                    <div>NOI</div>
                    <div>Cap rate</div>
                  </div>
                </div>
                <div className="px-4 py-2 border-l">
                  <div className="text-2xs text-muted-foreground mb-1">
                    At current {data.development_mode ? "land" : "basis"} <span className="tabular-nums">({fc(currentBasis)})</span>
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
              <div className="px-4 py-2 bg-muted/5 text-2xs text-muted-foreground border-t flex items-center justify-between gap-2">
                <span>
                  If the &quot;current&quot; column doesn&apos;t match the Returns panel, the UW record likely has a scenario override — close, clear it, and retry.
                </span>
                <button
                  onClick={() => setShowDebug(v => !v)}
                  className="text-blue-300 hover:underline whitespace-nowrap"
                >
                  {showDebug ? "Hide" : "Show"} raw calc values
                </button>
              </div>
              {showDebug && (
                <div className="px-4 py-3 border-t bg-black/20 text-2xs font-mono space-y-1 overflow-x-auto">
                  <div>data.hold_period_years = <span className="text-blue-300">{data.hold_period_years}</span>, modal holdYears = <span className="text-blue-300">{holdYears}</span></div>
                  <div>data.development_mode = <span className="text-blue-300">{String(data.development_mode)}</span>, data.has_financing = <span className="text-blue-300">{String(data.has_financing)}</span></div>
                  <div>calcMode = <span className="text-blue-300">{mode}</span></div>
                  <div className="pt-2 text-muted-foreground">── At current basis ──</div>
                  <div>equity = <span className="text-blue-300">{fc(currentMetrics.equity)}</span>, total_cost = <span className="text-blue-300">{fc(currentMetrics.total_cost)}</span></div>
                  <div>proformaNOI = <span className="text-blue-300">{fc(currentMetrics.noi)}</span>, exitValue = <span className="text-blue-300">{fc(currentMetrics._debug_exit_value)}</span>, exitEquity = <span className="text-blue-300">{fc(currentMetrics._debug_exit_equity)}</span></div>
                  <div>year cashflows: {currentMetrics._debug_year_cashflows.map((cf, i) => (
                    <span key={i} className="text-blue-300 mr-2">yr{i+1}={fc(cf)}</span>
                  ))}</div>
                  <div className="pt-2 text-muted-foreground">── At zero basis ──</div>
                  <div>equity = <span className="text-blue-300">{fc(zeroMetrics.equity)}</span>, total_cost = <span className="text-blue-300">{fc(zeroMetrics.total_cost)}</span></div>
                  <div>proformaNOI = <span className="text-blue-300">{fc(zeroMetrics.noi)}</span>, exitValue = <span className="text-blue-300">{fc(zeroMetrics._debug_exit_value)}</span>, exitEquity = <span className="text-blue-300">{fc(zeroMetrics._debug_exit_equity)}</span></div>
                  <div>year cashflows: {zeroMetrics._debug_year_cashflows.map((cf, i) => (
                    <span key={i} className="text-blue-300 mr-2">yr{i+1}={fc(cf)}</span>
                  ))}</div>
                </div>
              )}
            </div>
          )}

          {/* ── Sensitivity ── */}
          {!noHurdle && !zeroBid && result.sensitivity.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <Sparkles className="h-3 w-3 text-primary" />
                Sensitivity — max bid moves if…
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {result.sensitivity.map((s, i) => {
                  const up = s.delta > 0;
                  return (
                    <div key={i} className="flex items-center justify-between border rounded-md px-3 py-2 bg-muted/10 text-xs">
                      <span className="text-muted-foreground">{s.label}</span>
                      <span className={`font-medium tabular-nums ${up ? "text-emerald-400" : s.delta < 0 ? "text-red-400" : "text-muted-foreground"}`}>
                        {up ? "+" : s.delta < 0 ? "−" : ""}{fc(Math.abs(s.delta))}
                      </span>
                    </div>
                  );
                })}
              </div>
              <p className="text-2xs text-muted-foreground mt-2">
                Deltas vs. the baseline max bid above. Solve is re-run against the current UW with each twist applied.
              </p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 p-4 border-t bg-muted/10">
          <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
          {!noHurdle && !zeroBid && result.max_bid > 0 && (
            <Button size="sm" onClick={() => { onApply(result.max_bid); onClose(); }}>
              Apply as {data.development_mode ? "Land Cost" : "Purchase Price"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
