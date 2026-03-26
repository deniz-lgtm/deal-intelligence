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
    const isSH = deal.property_type === "student_housing";

    // Build context — always include what we have, even if minimal
    const contextParts: string[] = [];

    // Deal basics — always available
    contextParts.push(`Subject Property: ${deal.name || "Unknown"}`);
    const location = [deal.address, deal.city, deal.state].filter(Boolean).join(", ");
    contextParts.push(`Location: ${location || "Unknown location"}`);
    contextParts.push(`Property Type: ${deal.property_type || "multifamily"}`);
    if (deal.units) contextParts.push(`Total Units: ${deal.units}`);
    if (deal.square_footage) contextParts.push(`Total SF: ${Number(deal.square_footage).toLocaleString()}`);
    if (deal.year_built) contextParts.push(`Year Built: ${deal.year_built}`);
    if (deal.asking_price) contextParts.push(`Asking Price: $${Number(deal.asking_price).toLocaleString()}`);

    // Unit mix from underwriting — use whatever is available
    let hasUnitMix = false;
    if (uwRow?.data) {
      const uw = typeof uwRow.data === "string" ? JSON.parse(uwRow.data) : uwRow.data;
      const unitGroups = Array.isArray(uw.unit_groups) ? uw.unit_groups : [];
      if (unitGroups.length > 0) {
        hasUnitMix = true;
        contextParts.push("\nSubject Property Unit Mix:");
        for (const g of unitGroups) {
          const label = g.label || "Unit";
          const count = g.unit_count || 1;
          const bd = g.bedrooms || 0;
          const ba = g.bathrooms || 0;
          const sf = g.sf_per_unit || 0;

          if (isSH) {
            const beds = g.beds_per_unit || 1;
            const ipRent = g.current_rent_per_bed || 0;
            const mktRent = g.market_rent_per_bed || 0;
            contextParts.push(`  ${label}: ${count} units, ${beds} beds/unit, ${bd}BR/${ba}BA, ${sf}SF, IP $${ipRent}/bed/mo, Mkt $${mktRent}/bed/mo`);
          } else if (isMF) {
            const ipRent = g.current_rent_per_unit || 0;
            const mktRent = g.market_rent_per_unit || 0;
            contextParts.push(`  ${label}: ${count} units, ${bd}BR/${ba}BA, ${sf}SF, IP $${ipRent}/mo, Mkt $${mktRent}/mo`);
          } else {
            const ipRent = g.current_rent_per_sf || 0;
            const mktRent = g.market_rent_per_sf || 0;
            contextParts.push(`  ${label}: ${count} units, ${sf}SF/unit, IP $${ipRent.toFixed(2)}/SF, Mkt $${mktRent.toFixed(2)}/SF`);
          }
        }
      }
    }

    // If no unit mix, still provide guidance based on deal basics
    if (!hasUnitMix) {
      contextParts.push("\nNo unit mix entered yet. Generate comps based on the property type, location, and any available details.");
      if (deal.units) contextParts.push(`Assume ${deal.units} total units.`);
      if (deal.bedrooms) contextParts.push(`Total bedrooms: ${deal.bedrooms}`);
    }

    // Document extracts — only include if relevant and keep concise
    if (Array.isArray(docs) && docs.length > 0) {
      const relevantDocs = (docs as Array<{ name: string; ai_summary: string | null; content_text: string | null }>)
        .filter(d => d.ai_summary)
        .slice(0, 5);
      if (relevantDocs.length > 0) {
        contextParts.push("\nDocument Summaries:");
        for (const d of relevantDocs) {
          contextParts.push(`  ${d.name}: ${d.ai_summary}`);
        }
      }
    }

    const context = contextParts.join("\n");

    // Determine unit types to generate comps for
    let unitTypeGuidance = "";
    if (isMF || isSH) {
      if (hasUnitMix) {
        unitTypeGuidance = "Match the unit_types in each comp to the subject property's unit mix (same bedroom/bathroom configurations). Include rents for each matching unit type.";
      } else {
        unitTypeGuidance = "Generate comps with typical unit types for this market (Studio, 1BR/1BA, 2BR/1BA, 2BR/2BA, 3BR/2BA). Include rents for each unit type.";
      }
    }

    const prompt = `You are a commercial real estate analyst generating a rent comparable analysis.

${context}

Generate 6-8 realistic comparable properties near this location. ${unitTypeGuidance}

${isMF ? `These should be multifamily apartment communities. For each comp, include unit types that match the subject property's bedroom/bathroom configurations.

Return a JSON array. Each comp object must have EXACTLY these fields:
[
  {
    "name": "Property Name",
    "address": "123 Main St, City",
    "distance_mi": 0.5,
    "year_built": 1995,
    "units": 150,
    "unit_types": [
      { "type": "1BR/1BA", "sf": 700, "rent": 1500 },
      { "type": "2BR/2BA", "sf": 1000, "rent": 2000 }
    ],
    "occupancy_pct": 95,
    "amenities": "Pool, Gym",
    "notes": "Brief note about condition/relevance"
  }
]` : `These should be commercial properties similar to the subject.

Return a JSON array. Each comp object must have EXACTLY these fields:
[
  {
    "name": "Property Name",
    "address": "123 Main St, City",
    "distance_mi": 0.5,
    "year_built": 1995,
    "total_sf": 50000,
    "rent_per_sf": 30.00,
    "occupancy_pct": 92,
    "lease_type": "NNN",
    "tenant_type": "Multi-tenant office",
    "notes": "Brief note"
  }
]`}

IMPORTANT: Return ONLY valid JSON. No markdown code fences, no explanation, no text before or after the JSON array.`;

    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: 4000,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";

    if (!text.trim()) {
      return NextResponse.json({ error: "AI returned empty response" }, { status: 500 });
    }

    // Parse JSON — handle markdown code fences and other wrapping
    let jsonStr = text.trim();
    // Remove markdown code fences if present
    jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/, "");
    // Find the JSON array
    const jsonMatch = jsonStr.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.error("Failed to parse comps JSON. Raw response:", text.slice(0, 500));
      return NextResponse.json({ error: "Failed to parse comp data from AI response" }, { status: 500 });
    }

    try {
      const comps = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(comps) || comps.length === 0) {
        return NextResponse.json({ error: "No comps generated" }, { status: 500 });
      }
      return NextResponse.json({ data: comps });
    } catch (parseErr) {
      console.error("JSON parse error:", parseErr, "Raw:", jsonMatch[0].slice(0, 300));
      return NextResponse.json({ error: "Failed to parse comp data" }, { status: 500 });
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Unknown error";
    console.error("Rent comps error:", errMsg);
    // Return a more helpful error message
    if (errMsg.includes("401") || errMsg.includes("auth")) {
      return NextResponse.json({ error: "AI API authentication error — check API key" }, { status: 500 });
    }
    if (errMsg.includes("429") || errMsg.includes("rate")) {
      return NextResponse.json({ error: "AI API rate limit — try again in a moment" }, { status: 429 });
    }
    if (errMsg.includes("insufficient") || errMsg.includes("credit") || errMsg.includes("billing")) {
      return NextResponse.json({ error: "AI API credits exhausted — check billing" }, { status: 500 });
    }
    return NextResponse.json({ error: `Failed to generate comps: ${errMsg}` }, { status: 500 });
  }
}
