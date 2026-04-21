// Recompute-feasibility helper — snapshots the deal's key feasibility
// metrics (NOI, cap rate, max bid) at the moment a new document version
// is uploaded. Comparing the snapshot against the parent version's
// snapshot produces a "Feasibility impact since last version" delta
// that the Documents page surfaces inline.
//
// This is a READ-ONLY helper — no mutations to underwriting data. The
// point is to let the analyst see, without leaving the Documents page,
// whether the new version materially moved the deal.

import { underwritingQueries, dealQueries } from "@/lib/db";
import { calc, DEFAULT, type UWData } from "@/lib/underwriting-calc";
import { solveMaxBid } from "@/lib/max-bid";
import type { FeasibilitySnapshot, FeasibilityDelta } from "@/lib/claude";

// Document categories whose updates are likely to move the feasibility
// picture. Other categories (legal docs, insurance, surveys) can still
// matter but the snapshot diff is noisy, so we skip them.
const FEASIBILITY_CATEGORIES = new Set([
  "rent_roll",
  "financial",
  "t12",
  "appraisal",
  "operating_statement",
]);

export function isFeasibilityCategory(category: string | null | undefined): boolean {
  if (!category) return false;
  return FEASIBILITY_CATEGORIES.has(category.toLowerCase());
}

/**
 * Capture a snapshot of the deal's current feasibility metrics. Returns
 * null if underwriting hasn't been set up yet — no point snapshotting
 * defaults, and we don't want to pollute the diff payload.
 */
export async function captureFeasibilitySnapshot(
  dealId: string
): Promise<FeasibilitySnapshot | null> {
  try {
    const uwRow = await underwritingQueries.getByDealId(dealId);
    if (!uwRow?.data) return null;
    const uwData = (typeof uwRow.data === "string" ? JSON.parse(uwRow.data) : uwRow.data) as UWData;

    // Treat a deal as "not yet underwritten" if it still has the all-zero
    // defaults — snapshot noise otherwise.
    const hasAnyInput =
      (uwData.purchase_price || 0) > 0 ||
      (uwData.land_cost || 0) > 0 ||
      (uwData.unit_groups || []).length > 0;
    if (!hasAnyInput) return null;

    const deal = await dealQueries.getById(dealId);
    const propertyType = (deal?.property_type as string | undefined) || "multifamily";
    const mode: "commercial" | "multifamily" | "student_housing" =
      propertyType === "student_housing" ? "student_housing"
      : propertyType === "office" || propertyType === "retail" || propertyType === "industrial" || propertyType === "mixed_use" ? "commercial"
      : "multifamily";

    // Fill any missing fields from DEFAULT so calc() doesn't trip on
    // legacy rows that pre-date newer UW fields.
    const safeData: UWData = { ...DEFAULT, ...uwData };

    const m = calc(safeData, mode);

    // Max bid at a conventional hurdle set. 15% IRR + 1.8x EM is a
    // reasonable mid-market acquisitions target; analysts can still
    // punch their own hurdles in the Max-Bid modal — this is just the
    // snapshot number for cross-version comparison.
    const maxBidResult = solveMaxBid(
      safeData,
      { target_irr_pct: 15, target_equity_multiple: 1.8 },
      mode
    );

    return {
      noi: Math.round(m.proformaNOI),
      cap_rate_pct: Number(m.proformaCapRate.toFixed(3)),
      max_bid_15irr: Math.round(maxBidResult.max_bid),
      hold_years: safeData.hold_period_years || 5,
      computed_at: new Date().toISOString(),
    };
  } catch (err) {
    // Snapshot is best-effort — never break the upload path on snapshot
    // failures.
    console.error("captureFeasibilitySnapshot failed:", err);
    return null;
  }
}

export function computeFeasibilityDelta(
  previous: FeasibilitySnapshot,
  current: FeasibilitySnapshot
): FeasibilityDelta {
  const noiDelta = current.noi - previous.noi;
  const noiDeltaPct = previous.noi > 0 ? (noiDelta / previous.noi) * 100 : 0;
  const capRateDeltaBps = (current.cap_rate_pct - previous.cap_rate_pct) * 100; // 1% = 100 bps
  const maxBidDelta = current.max_bid_15irr - previous.max_bid_15irr;
  return {
    noi_delta: Math.round(noiDelta),
    noi_delta_pct: Number(noiDeltaPct.toFixed(2)),
    cap_rate_delta_bps: Number(capRateDeltaBps.toFixed(1)),
    max_bid_delta: Math.round(maxBidDelta),
  };
}
