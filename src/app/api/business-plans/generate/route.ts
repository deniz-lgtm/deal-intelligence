import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-sonnet-4-5";

function parseJson<T>(raw: string, fallback: T): T {
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return fallback;
    return JSON.parse(match[0]) as T;
  } catch {
    return fallback;
  }
}

/**
 * POST /api/business-plans/generate
 * Quick AI-generated business plan from a brief description.
 *
 * Body: { description: string }
 * e.g. "Value-add multifamily in Texas, 100-300 units, 3-5 year hold"
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { description } = body as { description: string };

    if (!description?.trim()) {
      return NextResponse.json({ error: "Description is required" }, { status: 400 });
    }

    const prompt = `You are a commercial real estate investment strategist. Based on the brief description below, generate a complete business plan configuration.

DESCRIPTION: "${description.trim()}"

Generate a structured business plan with all fields filled in. Infer everything you can from the description — property types, markets, strategy, return targets, hold period.

Return ONLY a JSON object:
{
  "name": "Short plan name (3-6 words, e.g. 'Texas MF Value-Add Fund')",
  "description": "1-2 sentence investment thesis description",
  "investment_theses": ["value_add"],
  "target_markets": ["DFW", "Houston", "San Antonio"],
  "property_types": ["multifamily"],
  "hold_period_min": 3,
  "hold_period_max": 5,
  "target_irr_min": 15,
  "target_irr_max": 22,
  "target_equity_multiple_min": 1.7,
  "target_equity_multiple_max": 2.2
}

Rules:
- investment_theses: array of one or more from: value_add, ground_up, core, core_plus, opportunistic
- target_markets: array of major metro areas (use common abbreviations like DFW, not "Dallas-Fort Worth")
- property_types: array from: industrial, office, retail, multifamily, student_housing, mixed_use, land, hospitality, other
- Return targets should be realistic for the strategy:
  - Core: IRR 6-10%, EM 1.3-1.6x
  - Core-Plus: IRR 8-14%, EM 1.4-1.8x
  - Value-Add: IRR 14-22%, EM 1.7-2.5x
  - Opportunistic: IRR 18-30%, EM 2.0-3.0x
  - Ground-Up: IRR 18-25%, EM 2.0-2.8x
- Be specific about markets — don't just say "Sunbelt", list actual metros
- Respond with ONLY the JSON object`;

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = response.content[0].type === "text" ? response.content[0].text : "{}";
    const plan = parseJson(raw, {
      name: "New Business Plan",
      description: description.trim(),
      investment_theses: [],
      target_markets: [],
      property_types: [],
      hold_period_min: null,
      hold_period_max: null,
      target_irr_min: null,
      target_irr_max: null,
      target_equity_multiple_min: null,
      target_equity_multiple_max: null,
    });

    return NextResponse.json({ data: plan });
  } catch (error) {
    console.error("POST /api/business-plans/generate error:", error);
    return NextResponse.json({ error: "Generation failed" }, { status: 500 });
  }
}
