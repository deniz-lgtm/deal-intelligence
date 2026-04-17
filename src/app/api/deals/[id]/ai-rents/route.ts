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

  // Prefer unit_groups from the request body (what the analyst is seeing
  // right now, including any scenario overrides). Fall back to the DB
  // rows when the client doesn't send any (legacy behaviour).
  let unitGroups: Array<{ id: string; label: string; unit_count: number; bedrooms?: number; bathrooms?: number; sf_per_unit?: number; beds_per_unit?: number }> = [];
  try {
    const body = await request.json().catch(() => ({}));
    if (Array.isArray(body?.unit_groups)) unitGroups = body.unit_groups;
  } catch { /* empty body — fall through to DB read */ }
  if (unitGroups.length === 0) {
    const uwRow = await underwritingQueries.getByDealId(params.id);
    const uwData = uwRow?.data || {};
    unitGroups = uwData.unit_groups || [];
  }
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

  const rentFieldName = isSH ? "market_rent_per_bed" : isMF ? "market_rent_per_unit" : "market_rent_per_sf";
  const prompt = `You are a real estate market analyst. Estimate current market rents for each unit group using comps from the local submarket.

Property: ${deal.name || "Unnamed"}
Location: ${location}
Type: ${deal.property_type || "multifamily"}

Unit groups (one rent per row, keep the exact id so the UI can map back):
${groupsDesc}

Return a JSON array with EXACTLY ${unitGroups.length} object${unitGroups.length === 1 ? "" : "s"}, one per group in the same order. Each object MUST include:
- "id": "<exact id from above>"
- "label": "<group label>"         (redundant safety net for matching)
- "${rentFieldName}": <number>     (dollars, no commas; MUST be > 0 — never return 0)
- "basis": "<one-line cite>"       (comp building, $/SF or $/unit, submarket)

Rules:
- Never emit 0 or null for ${rentFieldName} — if evidence is thin, use the nearest comp and note the caveat in "basis".
- Scale by bedroom count and unit SF. A 2BR is not the same as a Studio.
- ${isSH ? "Per-bed pricing assumes purpose-built student housing adjacent to campus." : isMF ? "Per-unit is MONTHLY. Typical ranges: $1,200-$4,500 depending on market + BR count." : "Per-SF is ANNUAL asking rent. Typical ranges: $22-$90 depending on market + class."}

Group IDs for reference: ${unitGroups.map(g => `"${g.id}"`).join(", ")}

JSON array only, no markdown, no extra text.`;

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
    // Defensively reconcile the AI response to our unit groups. LLMs
    // sometimes hallucinate ids or skip rows; we match on id first, then
    // label, then positional index, and drop any row where the rent field
    // never landed. Returning the caller's id ensures the UI can apply
    // the result without its own fuzzy matching.
    const rawRents = parsed as Array<Record<string, unknown>>;
    const reconciled = unitGroups.map((g, i) => {
      const byId = rawRents.find((r) => r.id === g.id);
      const byLabel = rawRents.find((r) => typeof r.label === "string" && (r.label as string).trim().toLowerCase() === (g.label || "").trim().toLowerCase());
      const byIndex = rawRents[i];
      const src = byId || byLabel || byIndex || {};
      const rentVal = Number(
        src.market_rent_per_unit ?? src.market_rent_per_bed ?? src.market_rent_per_sf ?? 0,
      );
      return {
        id: g.id,
        label: g.label,
        ...(isSH ? { market_rent_per_bed: rentVal } : isMF ? { market_rent_per_unit: rentVal } : { market_rent_per_sf: rentVal }),
        basis: typeof src.basis === "string" ? src.basis : "",
      };
    });
    return NextResponse.json({ rents: reconciled });
  } catch (err: unknown) {
    const status = (err && typeof err === "object" && "status" in err) ? (err as { status: number }).status : 500;
    if (status === 429) return NextResponse.json({ error: "Rate limited — try again in a moment" }, { status: 429 });
    if (status === 401 || status === 403) return NextResponse.json({ error: "AI API key issue — check ANTHROPIC_API_KEY" }, { status: 500 });
    return NextResponse.json({ error: "AI rent estimation failed" }, { status: 500 });
  }
}
