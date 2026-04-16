import { NextRequest, NextResponse } from "next/server";
import { dealQueries, underwritingQueries } from "@/lib/db";
import Anthropic from "@anthropic-ai/sdk";
import { requireAuth, requireDealAccess } from "@/lib/auth";

const MODEL = "claude-sonnet-4-6";
let _client: Anthropic | null = null;
function getClient() {
  if (!_client) _client = new Anthropic();
  return _client;
}

function parseJson(text: string): unknown[] | null {
  let s = text.trim().replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/, "");
  const m = s.match(/\[[\s\S]*\]/);
  if (!m) return null;
  try {
    const parsed = JSON.parse(m[0]);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const authResult = await requireAuth();
  if (authResult.errorResponse) return authResult.errorResponse;
  const userId = authResult.userId;

  const accessResult = await requireDealAccess(params.id, userId);
  if (accessResult.errorResponse) return accessResult.errorResponse;
  const deal = accessResult.deal as Record<string, any>;

  const uwRow = await underwritingQueries.getByDealId(params.id);
  const uwData = uwRow?.data || {};
  const unitGroups: Array<{ id: string; label: string; unit_count: number; bedrooms?: number; bathrooms?: number; sf_per_unit?: number; beds_per_unit?: number }> = uwData.unit_groups || [];
  if (unitGroups.length === 0) {
    return NextResponse.json({ error: "No unit groups to estimate rents for — add units first." }, { status: 400 });
  }

  const isMF = ["multifamily", "sfr", "student_housing"].includes(deal.property_type || "");
  const isSH = deal.property_type === "student_housing";
  const address = deal.address || deal.name || "Unknown location";
  const city = (deal as any).city || "";
  const state = (deal as any).state || "";
  const location = [address, city, state].filter(Boolean).join(", ");

  const groupsDesc = unitGroups.map((g, i) =>
    `${i + 1}. "${g.label}" — ${g.unit_count} units` +
    (g.bedrooms ? `, ${g.bedrooms}BR` : "") +
    (g.bathrooms ? `/${g.bathrooms}BA` : "") +
    (g.sf_per_unit ? `, ${g.sf_per_unit} SF` : "") +
    (g.beds_per_unit ? `, ${g.beds_per_unit} beds/unit` : ""),
  ).join("\n");

  const rentField = isSH
    ? "market_rent_per_bed (monthly per bed)"
    : isMF
    ? "market_rent_per_unit (monthly per unit)"
    : "market_rent_per_sf (annual per SF)";

  const prompt = `You are a real estate market analyst. Given the property and unit mix below, estimate current market rents for each unit group.

Property: ${deal.name || "Unnamed"}
Location: ${location}
Property type: ${deal.property_type || "multifamily"}

Unit groups:
${groupsDesc}

For each unit group, estimate the ${rentField} and provide a brief note (1 sentence) explaining the basis — e.g. "Based on typical ${city || "metro"} ${deal.property_type || "MF"} rents for this unit size" or citing a comparable range.

Return a JSON array with one object per unit group (same order), each having:
- "id": the group id string (provided below)
- "${isSH ? "market_rent_per_bed" : isMF ? "market_rent_per_unit" : "market_rent_per_sf"}": number
- "notes": string (1 sentence explaining source/basis)

Group IDs in order: ${unitGroups.map(g => `"${g.id}"`).join(", ")}

Return ONLY the JSON array, no markdown fences, no extra text.`;

  try {
    const client = getClient();
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    });
    const text = msg.content.find((c) => c.type === "text")?.text || "";
    const parsed = parseJson(text);
    if (!parsed) {
      return NextResponse.json({ error: "AI returned unparseable response", raw: text }, { status: 502 });
    }
    return NextResponse.json({ rents: parsed });
  } catch (err: unknown) {
    const status = (err && typeof err === "object" && "status" in err) ? (err as { status: number }).status : 500;
    if (status === 429) return NextResponse.json({ error: "Rate limited — try again in a moment" }, { status: 429 });
    if (status === 401 || status === 403) return NextResponse.json({ error: "AI API key issue — check ANTHROPIC_API_KEY" }, { status: 500 });
    return NextResponse.json({ error: "AI rent estimation failed" }, { status: 500 });
  }
}
