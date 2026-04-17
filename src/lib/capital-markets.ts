// ─────────────────────────────────────────────────────────────────────────────
// Capital Markets Snapshot
//
// Pulls the FRED series a CRE developer triangulates every deal against —
// 10Y UST and 5Y UST (residual cap rate benchmark), SOFR (floating debt
// base rate), 30Y Mortgage (agency + conforming), Fed Funds — and emits a
// compact snapshot with deltas + commentary on where cap rates and
// construction loan rates *should* price today.
//
// Every investment-materials generator (Investment Package memo/deck,
// DD Abstract) calls this server-side and threads the result through
// buildMarketSummary() so every section prompt sees current rates and
// can cite them when writing "exit cap of 5.50% vs. 10Y UST + 165bps".
//
// Degrades gracefully: if FRED_API_KEY is unset or FRED is down, every
// field comes back null — we never fabricate rate data.
// ─────────────────────────────────────────────────────────────────────────────

import { getFredSeries, FRED_SERIES, type FredSeries } from "./fred";

export interface CapitalMarketsSnapshot {
  as_of: string | null;                 // ISO date of the most recent observation across series
  treasury_10y: SeriesPoint | null;
  treasury_5y: SeriesPoint | null;
  sofr: SeriesPoint | null;
  fed_funds: SeriesPoint | null;
  mortgage_30y: SeriesPoint | null;
  yield_curve_spread_bps: number | null; // (10Y - 2Y or 10Y - FedFunds proxy)
  implied_cap_rates: {
    // "Institutional/stabilized" = 10Y UST + historical 250-400 bps spread.
    // Numbers are percentage points (5.50 = 5.50%).
    stabilized_low: number | null;
    stabilized_high: number | null;
    value_add_low: number | null;
    value_add_high: number | null;
  };
  implied_construction_loan_rate: {
    // Floating construction debt: SOFR + 275-400 bps typical for MF.
    low: number | null;
    high: number | null;
  };
  fred_configured: boolean;
}

interface SeriesPoint {
  label: string;
  value: number;
  as_of: string;
  change_1d: number | null;
  change_30d: number | null;
}

function toPoint(s: FredSeries | null): SeriesPoint | null {
  if (!s || !s.latest) return null;
  return {
    label: s.label,
    value: s.latest.value,
    as_of: s.latest.date,
    change_1d: s.change_1d,
    change_30d: s.change_30d,
  };
}

export async function fetchCapitalMarketsSnapshot(): Promise<CapitalMarketsSnapshot> {
  const fredConfigured = Boolean(process.env.FRED_API_KEY);
  if (!fredConfigured) {
    return {
      as_of: null,
      treasury_10y: null,
      treasury_5y: null,
      sofr: null,
      fed_funds: null,
      mortgage_30y: null,
      yield_curve_spread_bps: null,
      implied_cap_rates: { stabilized_low: null, stabilized_high: null, value_add_low: null, value_add_high: null },
      implied_construction_loan_rate: { low: null, high: null },
      fred_configured: false,
    };
  }

  // 60-day window gives us enough headroom for weekend/holiday gaps and for
  // SOFR/MORTGAGE30US which publish on a lag.
  const DAYS = 60;
  const [ust10, ust5, sofr, fedFunds, mortgage] = await Promise.all([
    getFredSeries(FRED_SERIES.TREASURY_10Y.id, FRED_SERIES.TREASURY_10Y.label, DAYS),
    getFredSeries(FRED_SERIES.TREASURY_5Y.id, FRED_SERIES.TREASURY_5Y.label, DAYS),
    getFredSeries(FRED_SERIES.SOFR.id, FRED_SERIES.SOFR.label, DAYS),
    getFredSeries(FRED_SERIES.FED_FUNDS.id, FRED_SERIES.FED_FUNDS.label, DAYS),
    getFredSeries(FRED_SERIES.MORTGAGE_30Y.id, FRED_SERIES.MORTGAGE_30Y.label, DAYS),
  ]);

  const t10 = toPoint(ust10);
  const t5 = toPoint(ust5);
  const sofrPt = toPoint(sofr);
  const ffPt = toPoint(fedFunds);
  const mortPt = toPoint(mortgage);

  // Most-recent observation across loaded series — useful for footer dating.
  const asOfCandidates = [t10?.as_of, t5?.as_of, sofrPt?.as_of, ffPt?.as_of, mortPt?.as_of].filter(Boolean) as string[];
  asOfCandidates.sort();
  const asOf = asOfCandidates.length ? asOfCandidates[asOfCandidates.length - 1] : null;

  // Yield-curve proxy: 10Y UST minus Fed Funds — a flat/inverted read here is
  // a material input to any memo's rate-outlook section.
  const yieldCurveSpreadBps = t10 && ffPt ? Math.round((t10.value - ffPt.value) * 100) : null;

  // Implied cap rate bands — conservative institutional convention of
  // 10Y UST + 250-400 bps for stabilized core/core-plus, +400-550 for
  // value-add. These are starting points; the analyst override belongs
  // in the submarket metrics block.
  const implied = {
    stabilized_low: t10 ? round2(t10.value + 2.5) : null,
    stabilized_high: t10 ? round2(t10.value + 4.0) : null,
    value_add_low: t10 ? round2(t10.value + 4.0) : null,
    value_add_high: t10 ? round2(t10.value + 5.5) : null,
  };

  // Construction-loan rate proxy: SOFR + 275-400 bps typical for MF/mixed-use
  // bank construction debt; agency (Fannie DUS) and HUD 221(d)(4) take out
  // at different pricing — kept separate below.
  const cl = {
    low: sofrPt ? round2(sofrPt.value + 2.75) : null,
    high: sofrPt ? round2(sofrPt.value + 4.0) : null,
  };

  return {
    as_of: asOf,
    treasury_10y: t10,
    treasury_5y: t5,
    sofr: sofrPt,
    fed_funds: ffPt,
    mortgage_30y: mortPt,
    yield_curve_spread_bps: yieldCurveSpreadBps,
    implied_cap_rates: implied,
    implied_construction_loan_rate: cl,
    fred_configured: true,
  };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

// Format the snapshot as a text block the AI memo generators can splice into
// the market-summary block. Returns "" when no data was available so callers
// can filter(Boolean).
export function formatCapitalMarketsSummary(snap: CapitalMarketsSnapshot): string {
  if (!snap.fred_configured) return "";
  const anyData = snap.treasury_10y || snap.sofr || snap.mortgage_30y;
  if (!anyData) return "";

  const lines: string[] = [`CAPITAL MARKETS (FRED, as of ${snap.as_of || "latest"}):`];
  const fmtBps = (delta: number | null) => {
    if (delta == null) return "";
    const bps = Math.round(delta * 100);
    if (bps === 0) return " (flat 30d)";
    return ` (${bps > 0 ? "+" : ""}${bps} bps 30d)`;
  };
  const pt = (label: string, p: SeriesPoint | null) => {
    if (!p) return null;
    return `  ${label}: ${p.value.toFixed(2)}%${fmtBps(p.change_30d)}`;
  };
  const rows = [
    pt("10Y Treasury", snap.treasury_10y),
    pt("5Y Treasury", snap.treasury_5y),
    pt("SOFR", snap.sofr),
    pt("Fed Funds", snap.fed_funds),
    pt("30Y Mortgage", snap.mortgage_30y),
  ].filter(Boolean) as string[];
  lines.push(...rows);

  if (snap.yield_curve_spread_bps != null) {
    const note = snap.yield_curve_spread_bps < 0
      ? "inverted — recessionary signal"
      : snap.yield_curve_spread_bps < 50
      ? "flat — late-cycle"
      : "positively sloped";
    lines.push(`  Yield Curve (10Y − Fed Funds): ${snap.yield_curve_spread_bps} bps · ${note}`);
  }

  const ic = snap.implied_cap_rates;
  if (ic.stabilized_low != null && ic.stabilized_high != null) {
    lines.push(
      `  Indicated Cap Rate (10Y + 250-400 bps): ${ic.stabilized_low.toFixed(2)}% – ${ic.stabilized_high.toFixed(2)}% stabilized; ${ic.value_add_low?.toFixed(2)}% – ${ic.value_add_high?.toFixed(2)}% value-add`
    );
  }
  const cl = snap.implied_construction_loan_rate;
  if (cl.low != null && cl.high != null) {
    lines.push(`  Indicated Construction Debt (SOFR + 275-400 bps): ${cl.low.toFixed(2)}% – ${cl.high.toFixed(2)}%`);
  }

  lines.push(
    "  GUIDANCE: compare the deal's underwritten exit cap to the indicated stabilized band and flag spreads > 50 bps inside or outside. Compare the deal's construction loan rate to the indicated construction-debt band."
  );

  return lines.join("\n");
}
