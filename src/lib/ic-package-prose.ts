/**
 * IC Package · Prose Generator
 *
 * Calls Claude to turn structured deal context into editorial-quality
 * prose sections for an IC package. Voice is conversational, specific,
 * and numerate — the opposite of typical bullet-pointed pitch decks.
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  DealContext,
  ProseSections,
  ThesisCard,
  BusinessPhase,
  RiskFactor,
  CalloutProps,
  Scenario,
} from "@/app/deals/[id]/ic-package/types";
import { getActiveModel, getPrompt } from "./claude";

const DEFAULT_SYSTEM_PROMPT = `You are writing investment committee package prose for a real estate developer's institutional-grade IC package. Your job is to take structured deal data and produce prose that reads like a senior developer wrote it for thoughtful capital partners over coffee — confident, clear, conversational, and precise.

## Voice Rules

1. Write in declarative sentences. Vary sentence length deliberately.
2. Use em-dashes for asides — like this — to add texture.
3. Italicize the single most important phrase per paragraph for emphasis. Use sparingly.
4. Avoid bullet points. Always prefer prose paragraphs.
5. Avoid corporate jargon: "leverage," "synergies," "value-add opportunity" without specifics, "robust," "best-in-class," "differentiated platform."
6. Replace jargon with specific, concrete claims backed by numbers.
7. Acknowledge tradeoffs and counterarguments. Sophisticated readers respect nuance.
8. Never oversell. If a deal has weaknesses, name them honestly. Confidence comes from honest framing, not from puffery.

## Structural Rules

1. Lead with the strongest argument first. Do not bury the lede.
2. One idea per paragraph. Tight paragraphs read better than dense ones.
3. Numbers are characters in the story. Use them to support claims, not as decoration.
4. End sections with forward momentum, not summary.

## Format Rules

- For italics, wrap the emphasized phrase in <em> tags directly in the prose.
- For bold, use <strong> tags. Use bold sparingly.
- Do not use markdown.
- Every prose string you return must be valid HTML fragments — paragraphs wrapped in <p>...</p> where multiple paragraphs are expected.
- Return JSON and JSON only. No prefatory text, no trailing commentary.

## Tone Examples

GOOD: "Oakland multifamily has spent the last 24 months absorbing a painful correction. <em>That correction is largely complete.</em> Cap rates have stabilized in the 5.25–5.75% range for stabilized B-class product, lender appetite is returning at modest LTVs, and rents have held flat for three consecutive quarters."

BAD: "We see significant value-add opportunity in the Oakland multifamily market driven by favorable market dynamics including stabilizing cap rates and improving lending conditions."

GOOD: "The deal works on flat market rents — any rent recovery is upside, not requirement."

BAD: "Our underwriting is conservative and we believe the deal has multiple paths to attractive returns."

The first of each pair is specific, confident, and earns the reader's attention. The second is generic, hedged, and reads like every other pitch deck.`;

const USER_TEMPLATE = `## Sections to Generate

Generate the following sections for the deal context provided. Return JSON matching the schema at the end.

1. **execHeadlineHtml** — one sentence, max 14 words, with exactly one <em>...</em> phrase. The thesis in one breath.

2. **execBodyHtml** — 3–5 sentences inside a single <p>...</p>. Answer: what are we buying, why now, what's the return profile. Use one <em> phrase for emphasis.

3. **marketThesisHtml** — 2–3 paragraphs, each wrapped in <p>...</p>. Why this market, why this asset type, why this moment in the cycle. Reference specific market data points.

4. **thesisCards** — exactly 3 cards. Each with:
   - pill: short category label (e.g. "Basis", "Seller", "Operations")
   - headlineHtml: short headline with one <em>word</em> for emphasis
   - bodyHtml: 2–3 sentence paragraph wrapped in <p>...</p>

5. **businessPlan** — exactly 4 phases. Each with:
   - headlineHtml: bold lead-in like "Months 0–6 · Take Possession and Stabilize"
   - bodyHtml: detail paragraph (not wrapped in <p>; it flows inline)
   Follow structure: Acquire → Execute → Stabilize/Refinance → Operate/Exit.

6. **risks** — exactly 6 risks. Each with:
   - name: short risk title
   - descriptionHtml: 1–2 sentences naming the risk AND the mitigation (not wrapped in <p>)
   Be honest. Name real risks, not strawmen.

7. **callouts** — exactly 2 key insights to highlight between sections. Each with:
   - label: short all-caps style label (will be rendered uppercase, so write it like "The Underwriting Discipline")
   - bodyHtml: 2–3 sentences wrapped in <p>...</p>
   First callout belongs after the market thesis; second belongs after the scenario analysis.

8. **askParagraphsHtml** — exactly 2 short paragraphs, each wrapped in <p>...</p>. The specific capital ask, deadline, and next steps. Use <em> on the dollar amount and the deadline date. Use <strong> on secondary dollar figures.

9. **scenarios** — exactly 3 scenarios in order: upside, base, downside. Each with:
   - variant: "upside" | "base" | "downside"
   - label: "Scenario · Upside" / "Scenario · Base" / "Scenario · Downside"
   - headlineHtml: short headline with one <em>word</em>
   - narrativeHtml: one short paragraph wrapped in <p>...</p>
   - stats: array of exactly 3 {label, value} pairs — Levered IRR, Equity Multiple, Hold

## JSON Schema

{
  "execHeadlineHtml": "string",
  "execBodyHtml": "string",
  "marketThesisHtml": "string",
  "thesisCards": [{"pill": "string", "headlineHtml": "string", "bodyHtml": "string"}, ...],
  "businessPlan": [{"headlineHtml": "string", "bodyHtml": "string"}, ...],
  "risks": [{"name": "string", "descriptionHtml": "string"}, ...],
  "callouts": [{"label": "string", "bodyHtml": "string"}, ...],
  "askParagraphsHtml": ["string", "string"],
  "scenarios": [{"variant": "upside"|"base"|"downside", "label": "string", "headlineHtml": "string", "narrativeHtml": "string", "stats": [{"label":"string","value":"string"}, ...]}, ...]
}

## Deal Context

DEAL_CONTEXT_JSON`;

function formatDealContext(ctx: DealContext): string {
  return JSON.stringify(
    {
      dealName: ctx.dealName,
      propertyType: ctx.propertyType,
      location: ctx.location,
      unitCount: ctx.unitCount,
      squareFootage: ctx.squareFootage,
      yearBuilt: ctx.yearBuilt,
      investmentStrategy: ctx.investmentStrategy,
      economics: {
        purchasePrice: ctx.purchasePrice,
        pricePerUnit: ctx.pricePerUnit,
        goingInCap: ctx.goingInCap,
        stabilizedYOC: ctx.stabilizedYOC,
        leveredIRR: ctx.leveredIRR,
        equityMultiple: ctx.equityMultiple,
        holdPeriod: ctx.holdPeriod,
      },
      capitalStack: ctx.capitalStack,
      marketContext: ctx.marketContext ?? null,
      sellerContext: ctx.sellerContext ?? null,
      businessPlanSummary: ctx.businessPlanSummary ?? null,
      customNotes: ctx.customNotes ?? null,
    },
    null,
    2
  );
}

function extractJson(text: string): unknown {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON object found in Claude response");
  return JSON.parse(match[0]);
}

function validate(parsed: unknown): ProseSections {
  const obj = parsed as Record<string, unknown>;
  const req = [
    "execHeadlineHtml",
    "execBodyHtml",
    "marketThesisHtml",
    "thesisCards",
    "businessPlan",
    "risks",
    "callouts",
    "askParagraphsHtml",
    "scenarios",
  ];
  for (const k of req) {
    if (!(k in obj)) throw new Error(`Missing field from prose response: ${k}`);
  }
  return {
    execHeadlineHtml: String(obj.execHeadlineHtml),
    execBodyHtml: String(obj.execBodyHtml),
    marketThesisHtml: String(obj.marketThesisHtml),
    thesisCards: obj.thesisCards as ThesisCard[],
    businessPlan: obj.businessPlan as BusinessPhase[],
    risks: obj.risks as RiskFactor[],
    callouts: obj.callouts as CalloutProps[],
    askParagraphsHtml: obj.askParagraphsHtml as string[],
    scenarios: obj.scenarios as Scenario[],
  };
}

export async function generateProse(ctx: DealContext): Promise<ProseSections> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const model = await getActiveModel();
  const systemPrompt = await getPrompt(
    "ic_package.prose_system",
    "IC Package Prose — System Prompt",
    DEFAULT_SYSTEM_PROMPT,
    "System prompt for the IC package prose generator. Controls voice, structure, and output format."
  );

  const userMessage = USER_TEMPLATE.replace("DEAL_CONTEXT_JSON", formatDealContext(ctx));

  const response = await client.messages.create({
    model,
    max_tokens: 4000,
    temperature: 0.75,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Empty response from Claude");
  }

  return validate(extractJson(textBlock.text));
}

/**
 * Regenerate a single section. Useful for the editor's per-section
 * "Regenerate" buttons. Returns just the requested section's prose.
 */
export async function regenerateSection(
  ctx: DealContext,
  section:
    | "exec"
    | "marketThesis"
    | "thesisCards"
    | "businessPlan"
    | "risks"
    | "callouts"
    | "ask"
    | "scenarios"
): Promise<Partial<ProseSections>> {
  // Simplest implementation: regenerate everything, return only the
  // requested fields. Avoids drift from single-section prompts diverging
  // from the overall voice. If/when cost becomes a concern, split this
  // into per-section prompts.
  const all = await generateProse(ctx);
  switch (section) {
    case "exec":
      return { execHeadlineHtml: all.execHeadlineHtml, execBodyHtml: all.execBodyHtml };
    case "marketThesis":
      return { marketThesisHtml: all.marketThesisHtml };
    case "thesisCards":
      return { thesisCards: all.thesisCards };
    case "businessPlan":
      return { businessPlan: all.businessPlan };
    case "risks":
      return { risks: all.risks };
    case "callouts":
      return { callouts: all.callouts };
    case "ask":
      return { askParagraphsHtml: all.askParagraphsHtml };
    case "scenarios":
      return { scenarios: all.scenarios };
  }
}
