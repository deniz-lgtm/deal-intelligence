import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { dealQueries, dealNoteQueries, omAnalysisQueries, underwritingQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";

const MODEL = "claude-sonnet-4-5";

function parseJsonArray(raw: string): unknown[] {
  try {
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) return [];
    return JSON.parse(match[0]);
  } catch {
    return [];
  }
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

/**
 * POST /api/deals/:id/capex-estimate
 * Use AI to generate estimated CapEx / development budget line items based on
 * deal info, investment strategy, OM analysis, and analyst notes.
 *
 * For ground-up: generates hard cost $/SF categories + soft cost categories
 * For value-add / other: generates traditional CapEx line items
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const deal = await dealQueries.getById(params.id);
    const analysis = await omAnalysisQueries.getByDealId(params.id);
    const uw = await underwritingQueries.getByDealId(params.id);

    // Use project-level GSF from underwriting data, fall back to OM/deal SF
    const uwData = uw?.data ? (typeof uw.data === "string" ? JSON.parse(uw.data) : uw.data) : null;
    const projectGSF = uwData?.max_gsf || deal.square_footage || 0;

    const dealInfo = [
      `Property Type: ${deal.property_type ?? "unknown"}`,
      deal.investment_strategy ? `Investment Strategy: ${deal.investment_strategy}` : null,
      deal.units ? `Units: ${deal.units}` : null,
      projectGSF ? `Project GSF: ${projectGSF.toLocaleString()}` : null,
      deal.year_built ? `Year Built: ${deal.year_built}` : null,
      [deal.address, deal.city, deal.state].filter(Boolean).length
        ? `Address: ${[deal.address, deal.city, deal.state].filter(Boolean).join(", ")}`
        : null,
    ].filter(Boolean).join("\n");

    const redFlagsText = analysis && Array.isArray(analysis.red_flags) && analysis.red_flags.length > 0
      ? `OM RED FLAGS:\n${(analysis.red_flags as Array<{ description: string; severity?: string }>)
          .map(f => `- [${f.severity ?? "?"}] ${f.description}`)
          .join("\n")}`
      : "";

    const recommendationsText = analysis && Array.isArray(analysis.recommendations) && analysis.recommendations.length > 0
      ? `OM RECOMMENDATIONS:\n${(analysis.recommendations as string[]).map(r => `- ${r}`).join("\n")}`
      : "";

    const summaryText = analysis?.summary ? `OM SUMMARY: ${analysis.summary}` : "";

    const memoryText = await dealNoteQueries.getMemoryText(params.id);
    const contextText = memoryText
      ? `ANALYST NOTES (from deal notes):\n${memoryText}`
      : "";

    const isGroundUp = deal.investment_strategy === "ground_up";

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    if (isGroundUp) {
      const prompt = buildGroundUpPrompt(dealInfo, summaryText, redFlagsText, recommendationsText, contextText);
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 500,
        messages: [{ role: "user", content: prompt }],
      });
      const raw = response.content[0].type === "text" ? response.content[0].text : "{}";
      const parsed = parseJsonObject(raw);
      return NextResponse.json({
        hard_cost_per_sf: parsed?.hard_cost_per_sf ?? 150,
        soft_cost_pct: parsed?.soft_cost_pct ?? 25,
        basis: parsed?.basis ?? "",
        strategy: "ground_up",
      });
    }

    const prompt = buildValueAddPrompt(dealInfo, summaryText, redFlagsText, recommendationsText, contextText);
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = response.content[0].type === "text" ? response.content[0].text : "[]";
    const estimates = parseJsonArray(raw);

    return NextResponse.json({ data: estimates, strategy: deal.investment_strategy || "value_add" });
  } catch (error) {
    console.error("POST /api/deals/[id]/capex-estimate error:", error);
    return NextResponse.json({ error: "Estimation failed" }, { status: 500 });
  }
}

function buildGroundUpPrompt(
  dealInfo: string,
  summaryText: string,
  redFlagsText: string,
  recommendationsText: string,
  contextText: string,
): string {
  return `You are a commercial real estate development cost estimator. Based on the deal information below, estimate construction costs. Use realistic 2024-2025 pricing for the market/region indicated.

${dealInfo}
${summaryText}
${redFlagsText}
${recommendationsText}
${contextText}

Provide TWO numbers:
1. hard_cost_per_sf: All-in hard construction cost per gross square foot ($/GSF). This includes site work, foundations, structure, envelope, MEP, interior finishes, amenities, parking, and general conditions.
2. soft_cost_pct: Total soft costs as a percentage of hard costs. This includes A&E, permits, legal, development management, financing/interest reserve, and contingency.

Consider: property type, market location, construction type (wood-frame, steel, concrete), and current market conditions.

Return ONLY a JSON object, no explanation:
{
  "hard_cost_per_sf": 185,
  "soft_cost_pct": 25,
  "basis": "Wood-frame multifamily in Austin, TX — typical 2024 range $170-200/GSF hard, 20-30% soft"
}`;
}

function buildValueAddPrompt(
  dealInfo: string,
  summaryText: string,
  redFlagsText: string,
  recommendationsText: string,
  contextText: string,
): string {
  return `You are a commercial real estate CapEx estimator. Based on the deal information below, estimate capital expenditure line items for an acquisition. Use realistic 2024-2025 contractor/market pricing.

${dealInfo}
${summaryText}
${redFlagsText}
${recommendationsText}
${contextText}

Generate 4-8 realistic CapEx line items. Use property-specific logic:
- Industrial/flex: roof, HVAC, dock equipment, LED lighting, paving, office build-out
- Multifamily: unit renovations, appliances, roof, HVAC, common areas, parking lot
- Office/retail: HVAC, roof, tenant improvements, common areas, parking
- Include quantity and unit type (per unit, per SF, lump sum, per bay)

Return ONLY a JSON array, no explanation:
[
  {
    "label": "Roof Replacement",
    "quantity": 1,
    "unit": "lump sum",
    "cost_per_unit": 45000,
    "basis": "Estimated for 18,000 SF flat roof, typical age/condition"
  },
  {
    "label": "HVAC Replacement",
    "quantity": 4,
    "unit": "unit",
    "cost_per_unit": 8000,
    "basis": "4 rooftop units, aged 15+ years per year built"
  }
]`;
}
