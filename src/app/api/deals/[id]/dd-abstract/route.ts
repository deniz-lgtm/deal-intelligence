import { NextRequest, NextResponse } from "next/server";
import { dealQueries, dealNoteQueries, documentQueries, checklistQueries, underwritingQueries, businessPlanQueries, omAnalysisQueries, locationIntelligenceQueries } from "@/lib/db";
import type { OmAnalysisRow } from "@/lib/db";
import { generateDDAbstract } from "@/lib/claude";
import type { Document, ChecklistItem, Deal } from "@/lib/types";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { formatLocationIntelContext } from "@/lib/location-intel-context";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const body = await req.json().catch(() => ({}));
    const sections: string[] | undefined = body.sections;

    const deal = await dealQueries.getById(params.id);

    const [documents, checklist, uwRow, omAnalysis, locationIntelRows] = await Promise.all([
      documentQueries.getByDealId(params.id) as Promise<Document[]>,
      checklistQueries.getByDealId(params.id) as Promise<ChecklistItem[]>,
      underwritingQueries.getByDealId(params.id),
      omAnalysisQueries.getByDealId(params.id),
      locationIntelligenceQueries.getByDealId(params.id).catch(() => []),
    ]);

    // Parse raw UW data — it's stored as JSONB, may be string or object
    let rawUw: Record<string, unknown> | null = null;
    if (uwRow?.data) {
      rawUw = typeof uwRow.data === "string" ? JSON.parse(uwRow.data) : uwRow.data;
    }

    // Fetch deal notes from the new unified table
    const allDealNotes = await dealNoteQueries.getByDealId(params.id);

    // Build a comprehensive underwriting summary from the raw data, then
    // append the latest OM Analysis findings so the abstract reflects what
    // was extracted from the offering memorandum.
    const uwSummary = [
      buildUWSummary(rawUw, deal, allDealNotes),
      buildOMSummary(omAnalysis),
    ].filter(Boolean).join("\n\n");

    // Build context from memory-included deal notes
    const memoryText = await dealNoteQueries.getMemoryText(params.id);
    let bpContext = memoryText || "";
    if (deal.business_plan_id) {
      const bp = await businessPlanQueries.getById(deal.business_plan_id);
      if (bp) {
        const bpLines: string[] = [`BUSINESS PLAN — ${bp.name}:`];
        const theses = bp.investment_theses || [];
        if (theses.length > 0) bpLines.push(`Investment Thesis: ${theses.join(", ")}`);
        const markets = bp.target_markets || [];
        if (markets.length > 0) bpLines.push(`Target Markets: ${markets.join(", ")}`);
        if (bp.description?.trim()) bpLines.push(`Strategy: ${bp.description.trim()}`);
        bpContext = bpLines.join("\n") + (bpContext ? `\n\n${bpContext}` : "");
      }
    }

    // Append location intelligence to the context
    const locationContext = formatLocationIntelContext(locationIntelRows);
    const fullContext = [bpContext, locationContext].filter(Boolean).join("\n\n");

    const abstract = await generateDDAbstract(
      deal as Deal,
      documents,
      checklist,
      uwSummary,
      fullContext,
      sections
    );
    return NextResponse.json({ data: abstract });
  } catch (error) {
    console.error("POST /api/deals/[id]/dd-abstract error:", error);
    return NextResponse.json({ error: "Failed to generate DD abstract" }, { status: 500 });
  }
}

/** Format OM Analysis findings as readable text for the AI */
function buildOMSummary(om: OmAnalysisRow | null): string {
  if (!om || om.status !== "complete") return "";
  const lines: string[] = ["OM ANALYSIS FINDINGS:"];
  const fc = (v: number) => `$${Math.round(v).toLocaleString()}`;
  const pct = (v: number) => `${v.toFixed(2)}%`;

  if (om.property_name) lines.push(`  Property: ${om.property_name}`);
  if (om.address) lines.push(`  Address: ${om.address}`);
  if (om.year_built) lines.push(`  Year Built: ${om.year_built}`);
  if (om.sf) lines.push(`  Square Footage: ${om.sf.toLocaleString()}`);
  if (om.unit_count) lines.push(`  Units: ${om.unit_count}`);
  if (om.asking_price) lines.push(`  Asking Price: ${fc(om.asking_price)}`);
  if (om.noi) lines.push(`  Reported NOI: ${fc(om.noi)}`);
  if (om.cap_rate) lines.push(`  Reported Cap Rate: ${pct(om.cap_rate)}`);
  if (om.vacancy_rate) lines.push(`  Reported Vacancy: ${pct(om.vacancy_rate)}`);
  if (om.expense_ratio) lines.push(`  Expense Ratio: ${pct(om.expense_ratio)}`);
  if (om.price_per_sf) lines.push(`  $/SF: ${fc(om.price_per_sf)}`);
  if (om.price_per_unit) lines.push(`  $/Unit: ${fc(om.price_per_unit)}`);
  if (om.rent_growth) lines.push(`  Rent Growth Assumption: ${om.rent_growth}`);
  if (om.exit_cap_rate) lines.push(`  Exit Cap Assumption: ${om.exit_cap_rate}`);
  if (om.deal_score) lines.push(`  OM Score: ${om.deal_score}/10`);
  if (om.summary) lines.push(`\n  Summary: ${om.summary}`);
  if (om.red_flags && om.red_flags.length > 0) {
    lines.push(`\n  Red Flags:`);
    for (const rf of om.red_flags) {
      lines.push(`    [${rf.severity.toUpperCase()}] ${rf.category}: ${rf.description}`);
    }
  }

  return lines.length > 1 ? lines.join("\n") : "";
}

/** Compute key metrics from raw UW data and format as readable text for the AI */
function buildUWSummary(
  uw: Record<string, unknown> | null,
  deal: { property_type?: string; asking_price?: number | null },
  dealNotes?: Array<{ text: string; category: string }>
): string {
  if (!uw) return "";

  const lines: string[] = [];
  const n = (v: unknown) => typeof v === "number" ? v : 0;
  const fc = (v: number) => `$${Math.round(v).toLocaleString()}`;
  const pct = (v: number) => `${v.toFixed(2)}%`;

  const isSH = deal.property_type === "student_housing";
  const isMF = deal.property_type === "multifamily" || isSH;

  // --- Purchase & Financing ---
  const purchasePrice = n(uw.purchase_price);
  const closingCostsPct = n(uw.closing_costs_pct);
  const closingCosts = purchasePrice * (closingCostsPct / 100);
  if (purchasePrice > 0) lines.push(`Purchase Price: ${fc(purchasePrice)}`);
  if (closingCostsPct > 0) lines.push(`Closing Costs: ${pct(closingCostsPct)} (${fc(closingCosts)})`);

  // --- Unit Groups / Revenue ---
  const unitGroups = Array.isArray(uw.unit_groups) ? uw.unit_groups : [];
  if (unitGroups.length > 0) {
    const totalUnits = unitGroups.reduce((s: number, g: Record<string, unknown>) => s + n(g.unit_count), 0);
    lines.push(`\nREVENUE (${totalUnits} units, ${unitGroups.length} unit types):`);
    for (const g of unitGroups) {
      const label = g.label || "Unit";
      const count = n(g.unit_count);
      if (isMF) {
        const ipRent = n(g.current_rent_per_unit);
        const mktRent = n(g.market_rent_per_unit);
        lines.push(`  ${label}: ${count} units, in-place ${fc(ipRent)}/mo, market ${fc(mktRent)}/mo`);
      } else {
        const sf = n(g.sf_per_unit);
        const ipRent = n(g.current_rent_per_sf);
        const mktRent = n(g.market_rent_per_sf);
        lines.push(`  ${label}: ${count} units, ${sf.toLocaleString()} SF/unit, in-place $${ipRent.toFixed(2)}/SF, market $${mktRent.toFixed(2)}/SF`);
      }
      if (g.will_renovate) lines.push(`    → Renovating ${count} units at ${fc(n(g.renovation_cost_per_unit))}/unit`);
    }

    // Compute GPR
    let inPlaceGPR = 0, proFormaGPR = 0;
    for (const g of unitGroups) {
      if (isSH) {
        inPlaceGPR += n(g.unit_count) * n(g.beds_per_unit) * n(g.current_rent_per_bed) * 12;
        proFormaGPR += n(g.unit_count) * n(g.beds_per_unit) * n(g.market_rent_per_bed) * 12;
      } else if (isMF) {
        inPlaceGPR += n(g.unit_count) * n(g.current_rent_per_unit) * 12;
        proFormaGPR += n(g.unit_count) * n(g.market_rent_per_unit) * 12;
      } else {
        inPlaceGPR += n(g.unit_count) * n(g.sf_per_unit) * n(g.current_rent_per_sf);
        proFormaGPR += n(g.unit_count) * n(g.sf_per_unit) * n(g.market_rent_per_sf);
      }
    }
    lines.push(`  Gross Potential Revenue: ${fc(inPlaceGPR)} in-place → ${fc(proFormaGPR)} pro forma`);
  }

  // --- Operating Assumptions ---
  const vacancyRate = n(uw.vacancy_rate);
  const ipVacancyRate = n(uw.in_place_vacancy_rate) || vacancyRate;
  const mgmtFeePct = n(uw.management_fee_pct);
  lines.push(`\nOPERATING ASSUMPTIONS:`);
  lines.push(`  In-Place Vacancy: ${pct(ipVacancyRate)} | Pro Forma Vacancy: ${pct(vacancyRate)}`);
  lines.push(`  Management Fee: ${pct(mgmtFeePct)} of EGI`);

  const opexItems = [
    ["Taxes", n(uw.taxes_annual)],
    ["Insurance", n(uw.insurance_annual)],
    ["Repairs", n(uw.repairs_annual)],
    ["Utilities", n(uw.utilities_annual)],
    ["G&A", n(uw.ga_annual)],
    ["Marketing", n(uw.marketing_annual)],
    ["Reserves", n(uw.reserves_annual)],
    ["Other", n(uw.other_expenses_annual)],
  ].filter(([, v]) => (v as number) > 0);
  if (opexItems.length > 0) {
    for (const [label, val] of opexItems) {
      lines.push(`  ${label}: ${fc(val as number)}/yr`);
    }
  }

  // --- CapEx ---
  const capexItems = Array.isArray(uw.capex_items) ? uw.capex_items : [];
  if (capexItems.length > 0) {
    const totalCapex = capexItems.reduce((s: number, c: Record<string, unknown>) => s + n(c.quantity) * n(c.cost_per_unit), 0);
    lines.push(`\nCAPEX (${capexItems.length} items, ${fc(totalCapex)} total):`);
    for (const c of capexItems) {
      const qty = n(c.quantity);
      const cpu = n(c.cost_per_unit);
      lines.push(`  ${c.label || "Item"}: ${qty} × ${fc(cpu)} = ${fc(qty * cpu)}${c.linked_unit_group_id ? " (renovation)" : ""}`);
    }
  }

  // --- Financing ---
  if (uw.has_financing) {
    const ltc = n(uw.acq_ltc);
    const rate = n(uw.acq_interest_rate);
    const amort = n(uw.acq_amort_years);
    const io = n(uw.acq_io_years);
    lines.push(`\nFINANCING:`);
    lines.push(`  Acquisition: ${pct(ltc)} LTC, ${pct(rate)} rate, ${amort}yr amort${io > 0 ? `, ${io}yr I/O` : ""}`);

    if (uw.has_refi) {
      lines.push(`  Refi in Year ${n(uw.refi_year)}: ${pct(n(uw.refi_ltv))} LTV, ${pct(n(uw.refi_rate))} rate, ${n(uw.refi_amort_years)}yr amort`);
    }
  }

  // --- Exit ---
  const exitCapRate = n(uw.exit_cap_rate);
  const holdPeriod = n(uw.hold_period_years);
  if (exitCapRate > 0) lines.push(`\nEXIT: ${pct(exitCapRate)} exit cap, ${holdPeriod}yr hold`);

  // --- Computed Returns ---
  // Simple NOI calc for the AI
  let pfGPR = 0;
  for (const g of unitGroups) {
    if (isSH) pfGPR += n(g.unit_count) * n(g.beds_per_unit) * n(g.market_rent_per_bed) * 12;
    else if (isMF) pfGPR += n(g.unit_count) * n(g.market_rent_per_unit) * 12;
    else pfGPR += n(g.unit_count) * n(g.sf_per_unit) * n(g.market_rent_per_sf);
  }
  const egi = pfGPR * (1 - vacancyRate / 100);
  const mgmtFee = egi * (mgmtFeePct / 100);
  const fixedOpex = opexItems.reduce((s, [, v]) => s + (v as number), 0);
  const totalOpex = mgmtFee + fixedOpex;
  const noi = egi - totalOpex;
  const capexTotal = capexItems.reduce((s: number, c: Record<string, unknown>) => s + n(c.quantity) * n(c.cost_per_unit), 0);
  const totalCost = purchasePrice + closingCosts + capexTotal;
  const capRate = purchasePrice > 0 ? (noi / purchasePrice) * 100 : 0;
  const yoc = totalCost > 0 ? (noi / totalCost) * 100 : 0;

  if (noi > 0) {
    lines.push(`\nCOMPUTED RETURNS:`);
    lines.push(`  Pro Forma NOI: ${fc(noi)}`);
    lines.push(`  Cap Rate (on purchase): ${pct(capRate)}`);
    lines.push(`  Yield on Cost: ${pct(yoc)}`);
    if (exitCapRate > 0) lines.push(`  Exit Value: ${fc(noi / (exitCapRate / 100))}`);
    if (uw.has_financing && totalCost > 0) {
      const acqLoan = totalCost * (n(uw.acq_ltc) / 100);
      const equity = totalCost - acqLoan;
      lines.push(`  Total Investment: ${fc(totalCost)} (${fc(acqLoan)} debt + ${fc(equity)} equity)`);
    }
  }

  // --- Deal Notes ---
  if (dealNotes && dealNotes.length > 0) {
    lines.push(`\nDEAL NOTES:`);
    const categoryLabels: Record<string, string> = { context: "Context", thesis: "Thesis", risk: "Risk", review: "Review" };
    for (const note of dealNotes) {
      const cat = categoryLabels[note.category] || note.category;
      lines.push(`  [${cat}] ${note.text}`);
    }
  }
  // Legacy string notes
  if (uw && typeof uw.notes === "string" && (uw.notes as string).trim()) {
    lines.push(`  ${uw.notes}`);
  }

  return lines.join("\n");
}
