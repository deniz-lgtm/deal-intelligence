import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { dealQueries, dealNoteQueries, omAnalysisQueries } from "@/lib/db";
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

    const dealInfo = [
      `Property Type: ${deal.property_type ?? "unknown"}`,
      deal.investment_strategy ? `Investment Strategy: ${deal.investment_strategy}` : null,
      deal.units ? `Units: ${deal.units}` : null,
      deal.square_footage ? `Total SF: ${deal.square_footage.toLocaleString()}` : null,
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

    const prompt = isGroundUp
      ? buildGroundUpPrompt(dealInfo, summaryText, redFlagsText, recommendationsText, contextText)
      : buildValueAddPrompt(dealInfo, summaryText, redFlagsText, recommendationsText, contextText);

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
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
  return `You are a commercial real estate development cost estimator. Based on the deal information below, generate a ground-up development budget. Use realistic 2024-2025 pricing for the market/region indicated.

${dealInfo}
${summaryText}
${redFlagsText}
${recommendationsText}
${contextText}

Generate a development budget with HARD COSTS (priced per SF of buildable area) and SOFT COSTS (as lump sums or percentages). Use these categories:

HARD COSTS (per SF):
- Site Work & Demolition
- Concrete / Foundation
- Structural / Framing
- Building Envelope (exterior walls, windows, roofing)
- MEP (mechanical, electrical, plumbing)
- Interior Finishes (flooring, drywall, paint, fixtures)
- Common Areas / Amenities
- Parking / Hardscape
- General Conditions & Contractor Overhead

SOFT COSTS (lump sum):
- Architecture & Engineering
- Permits & Impact Fees
- Legal & Closing Costs
- Development Management Fee
- Financing / Interest Reserve
- Contingency

For hard costs: set quantity = total buildable SF (or estimate it from units × typical SF/unit if not given), and cost_per_unit = $/SF for that category.
For soft costs: set quantity = 1, and cost_per_unit = total lump sum dollar amount.

Return ONLY a JSON array, no explanation:
[
  {
    "label": "Site Work & Demolition",
    "quantity": 25000,
    "unit": "SF",
    "cost_per_unit": 12,
    "basis": "Assumes 25,000 SF site, moderate grading and demo"
  },
  {
    "label": "Architecture & Engineering",
    "quantity": 1,
    "unit": "lump sum",
    "cost_per_unit": 350000,
    "basis": "~3-4% of hard costs, typical for multifamily"
  }
]`;
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
