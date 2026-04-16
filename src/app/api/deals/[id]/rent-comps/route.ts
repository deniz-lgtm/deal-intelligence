import { NextRequest, NextResponse } from "next/server";
import { dealQueries, documentQueries, underwritingQueries } from "@/lib/db";
import Anthropic from "@anthropic-ai/sdk";
import { requireAuth, requireDealAccess } from "@/lib/auth";

const MODEL = "claude-sonnet-4-6";
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

// ── Knowledge-based strategy (no tools) ──────────────────────────────────────
// NOTE: This route previously had a `tryWebSearch` strategy that used the
// Claude web_search tool to pull real comps from LoopNet / Crexi / Zillow.
// That path was removed because those broker sites explicitly forbid
// scraping in their ToS and recent litigation (CoStar v. Crexi, June 2025)
// establishes copyright liability for reproducing their listing data. For
// real comp data the analyst should paste listings into the Comps & Market
// tab (which routes through extractCompFromText() — user-supplied content,
// legally clean). This route is kept only as a knowledge-based fallback
// that clearly labels its output as an AI estimate.
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
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const [deal, uwRow, docs] = await Promise.all([
      dealQueries.getById(params.id),
      underwritingQueries.getByDealId(params.id),
      documentQueries.getByDealId(params.id),
    ]);

    const isMF = deal.property_type === "multifamily" || deal.property_type === "sfr" || deal.property_type === "student_housing";
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

    // Knowledge-based comps only. Web scraping broker sites is forbidden —
    // see the comment on tryKnowledge() above. For real-world comps, route
    // users to the Comps & Market tab and its paste-mode extractor.
    const kPrompt = buildKnowledgePrompt(context, isMF, unitTypeGuidance, searchLocation);
    const text: string | null = await tryKnowledge(kPrompt);

    if (!text) {
      return NextResponse.json({ error: "AI returned empty response" }, { status: 500 });
    }

    // Parse
    const comps = parseCompsJson(text);
    if (!comps) {
      console.error("Failed to parse comps JSON. Raw response:", text.slice(0, 500));
      return NextResponse.json({ error: "Failed to parse comp data from AI response" }, { status: 500 });
    }

    return NextResponse.json({ data: comps, source: "knowledge" });
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
