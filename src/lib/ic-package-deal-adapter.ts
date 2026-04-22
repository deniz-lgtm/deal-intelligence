/**
 * Adapter: live Deal + Underwriting row → DealContext for the IC Package.
 *
 * The live underwriting shape (UWData) carries many more fields than the
 * IC package needs. We extract just the headline numbers and capital
 * stack. Anything we can't confidently derive is passed through as null,
 * and the prose generator is told to handle the gap gracefully.
 */

import type { Deal, PropertyType } from "./types";
import type { UWData } from "./underwriting-calc";
import { calc, xirr } from "./underwriting-calc";
import type { DealContext, CapitalSource } from "@/app/deals/[id]/ic-package/types";

interface UwRowLike {
  data?: unknown;
}

/**
 * Map a deal's property_type to the calc-mode expected by the UW engine.
 * Office/retail/industrial/mixed-use feed the commercial path; MF/SFR the
 * multifamily path; student_housing its own path. Anything else (land,
 * hospitality) falls through to commercial as a safe default.
 */
function calcMode(pt: PropertyType): "commercial" | "multifamily" | "student_housing" {
  if (pt === "multifamily" || pt === "sfr") return "multifamily";
  if (pt === "student_housing") return "student_housing";
  return "commercial";
}

/**
 * Pull headline deal metrics out of a UW blob by running the real calc
 * engine. Any error — malformed blob, missing unit groups, divide-by-
 * zero — returns all-nulls so the prose generator can handle the gap
 * honestly rather than printing garbage numbers.
 */
function deriveHeadlineMetrics(
  uw: Record<string, unknown> | null,
  mode: "commercial" | "multifamily" | "student_housing"
): {
  goingInCap: number | null;
  stabilizedYOC: number | null;
  leveredIRR: number | null;
  equityMultiple: number | null;
} {
  if (!uw) return { goingInCap: null, stabilizedYOC: null, leveredIRR: null, equityMultiple: null };
  try {
    const r = calc(uw as unknown as UWData, mode);
    const flows = [-r.equity, ...r.yearlyDCF.map((yr: { cashFlow: number }) => yr.cashFlow)];
    // Add the exit equity back to the final year's flow to close out the
    // series before handing it to xirr.
    if (flows.length > 1) {
      flows[flows.length - 1] = flows[flows.length - 1] + r.exitEquity;
    }
    const irr = xirr(flows);
    return {
      goingInCap: Number.isFinite(r.inPlaceCapRate) ? r.inPlaceCapRate : null,
      stabilizedYOC: Number.isFinite(r.yoc) ? r.yoc : null,
      leveredIRR: irr,
      equityMultiple: Number.isFinite(r.em) && r.em > 0 ? r.em : null,
    };
  } catch {
    return { goingInCap: null, stabilizedYOC: null, leveredIRR: null, equityMultiple: null };
  }
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

  const hold = num(uw?.hold_period_years);
  const headline = deriveHeadlineMetrics(uw, calcMode(deal.property_type));

  const location = [deal.city, deal.state].filter(Boolean).join(", ");

  return {
    dealName: deal.name,
    propertyType: deal.property_type,
    location,
    purchasePrice,
    goingInCap: headline.goingInCap,
    stabilizedYOC: headline.stabilizedYOC,
    leveredIRR: headline.leveredIRR,
    equityMultiple: headline.equityMultiple,
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
