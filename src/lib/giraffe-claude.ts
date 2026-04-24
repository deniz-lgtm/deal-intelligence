/**
 * Claude fallback for unknown Giraffe GeoJSON property keys.
 *
 * The strict synonym table in `giraffe.ts` covers well-known keys
 * (site_area_sf, far, unit_count, etc.). When Giraffe — or a user's
 * custom attribute — ships a property name we haven't seen, we hand
 * the (key, value) pair set to Claude and ask it to propose mappings
 * onto our schema. The analyst confirms in the preview before
 * anything lands.
 *
 * This call is best-effort: if it fails or returns nothing useful,
 * the importer falls back to what the strict parser already captured.
 */

import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-sonnet-4-6";

function getClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

export type GiraffeMappedField =
  | "site_area_sf"
  | "far"
  | "height_ft"
  | "height_stories"
  | "lot_coverage_pct"
  | "unit_count"
  | "unit_mix"
  | "parking_spaces"
  | "parking_type"
  | "parking_ratio_residential"
  | "parking_ratio_commercial"
  | "setback_front"
  | "setback_side"
  | "setback_rear"
  | "setback_corner"
  | "footprint_sf"
  | "floors";

export interface GiraffeKeyMapping {
  original_key: string;
  mapped_to: GiraffeMappedField | null;
  value: number | string;
  confidence: "high" | "medium" | "low";
}

const SYSTEM_PROMPT = `You map unknown GeoJSON property keys from a Giraffe feasibility-study export onto a fixed set of real-estate-development fields.

Input: a JSON object of { propertyKey: propertyValue } pairs we couldn't match via synonyms.

Output: a JSON object { "mappings": [ ... ] } where each entry is:
{
  "original_key": "<exact key from input>",
  "mapped_to": "<one of the allowed fields, or null if no good match>",
  "value": <number or string, echoed from input>,
  "confidence": "high" | "medium" | "low"
}

Allowed target fields and what each means:
- "site_area_sf"               — total parcel area in square feet
- "far"                        — floor-area ratio (unitless, e.g. 3.2)
- "height_ft"                  — allowed or proposed building height in feet
- "height_stories"             — allowed or proposed number of stories
- "lot_coverage_pct"           — percent of parcel covered by buildings (0-100 or 0-1)
- "unit_count"                 — total residential unit count for a building
- "parking_spaces"             — total parking stall count
- "parking_type"               — one of surface / structured / underground
- "parking_ratio_residential"  — spaces per dwelling unit
- "parking_ratio_commercial"   — spaces per 1000 sf commercial
- "setback_front"              — front yard setback, feet
- "setback_side"               — side yard setback, feet
- "setback_rear"               — rear yard setback, feet
- "setback_corner"             — corner side setback, feet
- "footprint_sf"               — building ground-floor footprint, SF
- "floors"                     — number of floors in the building

Rules:
- Only map a key if the meaning is fairly clear from name + value. If in doubt, set "mapped_to": null and "confidence": "low".
- "unit_mix" is complex (arrays of objects) — skip it here; the caller handles unit mix separately.
- Do NOT invent values. Echo the value verbatim from the input (rounded if it's a formatted string like "87,120 sf", in which case the numeric value goes in "value").
- Percentages given as 0.65 or "65%" should both land as 65 in lot_coverage_pct.
- Return JSON only — no markdown fences, no prose.`;

async function withRetry<T>(fn: () => Promise<T>, attempts = 2, baseDelayMs = 600): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, baseDelayMs * (i + 1)));
    }
  }
  throw lastErr;
}

function parseResponse(text: string): GiraffeKeyMapping[] {
  let payload = text.trim();
  if (payload.startsWith("```")) {
    payload = payload.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  }
  const firstBrace = payload.indexOf("{");
  if (firstBrace > 0) payload = payload.slice(firstBrace);
  const parsed = JSON.parse(payload) as { mappings?: unknown };
  if (!Array.isArray(parsed.mappings)) return [];
  return parsed.mappings.filter(
    (m): m is GiraffeKeyMapping =>
      typeof m === "object" &&
      m !== null &&
      typeof (m as GiraffeKeyMapping).original_key === "string"
  );
}

/**
 * Propose mappings for unknown Giraffe property keys. Returns an empty
 * array if the pair set is empty, the call fails, or nothing parses —
 * callers treat this as "no additional mappings" and fall back to the
 * strict parser's output alone.
 */
export async function proposeGiraffeKeyMappings(
  unknownProps: Record<string, unknown>
): Promise<GiraffeKeyMapping[]> {
  const keys = Object.keys(unknownProps);
  if (keys.length === 0) return [];

  const client = getClient();
  try {
    const result = await withRetry(async () => {
      const res = await client.messages.create({
        model: MODEL,
        max_tokens: 1500,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: `Map these unknown GeoJSON properties:\n\n${JSON.stringify(unknownProps, null, 2)}`,
          },
        ],
      });
      const block = res.content.find((b) => b.type === "text");
      if (!block || block.type !== "text") throw new Error("No text in model response");
      return block.text;
    });
    return parseResponse(result);
  } catch (e) {
    console.error("giraffe-claude: mapping failed:", e);
    return [];
  }
}
