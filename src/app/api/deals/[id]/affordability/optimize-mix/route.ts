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
  max_rents?: {
    studio?: number;
    one_br?: number;
    two_br?: number;
    three_br?: number;
    four_br_plus?: number;
  };
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
      ? `Building unit mix: studio=${mix.studio}, 1BR=${mix.one_br}, 2BR=${mix.two_br}, 3BR=${mix.three_br}, 4BR+=${mix.four_br_plus}`
      : "Building unit mix: not provided";

    const modeInstructions =
      mode === "flexible"
        ? `Mode: FLEXIBLE. You must allocate exactly ${unitsCount} affordable units across the BR types. The mix can be anything — biased toward the type that maximizes revenue at the given max rents, but balanced with what's actually marketable in this submarket (e.g. don't recommend 100% 3BR if the building is mostly studios — leasing risk is real).`
        : mode === "match_building"
        ? `Mode: MATCH BUILDING. You must allocate exactly ${unitsCount} affordable units in proportions as close as possible to the building's own BR mix. The affordable tier should not materially skew the building's unit mix.`
        : `Mode: BEDROOM EQUIVALENT. Target is exactly ${bedroomTarget} total BEDROOMS across the allocated units (studio=0, 1BR=1, 2BR=2, 3BR=3, 4BR+=4). The unit count is free — you can trade unit count for bedroom count. Maximize revenue subject to hitting the bedroom target exactly (or as close as the math permits; if exact isn't possible, prefer slightly over).`;

    const prompt = `You are a multifamily underwriter picking the affordable-unit BR mix for a tier at ${
      body.ami_pct ?? 60
    }% AMI.

${dealContext}
${buildingMixLine}

Max allowed monthly rents at this AMI tier (per unit, per month):
  Studio: ${rents.studio ?? 0}
  1BR:    ${rents.one_br ?? 0}
  2BR:    ${rents.two_br ?? 0}
  3BR:    ${rents.three_br ?? 0}
  4BR+:   ${rents.four_br_plus ?? 0}

${modeInstructions}

Produce a BR allocation that maximizes total annual rental revenue from this
tier while staying realistic for the submarket. Return ONLY this JSON:

{
  "studio": <int>,
  "one_br": <int>,
  "two_br": <int>,
  "three_br": <int>,
  "four_br_plus": <int>,
  "rationale": "<one sentence explaining the tradeoff you made>"
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
