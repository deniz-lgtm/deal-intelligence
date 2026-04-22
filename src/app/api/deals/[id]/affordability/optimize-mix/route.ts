import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getActiveModel } from "@/lib/claude";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { dealQueries } from "@/lib/db";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

/**
 * POST /api/deals/[id]/affordability/optimize-mix
 *
 * Given an affordable tier's constraints (mode, target, max rents) and the
 * subject building's own unit mix, ask Claude to recommend the BR
 * distribution that maximizes revenue while staying marketable in this
 * submarket. Returns { mix, rationale } — the client applies the mix to the
 * tier directly.
 *
 * We run Claude with structured output; the deterministic fallback (not
 * invoked here — that lives client-side as solveFlexibleMaxRevenue /
 * solveBedroomEquivalentMaxRevenue) can be used by the UI if this endpoint
 * fails.
 */

type MixMode = "flexible" | "match_building" | "bedroom_equivalent";

interface OptimizeBody {
  mix_mode?: MixMode;
  units_count?: number;
  bedroom_target?: number;
  ami_pct?: number;
  building_unit_mix?: {
    studio: number;
    one_br: number;
    two_br: number;
    three_br: number;
    four_br_plus: number;
  } | null;
  avg_sf_per_br?: {
    studio: number;
    one_br: number;
    two_br: number;
    three_br: number;
    four_br_plus: number;
  } | null;
  max_rents?: {
    studio?: number;
    one_br?: number;
    two_br?: number;
    three_br?: number;
    four_br_plus?: number;
  };
  avg_market_rent?: number;
  current_taxes?: number;
  tax_exemption_enabled?: boolean;
  tax_exemption_pct?: number;
  tax_exemption_years?: number;
  total_units?: number;
  affordable_units?: number;
}

interface OptimizedMix {
  studio: number;
  one_br: number;
  two_br: number;
  three_br: number;
  four_br_plus: number;
  rationale: string;
}

function clampNonNeg(n: unknown): number {
  const v = Math.max(0, Math.round(Number(n) || 0));
  return Number.isFinite(v) ? v : 0;
}

function parseJsonFromResponse(text: string): Partial<OptimizedMix> | null {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as Partial<OptimizedMix>;
  } catch {
    return null;
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(
      params.id,
      userId
    );
    if (accessError) return accessError;

    const body = (await req.json()) as OptimizeBody;
    const mode: MixMode = body.mix_mode ?? "flexible";
    const unitsCount = Math.max(0, Math.round(body.units_count ?? 0));
    const bedroomTarget = Math.max(0, Math.round(body.bedroom_target ?? 0));
    const rents = body.max_rents ?? {};
    const mix = body.building_unit_mix ?? null;
    const sf = body.avg_sf_per_br ?? null;

    if (mode === "bedroom_equivalent" && bedroomTarget <= 0) {
      return NextResponse.json(
        { error: "bedroom_target is required in bedroom_equivalent mode" },
        { status: 400 }
      );
    }
    if (mode !== "bedroom_equivalent" && unitsCount <= 0) {
      return NextResponse.json(
        { error: "units_count is required" },
        { status: 400 }
      );
    }

    // Context about the deal helps Claude reason about submarket norms
    // (urban Class A leans 1BR / studio; suburban garden leans 2BR / 3BR).
    const deal = await dealQueries.getById(params.id);
    const dealContext = [
      deal?.name ? `Deal: ${deal.name}` : null,
      [deal?.address, deal?.city, deal?.state].filter(Boolean).join(", ") ||
        null,
      deal?.property_type ? `Type: ${deal.property_type}` : null,
      deal?.year_built ? `Built: ${deal.year_built}` : null,
    ]
      .filter(Boolean)
      .join(" · ");

    const buildingMixLine = mix
      ? `Building unit mix (market-rate): studio=${mix.studio}, 1BR=${mix.one_br}, 2BR=${mix.two_br}, 3BR=${mix.three_br}, 4BR+=${mix.four_br_plus}`
      : "Building unit mix: not provided";

    // Compute rent/SF at AMI cap for each BR type when SF is available.
    // This is the primary optimization metric — we want the highest $/SF
    // affordable mix, not just the highest $/unit, because SF is the
    // scarce resource in a fixed building envelope.
    const rentPerSfLines: string[] = [];
    const brTypes = [
      { label: "Studio", rent: rents.studio ?? 0, sfv: sf?.studio ?? 0 },
      { label: "1BR",    rent: rents.one_br ?? 0, sfv: sf?.one_br ?? 0 },
      { label: "2BR",    rent: rents.two_br ?? 0, sfv: sf?.two_br ?? 0 },
      { label: "3BR",    rent: rents.three_br ?? 0, sfv: sf?.three_br ?? 0 },
      { label: "4BR+",   rent: rents.four_br_plus ?? 0, sfv: sf?.four_br_plus ?? 0 },
    ];
    for (const t of brTypes) {
      if (t.sfv > 0 && t.rent > 0) {
        rentPerSfLines.push(
          `  ${t.label}: $${t.rent}/mo, ${t.sfv} SF avg → $${(t.rent / t.sfv).toFixed(2)}/SF/mo at AMI cap`
        );
      } else if (t.rent > 0) {
        rentPerSfLines.push(`  ${t.label}: $${t.rent}/mo (SF unknown)`);
      }
    }

    // Annual tax savings from the property-tax exemption, pro-rated to this
    // tier. If the exemption is enabled, adding MORE affordable units of a
    // given BR type also increases the tax benefit — factor that in.
    const taxSavingsLine = (() => {
      const enabled = body.tax_exemption_enabled ?? false;
      const exemptPct = body.tax_exemption_pct ?? 0;
      const taxes = body.current_taxes ?? 0;
      const totalU = body.total_units ?? 0;
      const affU = body.affordable_units ?? 0;
      if (!enabled || exemptPct <= 0 || taxes <= 0 || totalU <= 0) return null;
      const annualSavings = Math.round(taxes * (affU / totalU) * (exemptPct / 100));
      return `Property tax exemption: ${exemptPct}% reduction on ${Math.round((affU / totalU) * 100)}% affordable share → ~$${annualSavings.toLocaleString()}/yr savings. Mixing in unit types that use less SF (e.g., studios) lets more affordable UNITS fit, amplifying this benefit.`;
    })();

    const avgMarketRentLine = body.avg_market_rent && body.avg_market_rent > 0
      ? `Average market rent: $${Math.round(body.avg_market_rent)}/unit/mo — affordable units trade against this.`
      : null;

    const modeInstructions =
      mode === "flexible"
        ? `Mode: FLEXIBLE. Allocate exactly ${unitsCount} affordable units across BR types. Primary objective: maximise rent/SF (dollars per square foot per month at the AMI cap). Secondary: avoid a mix that's operationally unrealistic for this submarket (e.g. all 3BR in a studio-heavy urban asset).`
        : mode === "match_building"
        ? `Mode: MATCH BUILDING. Allocate exactly ${unitsCount} affordable units in proportions as close as possible to the building's own BR mix. The affordable tier should not materially skew the building's unit mix.`
        : `Mode: BEDROOM EQUIVALENT. Target is exactly ${bedroomTarget} total BEDROOMS (studio=0, 1BR=1, 2BR=2, 3BR=3, 4BR+=4). Unit count is free — trade units for bedrooms. Maximise rent/SF at the AMI cap subject to hitting the bedroom target (prefer slightly over if exact isn't achievable).`;

    const prompt = `You are a multifamily underwriter optimising the affordable-unit BR mix for a tier at ${
      body.ami_pct ?? 60
    }% AMI. Your primary goal is to maximise rent per square foot ($/SF/mo) within the AMI rent caps — not just $/unit — while keeping the mix marketable and operationally realistic.

${dealContext}
${buildingMixLine}

AMI max rents and rent/SF at AMI cap:
${rentPerSfLines.length > 0 ? rentPerSfLines.join("\n") : "  (SF data unavailable — optimise on $/unit instead)"}

${avgMarketRentLine ?? ""}
${taxSavingsLine ? `\n${taxSavingsLine}` : ""}

${modeInstructions}

Return ONLY this JSON:

{
  "studio": <int>,
  "one_br": <int>,
  "two_br": <int>,
  "three_br": <int>,
  "four_br_plus": <int>,
  "rationale": "<one sentence: which BR type has the best $/SF at this AMI level and why you chose this mix>"
}

Rules:
- All counts are non-negative integers.
- No markdown fences, no extra text — just the JSON object.`;

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: await getActiveModel(),
      max_tokens: 512,
      messages: [{ role: "user", content: prompt }],
    });

    const raw =
      response.content[0]?.type === "text" ? response.content[0].text : "";
    const parsed = parseJsonFromResponse(raw);
    if (!parsed) {
      return NextResponse.json(
        { error: "Failed to parse AI response" },
        { status: 502 }
      );
    }

    const result = {
      studio: clampNonNeg(parsed.studio),
      one_br: clampNonNeg(parsed.one_br),
      two_br: clampNonNeg(parsed.two_br),
      three_br: clampNonNeg(parsed.three_br),
      four_br_plus: clampNonNeg(parsed.four_br_plus),
    };
    const rationale =
      typeof parsed.rationale === "string"
        ? parsed.rationale.slice(0, 500)
        : "";

    return NextResponse.json({
      data: { mix: result, rationale },
    });
  } catch (error) {
    console.error("POST /api/deals/[id]/affordability/optimize-mix error:", error);
    return NextResponse.json(
      { error: "Failed to optimize mix" },
      { status: 500 }
    );
  }
}
