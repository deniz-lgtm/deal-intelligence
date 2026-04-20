import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { dealQueries, omAnalysisQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

const anthropic = new Anthropic();

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

    let context = `Property: ${deal.name}\nType: ${deal.property_type}\n`;
    if (deal.year_built) context += `Year Built: ${deal.year_built}\n`;
    if (deal.square_footage) context += `Total SF: ${deal.square_footage}\n`;
    if (deal.units) context += `Units: ${deal.units}\n`;

    if (analysis) {
      if (Array.isArray(analysis.red_flags) && analysis.red_flags.length > 0) {
        context += `\nRed Flags / Concerns:\n${(analysis.red_flags as { severity: string; category: string; description: string }[]).map(f => `- [${f.severity.toUpperCase()}] ${f.category}: ${f.description}`).join("\n")}\n`;
      }
      if (analysis.summary) {
        context += `\nProperty Overview: ${analysis.summary}\n`;
      }
      if (Array.isArray(analysis.recommendations) && analysis.recommendations.length > 0) {
        context += `\nAnalyst Recommendations:\n${(analysis.recommendations as string[]).map(r => `- ${r}`).join("\n")}\n`;
      }
    }

    const prompt = `You are a commercial real estate analyst. Based on the property details below, generate a realistic capital expenditure (CapEx) budget with specific line items and estimated costs.

${context}

Return ONLY a JSON array of CapEx items. Each item must have:
- "label": descriptive name (e.g. "Roof Replacement", "HVAC Unit — Suite 101", "Parking Lot Reseal")
- "cost": estimated total cost in USD as a number (no commas or $)

Requirements:
- 6–12 items relevant to this property type, age, and any noted condition issues
- Be specific, not generic (e.g. "Loading Dock Door Replacement × 4" not "Doors")
- For multifamily: include unit renovations, common areas, mechanical systems, amenities
- For industrial/flex: include roof, dock doors, HVAC, electrical, site work, office buildout
- Costs should be realistic market-rate estimates
- If red flags mention specific issues, include CapEx for those items

Example format:
[
  {"label": "Roof Replacement (flat membrane, 18,000 SF)", "cost": 162000},
  {"label": "HVAC Replacement — 3 rooftop units", "cost": 45000}
]

Respond with ONLY the JSON array, no explanation.`;

    const msg = await anthropic.messages.create({
      model: "claude-opus-4-6",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });

    const text = msg.content[0].type === "text" ? msg.content[0].text : "[]";
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return NextResponse.json({ error: "Failed to parse AI response" }, { status: 500 });

    const items: { label: string; cost: number }[] = JSON.parse(match[0]);
    return NextResponse.json({ items });
  } catch (err) {
    console.error("capex-suggest error:", err);
    return NextResponse.json({ error: "Failed to generate CapEx suggestions" }, { status: 500 });
  }
}
