import { NextRequest, NextResponse } from "next/server";
import { dealQueries, documentQueries, underwritingQueries } from "@/lib/db";
import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-sonnet-4-5";
let _client: Anthropic | null = null;
function getClient() {
  if (!_client) _client = new Anthropic();
  return _client;
}

// ── Error helpers ────────────────────────────────────────────────────────────
function isRateLimitError(error: unknown): boolean {
  return !!(error && typeof error === "object" && "status" in error && (error as { status: number }).status === 429);
}
function isAuthError(error: unknown): boolean {
  if (error && typeof error === "object" && "status" in error) {
    const s = (error as { status: number }).status;
    return s === 401 || s === 403;
  }
  return false;
}

// ── JSON parser ──────────────────────────────────────────────────────────────
function parseCompsJson(text: string): unknown[] | null {
  let jsonStr = text.trim();
  jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/, "");
  const jsonMatch = jsonStr.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return null;
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    return null;
  } catch {
    return null;
  }
}

// ── Prompt builders ──────────────────────────────────────────────────────────
function buildJsonSchema(isMF: boolean): string {
  if (isMF) {
    return `Return a JSON array. Each comp object must have EXACTLY these fields:
[
  {
    "name": "Property Name",
    "address": "Address, City, State",
    "distance_mi": 0.5,
    "year_built": 1995,
    "units": 150,
    "unit_types": [
      { "type": "1BR/1BA", "sf": 700, "rent": 1500 },
      { "type": "2BR/2BA", "sf": 1000, "rent": 2000 }
    ],
    "occupancy_pct": 95,
    "amenities": "Pool, Gym",
    "notes": "Source info here"
  }
]`;
  }
  return `Return a JSON array. Each comp object must have EXACTLY these fields:
[
  {
    "name": "Property Name",
    "address": "Address, City, State",
    "distance_mi": 0.5,
    "year_built": 1995,
    "total_sf": 50000,
    "rent_per_sf": 30.00,
    "occupancy_pct": 92,
    "lease_type": "NNN",
    "tenant_type": "Multi-tenant office",
    "notes": "Source info here"
  }
]`;
}

function buildWebSearchPrompt(
  context: string, isMF: boolean, unitTypeGuidance: string,
  searchLocation: string, deal: { address?: string; city?: string; property_type?: string },
): string {
  return `You are a commercial real estate analyst generating a rent comparable analysis.

${context}

I need you to find REAL comparable properties near this location using web search. Search for actual rental listings, recent lease comps, and market data. ${unitTypeGuidance}

Please search for real properties and current market rents in ${searchLocation}. Use specific search queries to find:
${isMF ? `- Apartments for rent near ${deal.address || deal.city}
- Multifamily communities in ${searchLocation} with current asking rents
- Recent apartment rent surveys or market reports for the area` :
`- Commercial spaces for lease near ${deal.address || deal.city}
- ${deal.property_type || "commercial"} rental rates in ${searchLocation}
- Recent lease comps and market reports`}

After searching, compile 6-8 REAL comparable properties. Use actual property names, real addresses, and current asking rents from your search results. If you can't find exact data for some fields, use your best estimate based on the market data you found, but prioritize real properties over fabricated ones.

${buildJsonSchema(isMF)}

IMPORTANT: Return ONLY valid JSON after your research. No markdown code fences, no explanation, no text before or after the JSON array. Cite your sources in the notes field.`;
}

function buildKnowledgePrompt(
  context: string, isMF: boolean, unitTypeGuidance: string, searchLocation: string,
): string {
  return `You are a commercial real estate analyst generating a rent comparable analysis.

${context}

Based on your knowledge of real estate markets, generate realistic comparable properties for ${searchLocation}. ${unitTypeGuidance}

Use your training data about rent levels, property characteristics, and market conditions in and around ${searchLocation}. Generate 6-8 comparable properties with:
- Realistic property names and addresses in the area
- Current market-rate rents appropriate for this submarket and property class
- Reasonable unit counts, square footages, year built, and occupancy levels
- Properties that would genuinely compete with or compare to the subject

${buildJsonSchema(isMF)}

IMPORTANT: Return ONLY valid JSON. No markdown code fences, no explanation, no text before or after the JSON array. In the notes field, write "AI estimate based on market knowledge" for each comp.`;
}

// ── Web search strategy (with 1 retry on 429) ───────────────────────────────
async function tryWebSearch(prompt: string): Promise<string | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
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

      let text = "";
      for (const block of response.content) {
        if (block.type === "text") text = block.text;
      }
      if (text.trim()) return text;
      return null;
    } catch (err) {
      if (attempt === 0 && isRateLimitError(err)) {
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      throw err;
    }
  }
  return null;
}

// ── Knowledge-based strategy (no tools) ──────────────────────────────────────
async function tryKnowledge(prompt: string): Promise<string | null> {
  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 8000,
    messages: [{ role: "user", content: prompt }],
  });

  let text = "";
  for (const block of response.content) {
    if (block.type === "text") text = block.text;
  }
  return text.trim() || null;
}

// ── Route handler ────────────────────────────────────────────────────────────
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

    if (uwRow?.data) {
      const uw = typeof uwRow.data === "string" ? JSON.parse(uwRow.data) : uwRow.data;
      const unitGroups = Array.isArray(uw.unit_groups) ? uw.unit_groups : [];
      if (unitGroups.length > 0) {
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
    const searchLocation = [deal.city, deal.state].filter(Boolean).join(", ") || "the area";

    let unitTypeGuidance = "";
    if (isMF || isSH) {
      unitTypeGuidance = "Match the unit_types in each comp to typical bedroom/bathroom configurations for this market. Include rents for each unit type.";
    }

    // ── Strategy A: try web search first ──────────────────────────────────────
    let text: string | null = null;
    let source: "web_search" | "knowledge" = "web_search";

    try {
      const wsPrompt = buildWebSearchPrompt(context, isMF, unitTypeGuidance, searchLocation, deal);
      text = await tryWebSearch(wsPrompt);
    } catch (err) {
      console.warn("Web search failed, falling back to knowledge:", err instanceof Error ? err.message : err);
    }

    // ── Strategy B: fall back to knowledge-based comps ────────────────────────
    if (!text) {
      source = "knowledge";
      const kPrompt = buildKnowledgePrompt(context, isMF, unitTypeGuidance, searchLocation);
      text = await tryKnowledge(kPrompt);
    }

    if (!text) {
      return NextResponse.json({ error: "AI returned empty response" }, { status: 500 });
    }

    // Parse
    const comps = parseCompsJson(text);
    if (!comps) {
      console.error("Failed to parse comps JSON. Raw response:", text.slice(0, 500));
      return NextResponse.json({ error: "Failed to parse comp data from AI response" }, { status: 500 });
    }

    return NextResponse.json({ data: comps, source });
  } catch (error) {
    console.error("Rent comps error:", error);

    if (isAuthError(error)) {
      return NextResponse.json({ error: "AI API authentication error — check API key" }, { status: 500 });
    }
    if (isRateLimitError(error)) {
      return NextResponse.json({ error: "AI API rate limit — try again in a moment" }, { status: 429 });
    }

    const errMsg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: `Failed to generate comps: ${errMsg}` }, { status: 500 });
  }
}
