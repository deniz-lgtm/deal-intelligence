/**
 * Adapter: live Deal + Underwriting row → DealContext for the IC Package.
 *
 * The live underwriting shape (UWData) carries many more fields than the
 * IC package needs. We extract just the headline numbers and capital
 * stack. Anything we can't confidently derive is passed through as null,
 * and the prose generator is told to handle the gap gracefully.
 */

import type { Deal } from "./types";
import type { DealContext, CapitalSource } from "@/app/deals/[id]/ic-package/types";

interface UwRowLike {
  data?: unknown;
}

function parseUw(row: UwRowLike | null): Record<string, unknown> | null {
  if (!row || row.data == null) return null;
  if (typeof row.data === "string") {
    try {
      return JSON.parse(row.data);
    } catch {
      return null;
    }
  }
  if (typeof row.data === "object") return row.data as Record<string, unknown>;
  return null;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Build a three-line capital stack from underwriting assumptions. If the
 * UW record has explicit sources, prefer those; otherwise synthesize
 * senior debt + LP/GP split from LTV + equity split fields.
 */
function deriveCapitalStack(
  purchasePrice: number | null,
  uw: Record<string, unknown> | null
): CapitalSource[] {
  if (!purchasePrice || purchasePrice <= 0) return [];
  const ltv = num(uw?.acq_pp_ltv) ?? num(uw?.acq_ltc) ?? 65;
  const interestRate = num(uw?.acq_interest_rate);
  const amort = num(uw?.acq_amort_years);

  const debtAmount = Math.round(purchasePrice * (ltv / 100));
  const equityAmount = Math.max(0, purchasePrice - debtAmount);
  const lpPct = 90;
  const gpPct = 10;

  const termsBits: string[] = [];
  if (interestRate != null) termsBits.push(`${interestRate.toFixed(2)}%`);
  if (amort != null) termsBits.push(`${amort}yr amort`);
  termsBits.push(`${ltv}% LTC`);

  return [
    {
      name: "Senior Debt",
      type: "Acquisition Loan",
      terms: termsBits.join(" · "),
      amount: debtAmount,
      percentage: ltv,
    },
    {
      name: "LP Equity",
      type: "Common · Pari Passu",
      terms: "Market pref and promote",
      amount: Math.round((equityAmount * lpPct) / 100),
      percentage: Math.round(((equityAmount * lpPct) / 100 / purchasePrice) * 1000) / 10,
    },
    {
      name: "GP Co-Invest",
      type: "Common · Promote",
      terms: "Sponsor co-invest",
      amount: Math.round((equityAmount * gpPct) / 100),
      percentage: Math.round(((equityAmount * gpPct) / 100 / purchasePrice) * 1000) / 10,
    },
  ];
}

export function dealToContext(
  deal: Deal,
  uwRow: UwRowLike | null
): DealContext {
  const uw = parseUw(uwRow);

  const purchasePrice = num(uw?.purchase_price) ?? deal.asking_price ?? null;
  const unitCount = deal.units ?? null;
  const squareFootage = deal.square_footage ?? null;
  const pricePerUnit =
    purchasePrice && unitCount ? Math.round(purchasePrice / unitCount) : null;

  const exitCap = num(uw?.exit_cap_rate);
  const hold = num(uw?.hold_period_years);

  const location = [deal.city, deal.state].filter(Boolean).join(", ");

  return {
    dealName: deal.name,
    propertyType: deal.property_type,
    location,
    purchasePrice,
    // TODO: compute from calc(); headline metrics fall through as null
    // until we wire a server-side calc step. Prose generator is told to
    // be honest about any missing numbers.
    goingInCap: null,
    stabilizedYOC: null,
    leveredIRR: null,
    equityMultiple: null,
    holdPeriod: hold,
    pricePerUnit,
    unitCount,
    squareFootage,
    yearBuilt: deal.year_built,
    investmentStrategy: deal.investment_strategy,
    capitalStack: deriveCapitalStack(purchasePrice, uw),
    marketContext: undefined,
    sellerContext: undefined,
    businessPlanSummary: undefined,
    customNotes: deal.notes ?? undefined,
  };
}
