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

    // Build context
    const contextParts: string[] = [];
    contextParts.push(`Subject Property: ${deal.name || "Unknown"}`);
    const location = [deal.address, deal.city, deal.state].filter(Boolean).join(", ");
    contextParts.push(`Location: ${location || "Unknown location"}`);
    contextParts.push(`Property Type: ${deal.property_type || "multifamily"}`);
    if (deal.units) contextParts.push(`Total Units: ${deal.units}`);
    if (deal.square_footage) contextParts.push(`Total SF: ${Number(deal.square_footage).toLocaleString()}`);
    if (deal.year_built) contextParts.push(`Year Built: ${deal.year_built}`);
    if (deal.asking_price) contextParts.push(`Asking Price: $${Number(deal.asking_price).toLocaleString()}`);

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
            contextParts.push(`  ${label}: ${count} units, ${g.beds_per_unit || 1} beds/unit, ${bd}BR/${ba}BA, ${sf}SF, IP $${g.current_rent_per_bed || 0}/bed/mo, Mkt $${g.market_rent_per_bed || 0}/bed/mo`);
          } else if (isMF) {
            contextParts.push(`  ${label}: ${count} units, ${bd}BR/${ba}BA, ${sf}SF, IP $${g.current_rent_per_unit || 0}/mo, Mkt $${g.market_rent_per_unit || 0}/mo`);
          } else {
            contextParts.push(`  ${label}: ${count} units, ${sf}SF/unit, IP $${(g.current_rent_per_sf || 0).toFixed(2)}/SF, Mkt $${(g.market_rent_per_sf || 0).toFixed(2)}/SF`);
          }
        }
      }
    }

    if (!hasUnitMix) {
      contextParts.push("\nNo unit mix entered yet. Generate comps based on the property type, location, and any available details.");
      if (deal.units) contextParts.push(`Assume ${deal.units} total units.`);
      if (deal.bedrooms) contextParts.push(`Total bedrooms: ${deal.bedrooms}`);
    }

    if (Array.isArray(docs) && docs.length > 0) {
      const relevantDocs = (docs as Array<{ name: string; ai_summary: string | null }>)
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

    let unitTypeGuidance = "";
    if (isMF || isSH) {
      if (hasUnitMix) {
        unitTypeGuidance = "Match the unit_types in each comp to the subject property's unit mix (same bedroom/bathroom configurations). Include rents for each matching unit type.";
      } else {
        unitTypeGuidance = "Generate comps with typical unit types for this market (Studio, 1BR/1BA, 2BR/1BA, 2BR/2BA, 3BR/2BA). Include rents for each unit type.";
      }
    }

    // Build search queries for real market data
    const city = deal.city || "";
    const state = deal.state || "";
    const searchLocation = [city, state].filter(Boolean).join(", ") || "the area";

    const searchQueries: string[] = [];
    if (isMF || isSH) {
      searchQueries.push(`apartment rent prices ${searchLocation} 2024 2025`);
      searchQueries.push(`${searchLocation} multifamily rent comps average rent by bedroom`);
      if (isSH) searchQueries.push(`student housing rent per bed ${searchLocation}`);
    } else {
      const ptype = deal.property_type === "industrial" ? "industrial warehouse flex" :
                     deal.property_type === "office" ? "office" :
                     deal.property_type === "retail" ? "retail" : "commercial";
      searchQueries.push(`${ptype} lease rates ${searchLocation} 2024 2025 per square foot`);
      searchQueries.push(`${searchLocation} ${ptype} space for rent listing`);
    }

    const prompt = `You are a commercial real estate analyst generating a rent comparable analysis.

${context}

I need you to find REAL comparable properties near this location using web search. Search for actual rental listings, recent lease comps, and market data. ${unitTypeGuidance}

Please search for real properties and current market rents in ${searchLocation}. Use specific search queries to find:
${isMF ? `- Apartments for rent near ${deal.address || city}
- Multifamily communities in ${searchLocation} with current asking rents
- Recent apartment rent surveys or market reports for the area` :
`- Commercial spaces for lease near ${deal.address || city}
- ${deal.property_type || "commercial"} rental rates in ${searchLocation}
- Recent lease comps and market reports`}

After searching, compile 6-8 REAL comparable properties. Use actual property names, real addresses, and current asking rents from your search results. If you can't find exact data for some fields, use your best estimate based on the market data you found, but prioritize real properties over fabricated ones.

${isMF ? `Return a JSON array. Each comp object must have EXACTLY these fields:
[
  {
    "name": "Real Property Name",
    "address": "Real Address, City, State",
    "distance_mi": 0.5,
    "year_built": 1995,
    "units": 150,
    "unit_types": [
      { "type": "1BR/1BA", "sf": 700, "rent": 1500 },
      { "type": "2BR/2BA", "sf": 1000, "rent": 2000 }
    ],
    "occupancy_pct": 95,
    "amenities": "Pool, Gym",
    "notes": "Source: apartments.com listing / market survey"
  }
]` : `Return a JSON array. Each comp object must have EXACTLY these fields:
[
  {
    "name": "Real Property Name",
    "address": "Real Address, City, State",
    "distance_mi": 0.5,
    "year_built": 1995,
    "total_sf": 50000,
    "rent_per_sf": 30.00,
    "occupancy_pct": 92,
    "lease_type": "NNN",
    "tenant_type": "Multi-tenant office",
    "notes": "Source: LoopNet listing / CoStar data"
  }
]`}

IMPORTANT: Return ONLY valid JSON after your research. No markdown code fences, no explanation, no text before or after the JSON array. Cite your sources in the notes field.`;

    // Use web_search tool to get real data
    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: 8000,
      tools: [
        {
          type: "web_search" as const,
          name: "web_search" as const,
          max_uses: 5,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      ],
      messages: [{ role: "user", content: prompt }],
    });

    // Extract the final text from the response (after tool use)
    let text = "";
    for (const block of response.content) {
      if (block.type === "text") {
        text = block.text;
      }
    }

    // If the model used tools and we need to continue the conversation
    if (response.stop_reason === "tool_use" || !text.trim()) {
      // Collect all content for multi-turn
      const messages: Anthropic.Messages.MessageParam[] = [
        { role: "user", content: prompt },
        { role: "assistant", content: response.content },
      ];

      // Continue until we get a final text response
      let continueResponse = response;
      let iterations = 0;
      while (iterations < 5) {
        iterations++;
        // Check if there are tool_use blocks that need results
        const toolUseBlocks = continueResponse.content.filter(
          (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use"
        );
        if (toolUseBlocks.length === 0 && continueResponse.stop_reason === "end_turn") break;
        if (toolUseBlocks.length === 0) break;

        // For web_search, the API handles it internally via server-side tool use
        // If stop_reason is end_turn, we should have our text
        if (continueResponse.stop_reason === "end_turn") break;

        // Continue the conversation
        continueResponse = await getClient().messages.create({
          model: MODEL,
          max_tokens: 8000,
          tools: [
            {
              type: "web_search" as const,
              name: "web_search" as const,
              max_uses: 5,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
          ],
          messages,
        });

        // Extract text from the continued response
        for (const block of continueResponse.content) {
          if (block.type === "text") {
            text = block.text;
          }
        }

        if (continueResponse.stop_reason === "end_turn") break;
      }
    }

    if (!text.trim()) {
      return NextResponse.json({ error: "AI returned empty response" }, { status: 500 });
    }

    // Parse JSON
    let jsonStr = text.trim();
    jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/, "");
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
    if (errMsg.includes("401") || errMsg.includes("auth")) {
      return NextResponse.json({ error: "AI API authentication error — check API key" }, { status: 500 });
    }
    if (errMsg.includes("429") || errMsg.includes("rate")) {
      return NextResponse.json({ error: "AI API rate limit — try again in a moment" }, { status: 429 });
    }
    return NextResponse.json({ error: `Failed to generate comps: ${errMsg}` }, { status: 500 });
  }
}
