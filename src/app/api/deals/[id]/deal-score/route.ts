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
    // Compute key metrics from UW data
    const groups = uw.unit_groups || [];
    const capexItems = uw.capex_items || [];
    const capexTotal = capexItems.reduce(
      (s: number, c: any) => s + (c.quantity || 0) * (c.cost_per_unit || 0),
      0
    );
    const purchasePrice = uw.purchase_price || 0;
    const closingCosts = purchasePrice * ((uw.closing_costs_pct || 0) / 100);
    const totalCost = purchasePrice + closingCosts + capexTotal;

    // GPR
    const totalUnits = groups.reduce(
      (s: number, g: any) => s + (g.unit_count || 0),
      0
    );
    const proformaGPR = groups.reduce((s: number, g: any) => {
      const rent = g.market_rent_per_unit || 0;
      return s + rent * (g.unit_count || 0) * 12;
    }, 0);
    const vacancyRate = uw.vacancy_rate || 5;
    const proformaEGI = proformaGPR * (1 - vacancyRate / 100);
    const mgmtFee = proformaEGI * ((uw.management_fee_pct || 0) / 100);
    const fixedOpEx = (uw.opex_items || []).reduce(
      (s: number, o: any) => s + (o.annual || 0),
      0
    );
    const proformaNOI = proformaEGI - mgmtFee - fixedOpEx;
    const proformaCapRate =
      purchasePrice > 0 ? (proformaNOI / purchasePrice) * 100 : 0;
    const yoc = totalCost > 0 ? (proformaNOI / totalCost) * 100 : 0;

    uwBlock = `\nUNDERWRITING METRICS:
- Purchase Price: ${fc(purchasePrice)}
- Total Cost Basis: ${fc(totalCost)} (incl. ${fc(capexTotal)} CapEx + ${fc(closingCosts)} closing)
- Total Units: ${totalUnits}
- Proforma GPR: ${fc(proformaGPR)}
- Vacancy Rate: ${vacancyRate}%
- Proforma NOI: ${fc(proformaNOI)}
- Proforma Cap Rate: ${fp(proformaCapRate)}
- Yield on Cost: ${fp(yoc)}
- CapEx Budget: ${fc(capexTotal)} across ${capexItems.length} items
- Hold Period: ${uw.hold_period_years || "?"} years
- Exit Cap Rate: ${uw.exit_cap_rate || "?"}%
- Has Financing: ${uw.has_financing ? "Yes" : "No"}${uw.has_financing ? `\n- LTC: ${uw.acq_ltc || "?"}%\n- Interest Rate: ${uw.acq_interest_rate || "?"}%` : ""}
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
    return `You are re-scoring a commercial real estate deal AFTER underwriting has been completed. The deal was initially scored during OM analysis. Now, with actual underwriting numbers and analyst notes, determine if the deal is stronger or weaker than initially assessed.

CRITICAL: The analyst's deal notes may directly address concerns that lowered the initial OM score. If a red flag was identified in the OM analysis and the analyst has added context/thesis/risk notes explaining why that concern is mitigated, resolved, or acceptable — adjust the score upward accordingly. Conversely, if underwriting reveals new issues not caught in the OM analysis, adjust down.
${bpBlock}
DEAL: ${deal.name}
Property: ${deal.property_type} | ${deal.address}, ${deal.city}, ${deal.state} ${deal.zip}
${omBlock}${uwBlock}${notesBlock}${checklistBlock}
Compare the underwriting results to the OM analysis. Consider:
1. Do the UW numbers confirm or contradict the OM metrics?
2. Have the analyst's notes addressed red flags from the OM analysis?
3. Does the CapEx budget adequately address deferred maintenance or value-add needs?
4. Are the return metrics (YoC, cap rate) in line with the business plan targets?
5. Have any new risks emerged from the underwriting process?

Return ONLY a JSON object:
{
  "deal_score": 7,
  "score_reasoning": "2-4 sentences — how the deal looks now vs. the initial OM score, what changed, and whether analyst notes resolved key concerns. Reference specific numbers."
}

Score guide (same as OM, but informed by UW):
1-3: Pass — underwriting confirms deal-killers or reveals fatal flaws
4-5: Borderline — key assumptions are aggressive or unresolved risks remain
6-7: Solid — numbers work, manageable risks, worth pursuing
8-9: Strong — underwriting confirms strong returns with mitigated risks
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
