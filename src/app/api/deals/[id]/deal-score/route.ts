import { NextRequest, NextResponse } from "next/server";
import {
  getPool,
  dealQueries,
  dealNoteQueries,
  underwritingQueries,
  omAnalysisQueries,
  checklistQueries,
  businessPlanQueries,
  type OmAnalysisRow,
} from "@/lib/db";
import Anthropic from "@anthropic-ai/sdk";
import type { ChecklistItem, DealNote, BusinessPlan } from "@/lib/types";

const MODEL = "claude-sonnet-4-5";
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
    const body = await req.json();
    const { stage } = body as { stage: "underwriting" | "final" };

    if (!["underwriting", "final"].includes(stage)) {
      return NextResponse.json({ error: "Invalid stage" }, { status: 400 });
    }

    const [deal, omAnalysis, uwRow, notes, memoryText] =
      await Promise.all([
        dealQueries.getById(params.id),
        omAnalysisQueries.getByDealId(params.id),
        underwritingQueries.getByDealId(params.id),
        dealNoteQueries.getByDealId(params.id),
        dealNoteQueries.getMemoryText(params.id),
      ]);

    if (!deal) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }

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
    const prompt = buildScorePrompt(
      stage,
      deal,
      omAnalysis,
      uw,
      checklist,
      notes,
      memoryText,
      businessPlan
    );

    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });

    const raw =
      response.content[0].type === "text" ? response.content[0].text : "{}";

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

    // Ensure columns exist (self-healing migration)
    const pool = getPool();
    await pool.query("ALTER TABLE deals ADD COLUMN IF NOT EXISTS uw_score INTEGER").catch((e: Error) => console.warn("ALTER uw_score:", e.message));
    await pool.query("ALTER TABLE deals ADD COLUMN IF NOT EXISTS uw_score_reasoning TEXT").catch((e: Error) => console.warn("ALTER uw_score_reasoning:", e.message));
    await pool.query("ALTER TABLE deals ADD COLUMN IF NOT EXISTS final_score INTEGER").catch((e: Error) => console.warn("ALTER final_score:", e.message));
    await pool.query("ALTER TABLE deals ADD COLUMN IF NOT EXISTS final_score_reasoning TEXT").catch((e: Error) => console.warn("ALTER final_score_reasoning:", e.message));

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
    const [deal, omAnalysis] = await Promise.all([
      dealQueries.getById(params.id),
      omAnalysisQueries.getByDealId(params.id),
    ]);

    if (!deal) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }

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
  businessPlan: BusinessPlan | null
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
    const purchasePrice = uw.purchase_price || 0;
    const closingCosts = purchasePrice * ((uw.closing_costs_pct || 0) / 100);
    const totalCost = purchasePrice + closingCosts + capexTotal;

    const totalUnits = groups.reduce(
      (s: number, g: any) => s + (g.unit_count || 0),
      0
    );
    const proformaGPR = groups.reduce((s: number, g: any) => {
      const rent = g.market_rent_per_unit || g.market_rent_per_bed * (g.beds_per_unit || 1) || 0;
      return s + rent * (g.unit_count || 0) * 12;
    }, 0);
    const vacancyRate = uw.vacancy_rate || 5;
    const proformaEGI = proformaGPR * (1 - vacancyRate / 100);
    const mgmtFee = proformaEGI * ((uw.management_fee_pct || 0) / 100);
    // Sum all fixed opex categories
    const fixedOpEx = (uw.taxes_annual || 0) + (uw.insurance_annual || 0) +
      (uw.repairs_annual || 0) + (uw.utilities_annual || 0) +
      (uw.ga_annual || 0) + (uw.marketing_annual || 0) +
      (uw.reserves_annual || 0) + (uw.other_expenses_annual || 0);
    const proformaNOI = proformaEGI - mgmtFee - fixedOpEx;
    const proformaCapRate =
      purchasePrice > 0 ? (proformaNOI / purchasePrice) * 100 : 0;
    const yoc = totalCost > 0 ? (proformaNOI / totalCost) * 100 : 0;

    // Financing metrics
    let dscr = 0, cashOnCash = 0, equityMultiple = 0, loanAmount = 0, equity = 0;
    if (uw.has_financing && totalCost > 0) {
      const ppLtv = uw.acq_pp_ltv ?? uw.acq_ltc ?? 65;
      const capexLtv = uw.acq_capex_ltv ?? uw.acq_ltc ?? 100;
      loanAmount = (purchasePrice + closingCosts) * (ppLtv / 100) + capexTotal * (capexLtv / 100);
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
      // Simplified equity multiple
      const holdYears = uw.hold_period_years || 5;
      const exitCap = uw.exit_cap_rate || 0;
      if (exitCap > 0 && equity > 0) {
        const exitValue = proformaNOI / (exitCap / 100);
        const exitEquity = exitValue - loanAmount;
        const totalCF = (proformaNOI - yr1Debt) * holdYears + exitEquity;
        equityMultiple = totalCF / equity;
      }
    }

    uwBlock = `\nUNDERWRITING METRICS (COMPUTED FROM MODEL):
- Purchase Price: ${fc(purchasePrice)}
- Total Cost Basis: ${fc(totalCost)} (incl. ${fc(capexTotal)} CapEx + ${fc(closingCosts)} closing)
- Total Units: ${totalUnits}
- Proforma GPR: ${fc(proformaGPR)}
- Vacancy Rate: ${vacancyRate}%
- Total OpEx: ${fc(mgmtFee + fixedOpEx)}
- Proforma NOI: ${fc(proformaNOI)}
- Proforma Cap Rate: ${fp(proformaCapRate)}
- Yield on Cost: ${fp(yoc)}
- CapEx Budget: ${fc(capexTotal)} across ${capexItems.length} items
- Hold Period: ${uw.hold_period_years || "?"} years
- Exit Cap Rate: ${uw.exit_cap_rate || "?"}%
${uw.has_financing ? `- DSCR: ${dscr > 0 ? dscr.toFixed(2) + "x" : "N/A"}
- Cash-on-Cash Return: ${cashOnCash !== 0 ? cashOnCash.toFixed(2) + "%" : "N/A"}
- Equity Multiple: ${equityMultiple > 0 ? equityMultiple.toFixed(2) + "x" : "N/A"}
- Loan Amount: ${fc(loanAmount)}
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

  if (stage === "underwriting") {
    return `You are re-scoring a commercial real estate deal AFTER underwriting has been completed. The deal was initially scored during OM analysis. Now you have ACTUAL underwriting numbers — use them.

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
${omBlock}${uwBlock}${notesBlock}${checklistBlock}
Score this deal based on the ACTUAL underwriting numbers. Consider:
1. Are the return metrics strong? (YoC > 6% good, > 8% strong, > 10% excellent)
2. Is the debt coverage adequate? (DSCR > 1.25x good, > 1.5x strong)
3. Is the equity multiple compelling? (> 1.8x good, > 2.0x strong, > 2.5x excellent)
4. Have analyst notes addressed OM concerns?
5. Does the deal match the business plan targets?

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
  return `You are providing a FINAL deal score for a commercial real estate deal that is about to go into the investment package / IC presentation stage. This is the comprehensive assessment using ALL available data — OM analysis, underwriting, deal notes, and diligence checklist.

This score represents: "Should we proceed to put together the investment package and present this deal?"
${bpBlock}
DEAL: ${deal.name}
Property: ${deal.property_type} | ${deal.address}, ${deal.city}, ${deal.state} ${deal.zip}
${omBlock}${uwBlock}${notesBlock}${checklistBlock}
SCORE PROGRESSION:
- OM Analysis Score: ${omAnalysis?.deal_score ?? "N/A"}/10
- Post-Underwriting Score: ${deal.uw_score ?? "N/A"}/10

Provide a comprehensive final score considering:
1. Full underwriting validation — do the numbers work?
2. All red flags and whether they've been adequately addressed
3. Diligence checklist status — any open issues or blockers?
4. Overall risk/return profile vs. business plan targets
5. Is this deal ready for IC / investment package presentation?

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
