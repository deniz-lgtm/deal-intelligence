import { NextRequest, NextResponse } from "next/server";
import {
  dealQueries,
  dealNoteQueries,
  underwritingQueries,
  omAnalysisQueries,
  checklistQueries,
  businessPlanQueries,
  locationIntelligenceQueries,
  type OmAnalysisRow,
} from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import Anthropic from "@anthropic-ai/sdk";
import type { ChecklistItem, DealNote, BusinessPlan } from "@/lib/types";
import { CONCISE_STYLE } from "@/lib/ai-style";
import { formatLocationIntelContext } from "@/lib/location-intel-context";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

const MODEL = "claude-sonnet-4-6";
let _client: Anthropic | null = null;
function getClient() {
  if (!_client) _client = new Anthropic();
  return _client;
}

/**
 * POST /api/deals/:id/deal-score
 * Generate a deal score for a specific stage.
 *
 * Body: { stage: "underwriting" | "final" }
 *
 * - "underwriting": Post-underwriting score. Uses UW metrics + deal notes to
 *   re-evaluate. Notes addressing OM red flags can improve the score.
 * - "final": Pre-investment-package score. Comprehensive final assessment
 *   using all available data (OM, UW, checklist, notes).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const body = await req.json();
    const { stage } = body as { stage: "underwriting" | "final" };

    if (!["underwriting", "final"].includes(stage)) {
      return NextResponse.json({ error: "Invalid stage" }, { status: 400 });
    }

    const [deal, omAnalysis, uwRow, notes, memoryText, locationIntelRows] =
      await Promise.all([
        dealQueries.getById(params.id),
        omAnalysisQueries.getByDealId(params.id),
        underwritingQueries.getByDealId(params.id),
        dealNoteQueries.getByDealId(params.id),
        dealNoteQueries.getMemoryText(params.id),
        locationIntelligenceQueries.getByDealId(params.id).catch(() => []),
      ]);

    // Checklist may not exist yet — fetch separately to avoid breaking the whole request
    let checklist: ChecklistItem[] = [];
    try {
      checklist = (await checklistQueries.getByDealId(params.id)) || [];
    } catch (err) {
      // Non-fatal: checklist table/row may not exist yet
      console.warn("Could not fetch checklist for deal-score:", (err as Error).message);
    }

    // Parse underwriting data
    const uw = uwRow?.data
      ? typeof uwRow.data === "string"
        ? JSON.parse(uwRow.data)
        : uwRow.data
      : null;

    // Fetch business plan if linked
    const businessPlan = deal.business_plan_id
      ? await businessPlanQueries.getById(deal.business_plan_id)
      : null;

    // Build the prompt based on stage
    const locationContext = formatLocationIntelContext(locationIntelRows);
    const prompt = buildScorePrompt(
      stage,
      deal,
      omAnalysis,
      uw,
      checklist,
      notes,
      memoryText,
      businessPlan as unknown as BusinessPlan | null,
      locationContext
    );

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25_000);
    let raw = "{}";
    try {
      const response = await getClient().messages.create(
        { model: MODEL, max_tokens: 1024, messages: [{ role: "user", content: prompt }] },
        { signal: controller.signal }
      );
      raw = response.content[0].type === "text" ? response.content[0].text : "{}";
    } finally {
      clearTimeout(timeoutId);
    }

    // Parse JSON from response — be lenient
    let parsed: { deal_score: number; score_reasoning: string };
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      parsed = jsonMatch
        ? JSON.parse(jsonMatch[0])
        : { deal_score: 5, score_reasoning: "Unable to score." };
    } catch {
      console.error("Failed to parse deal score response:", raw);
      parsed = { deal_score: 5, score_reasoning: "Unable to parse AI response." };
    }

    const score = Math.max(1, Math.min(10, Math.round(parsed.deal_score ?? 5)));
    const reasoning = parsed.score_reasoning ?? "";

    // Store on the deal
    const updateField =
      stage === "underwriting"
        ? { uw_score: score, uw_score_reasoning: reasoning }
        : { final_score: score, final_score_reasoning: reasoning };

    const updated = await dealQueries.update(params.id, updateField);

    return NextResponse.json({
      data: {
        stage,
        score,
        reasoning,
        om_score: omAnalysis?.deal_score ?? null,
        om_reasoning: omAnalysis?.score_reasoning ?? null,
        uw_score: updated.uw_score ?? null,
        uw_score_reasoning: updated.uw_score_reasoning ?? null,
        final_score: updated.final_score ?? null,
        final_score_reasoning: updated.final_score_reasoning ?? null,
      },
    });
  } catch (error) {
    console.error("POST /api/deals/[id]/deal-score error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to calculate deal score: ${message}` },
      { status: 500 }
    );
  }
}

/**
 * GET /api/deals/:id/deal-score
 * Fetch all stored deal scores for this deal.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const [deal, omAnalysis] = await Promise.all([
      dealQueries.getById(params.id),
      omAnalysisQueries.getByDealId(params.id),
    ]);

    return NextResponse.json({
      data: {
        om_score: omAnalysis?.deal_score ?? null,
        om_reasoning: omAnalysis?.score_reasoning ?? null,
        uw_score: deal.uw_score ?? null,
        uw_score_reasoning: deal.uw_score_reasoning ?? null,
        final_score: deal.final_score ?? null,
        final_score_reasoning: deal.final_score_reasoning ?? null,
      },
    });
  } catch (error) {
    console.error("GET /api/deals/[id]/deal-score error:", error);
    return NextResponse.json(
      { error: "Failed to fetch deal scores" },
      { status: 500 }
    );
  }
}

function buildScorePrompt(
  stage: "underwriting" | "final",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deal: any, // Deal + dynamically added score columns not in the static type
  omAnalysis: OmAnalysisRow | null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  uw: any, // UnderwritingData shape has evolved beyond the static type
  checklist: ChecklistItem[],
  notes: DealNote[],
  memoryText: string,
  businessPlan: BusinessPlan | null,
  locationContext: string = ""
): string {
  const fc = (n: number) =>
    n ? "$" + Math.round(n).toLocaleString("en-US") : "—";
  const fp = (n: number) => (n ? `${n.toFixed(2)}%` : "—");

  // ── Business plan context
  const bpBlock = businessPlan
    ? `\nINVESTOR'S BUSINESS PLAN:\n- Name: ${businessPlan.name}\n- Description: ${businessPlan.description}\n- Investment Theses: ${JSON.stringify(businessPlan.investment_theses || [])}\n- Target Markets: ${JSON.stringify(businessPlan.target_markets || [])}\n- Property Types: ${JSON.stringify(businessPlan.property_types || [])}\n- Hold Period: ${businessPlan.hold_period_min ?? "?"}-${businessPlan.hold_period_max ?? "?"} years\n- Target IRR: ${businessPlan.target_irr_min ?? "?"}%-${businessPlan.target_irr_max ?? "?"}%\n- Target EM: ${businessPlan.target_equity_multiple_min ?? "?"}x-${businessPlan.target_equity_multiple_max ?? "?"}x\n`
    : "";

  // ── OM Analysis context
  const omBlock = omAnalysis
    ? `\nOM ANALYSIS SCORE: ${omAnalysis.deal_score ?? "N/A"}/10\nOM REASONING: ${omAnalysis.score_reasoning ?? "N/A"}\nOM RED FLAGS:\n${(omAnalysis.red_flags || []).map((f) => `  - [${f.severity?.toUpperCase()}] ${f.category}: ${f.description}`).join("\n") || "  None"}\nOM RECOMMENDATIONS:\n${(omAnalysis.recommendations || []).map((r) => `  - ${r}`).join("\n") || "  None"}\n`
    : "\nOM ANALYSIS: Not yet performed\n";

  // ── Notes context (key for the UW score — notes address OM issues)
  const notesBlock =
    notes.length > 0
      ? `\nDEAL NOTES (added by the analyst during the process):\n${notes.map((n) => `  [${n.category.toUpperCase()}] ${n.text}`).join("\n")}\n`
      : "";

  // ── Underwriting metrics
  let uwBlock = "\nUNDERWRITING: Not yet completed\n";
  if (uw) {
    const groups = uw.unit_groups || [];
    const capexItems = uw.capex_items || [];
    const capexTotal = capexItems.reduce(
      (s: number, c: any) => s + (c.quantity || 0) * (c.cost_per_unit || 0),
      0
    );

    // Ground-up vs. acquisition cost basis. For development_mode deals
    // there's no purchase price — the cost basis is land + hard + soft +
    // parking + capitalized interest + closing + demolition. Mirrors
    // the UW page's calc (src/app/deals/[id]/underwriting/page.tsx
    // around the totalCost block) so the score's view of the deal
    // matches what the analyst sees on the page.
    const isGroundUp = !!uw.development_mode;
    const purchasePrice = uw.purchase_price || 0;

    let totalHardCosts = 0;
    let softCostsTotal = 0;
    let landCost = 0;
    let parkingCost = 0;
    let demolitionCosts = 0;
    let closingCosts = 0;
    let totalCost = 0;

    if (isGroundUp) {
      // Itemized dev budget wins over the legacy hard_cost_per_sf shortcut.
      const devItems = uw.dev_budget_items || [];
      const hasItemized = devItems.length > 0 && devItems.some((i: any) =>
        (i.amount || 0) > 0 || (i.is_pct && (i.pct_value || 0) > 0)
      );
      if (hasItemized) {
        totalHardCosts = devItems
          .filter((i: any) => i.category === "hard")
          .reduce((s: number, i: any) => s + (i.amount || 0), 0);
        softCostsTotal = devItems
          .filter((i: any) => i.category === "soft")
          .reduce((s: number, i: any) => s + (i.amount || 0), 0);
      } else {
        totalHardCosts = (uw.hard_cost_per_sf || 0) * (uw.max_gsf || 0);
        softCostsTotal = totalHardCosts * ((uw.soft_cost_pct || 0) / 100);
      }
      const parking = uw.parking?.entries || [];
      parkingCost = parking.reduce(
        (s: number, e: any) => s + (e.spaces || 0) * (e.cost_per_space || 0),
        0
      );
      landCost = uw.land_cost || 0;
      demolitionCosts = (uw.redevelopment?.demolition_cost || 0);
      closingCosts = landCost * ((uw.closing_costs_pct || 0) / 100);
      totalCost = landCost + totalHardCosts + softCostsTotal + parkingCost + closingCosts + demolitionCosts;
    } else {
      closingCosts = purchasePrice * ((uw.closing_costs_pct || 0) / 100);
      totalCost = purchasePrice + closingCosts + capexTotal;
    }
    const costBasis = isGroundUp ? totalCost : purchasePrice;

    const totalUnits = groups.reduce(
      (s: number, g: any) => s + (g.unit_count || 0),
      0
    );
    const proformaGPR = groups.reduce((s: number, g: any) => {
      const units = g.unit_count || 0;
      if (g.market_rent_per_unit) {
        // Multifamily: monthly $/unit → annual
        return s + g.market_rent_per_unit * units * 12;
      } else if (g.market_rent_per_bed) {
        // Student housing: monthly $/bed × beds → annual
        return s + g.market_rent_per_bed * (g.beds_per_unit || 1) * units * 12;
      } else if (g.market_rent_per_sf && g.sf_per_unit) {
        // Commercial: annual $/SF × SF/unit × units (already annual)
        return s + g.market_rent_per_sf * g.sf_per_unit * units;
      }
      return s;
    }, 0);
    const vacancyRate = uw.vacancy_rate || 5;
    const proformaEGI = proformaGPR * (1 - vacancyRate / 100);
    const mgmtFee = proformaEGI * ((uw.management_fee_pct || 0) / 100);
    // Sum all fixed opex categories
    const fixedOpEx = (uw.taxes_annual || 0) + (uw.insurance_annual || 0) +
      (uw.repairs_annual || 0) + (uw.utilities_annual || 0) +
      (uw.ga_annual || 0) + (uw.marketing_annual || 0) +
      (uw.reserves_annual || 0) + (uw.other_expenses_annual || 0) +
      // Custom rows (Contracts, Staff, etc.) are part of the OpEx stack
      // on the UW page — include them so the score's NOI matches.
      (uw.custom_opex || []).reduce((s: number, r: any) => s + (r.pf_annual || 0), 0);
    const proformaNOI = proformaEGI - mgmtFee - fixedOpEx;
    // Cap rate: applied against the chosen basis (purchase price for
    // acquisitions, total cost basis for ground-up).
    const proformaCapRate =
      costBasis > 0 ? (proformaNOI / costBasis) * 100 : 0;
    const yoc = totalCost > 0 ? (proformaNOI / totalCost) * 100 : 0;

    // Financing metrics — handle ground-up LTC vs. acquisition LTV split.
    let dscr = 0, cashOnCash = 0, equityMultiple = 0, loanAmount = 0, equity = 0;
    if (uw.has_financing && totalCost > 0) {
      if (isGroundUp) {
        // Ground-up: single LTC against full development cost.
        const ltc = uw.acq_ltc ?? uw.acq_pp_ltv ?? 65;
        loanAmount = totalCost * (ltc / 100);
      } else {
        const ppLtv = uw.acq_pp_ltv ?? uw.acq_ltc ?? 65;
        const capexLtv = uw.acq_capex_ltv ?? uw.acq_ltc ?? 100;
        loanAmount = (purchasePrice + closingCosts) * (ppLtv / 100) + capexTotal * (capexLtv / 100);
      }
      equity = totalCost - loanAmount;
      const rate = (uw.acq_interest_rate || 7) / 100;
      const amort = uw.acq_amort_years || 0;
      let annualDebt = 0;
      if (amort > 0) {
        const r = rate / 12;
        const n = amort * 12;
        annualDebt = loanAmount * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1) * 12;
      } else {
        annualDebt = loanAmount * rate;
      }
      dscr = annualDebt > 0 ? proformaNOI / annualDebt : 0;
      const yr1Debt = uw.acq_io_years > 0 ? loanAmount * rate : annualDebt;
      cashOnCash = equity > 0 ? ((proformaNOI - yr1Debt) / equity) * 100 : 0;
      // Equity multiple: year-by-year cash flows + exit proceeds
      const holdYears = uw.hold_period_years || 5;
      const exitCap = uw.exit_cap_rate || 0;
      const rentGrowth = (uw.rent_growth_pct || 3) / 100;
      if (exitCap > 0 && equity > 0) {
        // Terminal NOI grows at rent growth over hold period
        const terminalNOI = proformaNOI * Math.pow(1 + rentGrowth, holdYears);
        const exitValue = terminalNOI / (exitCap / 100);
        // Remaining loan balance at exit
        const remainingBal = amort > 0
          ? loanAmount * (Math.pow(1 + rate / 12, amort * 12) - Math.pow(1 + rate / 12, holdYears * 12))
                         / (Math.pow(1 + rate / 12, amort * 12) - 1)
          : loanAmount; // IO-only: no paydown
        const exitEquity = exitValue - Math.max(0, remainingBal);
        // Sum year-by-year cash flows with rent growth
        let totalCF = 0;
        for (let yr = 1; yr <= holdYears; yr++) {
          const yrNOI = proformaNOI * Math.pow(1 + rentGrowth, yr);
          const ds = yr <= (uw.acq_io_years || 0) ? loanAmount * rate : annualDebt;
          totalCF += yrNOI - ds;
        }
        equityMultiple = (totalCF + exitEquity) / equity;
      }
    }

    const basisLabel = isGroundUp ? "Total Cost Basis (ground-up)" : "Purchase Price";
    const basisDetail = isGroundUp
      ? `Land ${fc(landCost)} + Hard ${fc(totalHardCosts)} + Soft ${fc(softCostsTotal)}${parkingCost ? ` + Parking ${fc(parkingCost)}` : ""}${closingCosts ? ` + Closing ${fc(closingCosts)}` : ""}${demolitionCosts ? ` + Demo ${fc(demolitionCosts)}` : ""}`
      : `incl. ${fc(capexTotal)} CapEx + ${fc(closingCosts)} closing`;

    uwBlock = `\nUNDERWRITING METRICS (COMPUTED FROM MODEL):
- Deal Type: ${isGroundUp ? "Ground-Up Development" : "Acquisition"}
- ${basisLabel}: ${fc(costBasis)}
- Total Cost Basis: ${fc(totalCost)} (${basisDetail})
- Total Units: ${totalUnits}
- Proforma GPR: ${fc(proformaGPR)}
- Vacancy Rate: ${vacancyRate}%
- Total OpEx: ${fc(mgmtFee + fixedOpEx)}
- Proforma NOI: ${fc(proformaNOI)}
- Proforma Cap Rate: ${fp(proformaCapRate)}
- Yield on Cost: ${fp(yoc)}
- ${isGroundUp ? `Hard Costs: ${fc(totalHardCosts)} ($${(uw.hard_cost_per_sf || 0).toFixed(0)}/GSF on ${(uw.max_gsf || 0).toLocaleString()} GSF)` : `CapEx Budget: ${fc(capexTotal)} across ${capexItems.length} items`}
- Hold Period: ${uw.hold_period_years || "?"} years
- Exit Cap Rate: ${uw.exit_cap_rate || "?"}%
${uw.has_financing ? `- DSCR: ${dscr > 0 ? dscr.toFixed(2) + "x" : "N/A"}
- Cash-on-Cash Return: ${cashOnCash !== 0 ? cashOnCash.toFixed(2) + "%" : "N/A"}
- Equity Multiple: ${equityMultiple > 0 ? equityMultiple.toFixed(2) + "x" : "N/A"}
- Loan Amount: ${fc(loanAmount)} ${isGroundUp ? `(${(uw.acq_ltc ?? uw.acq_pp_ltv ?? 65)}% LTC)` : ""}
- Equity Required: ${fc(equity)}` : "- No financing assumed (all-cash)"}
`;
  }

  // ── Checklist context
  const checklistBlock =
    checklist && checklist.length > 0
      ? `\nDILIGENCE CHECKLIST:\n${checklist
          .map(
            (c) =>
              `  [${(c.status || "pending").toUpperCase()}] ${c.category}: ${c.item}${c.notes ? ` — ${c.notes}` : ""}`
          )
          .join("\n")}\n`
      : "";

  // ── Location intelligence context
  const locationBlock = locationContext ? `\n${locationContext}\n` : "";

  if (stage === "underwriting") {
    return `${CONCISE_STYLE}

You are re-scoring a commercial real estate deal AFTER underwriting has been completed. The deal was initially scored during OM analysis. Now you have ACTUAL underwriting numbers — use them.

IMPORTANT SCORING RULES:
- The underwriting metrics above are COMPUTED from the actual model. Trust them.
- Strong return metrics (high YoC, strong DSCR, good Cash-on-Cash, high Equity Multiple) should INCREASE the score vs OM.
- A deal showing 10%+ YoC, 1.5x+ DSCR, 15%+ CoC, and 2x+ EM is a strong deal — score it 7-9.
- The OM score was based on INCOMPLETE information (just the OM document). The UW score has real numbers — it should reflect reality, not inherit OM uncertainty.
- Analyst deal notes may address OM red flags. If concerns are mitigated, score UP.
- Only score DOWN from OM if the UW numbers actually reveal problems (thin DSCR, negative leverage, unrealistic assumptions).
${bpBlock}
DEAL: ${deal.name}
Property: ${deal.property_type} | ${deal.address}, ${deal.city}, ${deal.state} ${deal.zip}
${omBlock}${uwBlock}${notesBlock}${checklistBlock}${locationBlock}
Score this deal based on the ACTUAL underwriting numbers. Consider:
1. Are the return metrics strong? (YoC > 6% good, > 8% strong, > 10% excellent)
2. Is the debt coverage adequate? (DSCR > 1.25x good, > 1.5x strong)
3. Is the equity multiple compelling? (> 1.8x good, > 2.0x strong, > 2.5x excellent)
4. Have analyst notes addressed OM concerns?
5. Does the deal match the business plan targets?
6. Do the location demographics support the investment thesis? (population growth, income levels, employment, housing demand)

Return ONLY a JSON object:
{
  "deal_score": 7,
  "score_reasoning": "2-4 sentences — reference SPECIFIC numbers from the UW metrics. State the YoC, DSCR, EM, CoC. Explain why this is better or worse than the OM score."
}

Score guide:
1-3: Pass — UW reveals fatal flaws (negative NOI, sub-1.0 DSCR, negative leverage)
4-5: Borderline — thin returns, aggressive assumptions, or unresolved risks
6-7: Solid — numbers work, adequate returns, manageable risks
8-9: Strong — compelling returns that exceed targets, well-structured deal
10: Exceptional — rarely given`;
  }

  // stage === "final"
  return `${CONCISE_STYLE}

You are providing a FINAL deal score for a commercial real estate deal that is about to go into the investment package / IC presentation stage. This is the comprehensive assessment using ALL available data — OM analysis, underwriting, deal notes, and diligence checklist.

This score represents: "Should we proceed to put together the investment package and present this deal?"
${bpBlock}
DEAL: ${deal.name}
Property: ${deal.property_type} | ${deal.address}, ${deal.city}, ${deal.state} ${deal.zip}
${omBlock}${uwBlock}${notesBlock}${checklistBlock}${locationBlock}
SCORE PROGRESSION:
- OM Analysis Score: ${omAnalysis?.deal_score ?? "N/A"}/10
- Post-Underwriting Score: ${deal.uw_score ?? "N/A"}/10

Provide a comprehensive final score considering:
1. Full underwriting validation — do the numbers work?
2. All red flags and whether they've been adequately addressed
3. Diligence checklist status — any open issues or blockers?
4. Overall risk/return profile vs. business plan targets
5. Location and market fundamentals — do demographics, employment, and housing demand support the thesis?
6. Is this deal ready for IC / investment package presentation?

Return ONLY a JSON object:
{
  "deal_score": 7,
  "score_reasoning": "3-5 sentences — comprehensive final assessment. Reference the score progression (OM → UW → Final), what was confirmed, what changed, and whether the deal is ready for presentation. Be specific about any remaining concerns."
}

Score guide (final assessment):
1-3: Do not proceed — fundamental issues remain unresolved
4-5: Conditional — proceed only if specific issues are addressed first
6-7: Proceed — solid deal with manageable risks, ready for IC
8-9: Strong recommend — compelling deal, prioritize presentation
10: Exceptional — extremely rare, all metrics exceed targets`;
}
