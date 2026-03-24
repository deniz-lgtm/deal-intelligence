import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { dealQueries, omAnalysisQueries } from "@/lib/db";

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
 * Use AI to generate estimated CapEx line items based on deal info,
 * OM analysis red flags, and any analyst context notes.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const deal = await dealQueries.getById(params.id);
    if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 });

    const analysis = await omAnalysisQueries.getByDealId(params.id);

    const dealInfo = [
      `Property Type: ${deal.property_type ?? "unknown"}`,
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

    const contextText = deal.context_notes?.trim()
      ? `ANALYST NOTES (from deal chat):\n${deal.context_notes}`
      : "";

    const prompt = `You are a commercial real estate CapEx estimator. Based on the deal information below, estimate capital expenditure line items for a value-add acquisition. Use realistic 2024-2025 contractor/market pricing.

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

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = response.content[0].type === "text" ? response.content[0].text : "[]";
    const estimates = parseJsonArray(raw);

    return NextResponse.json({ data: estimates });
  } catch (error) {
    console.error("POST /api/deals/[id]/capex-estimate error:", error);
    return NextResponse.json({ error: "Estimation failed" }, { status: 500 });
  }
}
