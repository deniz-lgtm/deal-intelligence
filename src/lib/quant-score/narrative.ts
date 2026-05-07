// Narrative generator: produces 3 strengths / 3 weaknesses bullets grounded
// in the deterministic factor breakdown + MC summary. Claude is *only* used
// for the prose — it never assigns scores.

import Anthropic from "@anthropic-ai/sdk";
import type { FactorBreakdown } from "./types";
import type { McDistribution } from "./types";

const MODEL = "claude-sonnet-4-6";

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

export interface ScoreNarrative {
  strengths: string[];
  weaknesses: string[];
  generated_at: string;
}

const FALLBACK: ScoreNarrative = {
  strengths: [],
  weaknesses: [],
  generated_at: new Date(0).toISOString(),
};

/**
 * Generate a short narrative for a quant score. Returns a fallback empty
 * narrative on any error so the API call never fails because of the prose
 * step (the deterministic numbers are the source of truth).
 */
export async function generateNarrative(
  breakdown: FactorBreakdown,
  mc: McDistribution | null,
  context: { dealName?: string; strategy?: string | null }
): Promise<ScoreNarrative> {
  try {
    const prompt = buildPrompt(breakdown, mc, context);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20_000);
    let raw = "{}";
    try {
      const response = await getClient().messages.create(
        { model: MODEL, max_tokens: 700, messages: [{ role: "user", content: prompt }] },
        { signal: controller.signal }
      );
      raw = response.content[0]?.type === "text" ? response.content[0].text : "{}";
    } finally {
      clearTimeout(timeoutId);
    }
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return { ...FALLBACK, generated_at: new Date().toISOString() };
    const parsed = JSON.parse(match[0]) as { strengths?: string[]; weaknesses?: string[] };
    return {
      strengths: cleanBullets(parsed.strengths),
      weaknesses: cleanBullets(parsed.weaknesses),
      generated_at: new Date().toISOString(),
    };
  } catch (err) {
    console.warn("quant-score narrative gen failed:", (err as Error).message);
    return { ...FALLBACK, generated_at: new Date().toISOString() };
  }
}

function cleanBullets(arr: unknown): string[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((b): b is string => typeof b === "string" && b.trim().length > 0)
    .map((b) => b.trim().slice(0, 220))
    .slice(0, 3);
}

function buildPrompt(
  breakdown: FactorBreakdown,
  mc: McDistribution | null,
  context: { dealName?: string; strategy?: string | null }
): string {
  const cats = breakdown.categories
    .filter((c) => c.confidence > 0)
    .map((c) => `- ${c.category} score=${c.score.toFixed(1)} (confidence ${(c.confidence * 100).toFixed(0)}%, weight ${(breakdown.weights[c.category] ?? 0).toFixed(1)}%${c.notched ? ", FATAL FLAW notched" : ""})`)
    .join("\n");

  const topInputs = breakdown.categories
    .flatMap((c) => c.inputs.filter((i) => i.score != null).map((i) => ({ ...i, category: c.category })))
    .sort((a, b) => (a.score! - b.score!))
    .slice(0, 6)
    .map((i) => `  • ${i.category}/${i.id}: raw=${i.raw}, score=${i.score}`)
    .join("\n");

  const mcLines = mc
    ? [
        `Monte Carlo (${mc.trials} trials):`,
        `  IRR P10/P50/P90 = ${mc.irr.p10}% / ${mc.irr.p50}% / ${mc.irr.p90}%`,
        `  EM  P10/P50/P90 = ${mc.em.p10}x / ${mc.em.p50}x / ${mc.em.p90}x`,
        `  Prob capital loss = ${(mc.prob_capital_loss * 100).toFixed(1)}%`,
        mc.prob_hit_target_irr != null ? `  Prob hit target IRR = ${(mc.prob_hit_target_irr * 100).toFixed(1)}%` : null,
        mc.prob_refi_failure != null ? `  Prob refi failure = ${(mc.prob_refi_failure * 100).toFixed(1)}%` : null,
        `  CVaR 5% IRR = ${mc.expected_shortfall_5pct}%`,
      ]
        .filter(Boolean)
        .join("\n")
    : "Monte Carlo: not run for this stage.";

  return `You are an institutional real-estate analyst. Write 3 STRENGTHS and 3 WEAKNESSES of this deal grounded ONLY in the deterministic numbers below. Do not invent facts. Each bullet must reference a specific score, percentile, or probability from the data — short and concrete (≤25 words). Do not assign new scores.

Deal: ${context.dealName || "(unnamed)"}
Strategy: ${context.strategy || "n/a"}
Composite: ${breakdown.composite} (${breakdown.band}, confidence ${(breakdown.confidence * 100).toFixed(0)}%)

Category scores:
${cats}

Lowest input subscores:
${topInputs}

${mcLines}

Return ONLY a JSON object:
{
  "strengths": ["bullet 1", "bullet 2", "bullet 3"],
  "weaknesses": ["bullet 1", "bullet 2", "bullet 3"]
}`;
}
