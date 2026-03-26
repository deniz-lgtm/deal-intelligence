import { NextRequest, NextResponse } from "next/server";
import { dealQueries, documentQueries, underwritingQueries } from "@/lib/db";
import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-sonnet-4-5";
let _client: Anthropic | null = null;
function getClient() {
  if (!_client) _client = new Anthropic();
  return _client;
}

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const [deal, uwRow, docs] = await Promise.all([
      dealQueries.getById(params.id),
      underwritingQueries.getByDealId(params.id),
      documentQueries.getByDealId(params.id),
    ]);

    if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 });

    const isMF = deal.property_type === "multifamily" || deal.property_type === "student_housing";

    // Build context from deal + UW data + documents
    let context = `Property: ${deal.name}\nLocation: ${[deal.address, deal.city, deal.state].filter(Boolean).join(", ")}\n`;
    context += `Type: ${deal.property_type} | Units: ${deal.units ?? "N/A"} | Year Built: ${deal.year_built ?? "N/A"}\n`;

    if (uwRow?.data) {
      const uw = typeof uwRow.data === "string" ? JSON.parse(uwRow.data) : uwRow.data;
      const unitGroups = Array.isArray(uw.unit_groups) ? uw.unit_groups : [];
      if (unitGroups.length > 0) {
        context += "\nSubject Property Unit Mix:\n";
        for (const g of unitGroups) {
          if (isMF) {
            context += `  ${g.label || "Unit"}: ${g.unit_count} units, ${g.bedrooms || "?"}BR/${g.bathrooms || "?"}BA, ${g.sf_per_unit || "?"}SF, current rent $${g.current_rent_per_unit || 0}/mo, market rent $${g.market_rent_per_unit || 0}/mo\n`;
          } else {
            context += `  ${g.label || "Space"}: ${g.unit_count} units, ${g.sf_per_unit || 0}SF/unit, current $${(g.current_rent_per_sf || 0).toFixed(2)}/SF, market $${(g.market_rent_per_sf || 0).toFixed(2)}/SF\n`;
          }
        }
      }
    }

    // Include document summaries that might contain comp data
    const docSummaries = (docs as Array<{ name: string; ai_summary: string | null; content_text: string | null }>)
      .filter(d => d.ai_summary || d.content_text)
      .map(d => {
        const preview = d.content_text ? d.content_text.slice(0, 1500) : "";
        return `${d.name}: ${d.ai_summary || ""}\n${preview}`;
      })
      .join("\n---\n");

    if (docSummaries) context += `\nDocument Extracts:\n${docSummaries}\n`;

    const prompt = `You are a commercial real estate analyst generating a rent comparable analysis for the subject property described below.

${context}

Generate a comprehensive rent comp table with 6-10 comparable properties. ${isMF
      ? "For each comp, provide realistic data for a multifamily property near this location."
      : "For each comp, provide realistic data for a commercial property near this location."
    }

If there is rent comp data in the documents above, USE THAT DATA and supplement with additional comps. If no document data is available, generate realistic market-based estimates.

Return a JSON array where each comp is an object with these exact fields:
${isMF ? `{
  "name": "Property name",
  "address": "Street address, City",
  "distance_mi": 0.5,
  "year_built": 1990,
  "units": 120,
  "unit_types": [
    { "type": "1BR/1BA", "sf": 650, "rent": 1450 },
    { "type": "2BR/1BA", "sf": 850, "rent": 1850 },
    { "type": "2BR/2BA", "sf": 950, "rent": 2050 },
    { "type": "3BR/2BA", "sf": 1150, "rent": 2450 }
  ],
  "occupancy_pct": 95,
  "amenities": "Pool, Gym, Dog Park",
  "notes": "Recently renovated units commanding premium"
}` : `{
  "name": "Property name",
  "address": "Street address, City",
  "distance_mi": 0.5,
  "year_built": 1990,
  "total_sf": 50000,
  "rent_per_sf": 32.50,
  "occupancy_pct": 92,
  "lease_type": "NNN",
  "tenant_type": "Multi-tenant office",
  "notes": "Class A building, recently renovated"
}`}

Return ONLY a valid JSON array. No markdown, no explanation — just the JSON.`;

    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: 4000,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "[]";

    // Parse JSON — handle potential markdown wrapping
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return NextResponse.json({ error: "Failed to parse comps" }, { status: 500 });
    }

    const comps = JSON.parse(jsonMatch[0]);
    return NextResponse.json({ data: comps });
  } catch (error) {
    console.error("Rent comps error:", error);
    return NextResponse.json({ error: "Failed to generate comps" }, { status: 500 });
  }
}
