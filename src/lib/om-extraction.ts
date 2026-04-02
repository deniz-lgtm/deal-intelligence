/**
 * OM Intelligence — Full 4-Stage Extraction Pipeline
 * Prompts ported from om-intelligence-backend, adapted for Deal Intelligence.
 */

import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-sonnet-4-5";

function getClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PropertyDetails {
  name: string | null;
  address: string | null;
  property_type: string | null;
  year_built: number | null;
  sf: number | null;
  unit_count: number | null;
}

export interface FinancialMetrics {
  asking_price: number | null;
  noi: number | null;
  cap_rate: number | null;
  grm: number | null;
  cash_on_cash: number | null;
  irr: number | null;
  equity_multiple: number | null;
  dscr: number | null;
  vacancy_rate: number | null;
  expense_ratio: number | null;
  price_per_sf: number | null;
  price_per_unit: number | null;
}

export interface Assumptions {
  rent_growth: string | null;
  hold_period: string | null;
  leverage: string | null;
  exit_cap_rate: string | null;
}

export interface RedFlag {
  severity: "critical" | "high" | "medium" | "low";
  category: string;
  description: string;
  recommendation: string;
}

export interface OmFullResult {
  property_details: PropertyDetails;
  financial_metrics: FinancialMetrics;
  assumptions: Assumptions;
  red_flags: RedFlag[];
  deal_score: number;
  score_reasoning: string;
  summary: string;
  recommendations: string[];
  model_used: string;
  tokens_used: number;
  cost_estimate: number;
  processing_ms: number;
}

// Legacy type for backwards compat with deals table
export interface OmExtracted {
  asking_price?: number;
  sf?: number;
  units?: number;
  rent_per_sf?: number;
  cap_rate?: number;
  year_built?: number;
  noi?: number;
  occupancy?: number;
  hold_period?: number;
  address?: string;
}

export interface OmExtractionResult {
  om_score: number;
  om_extracted: OmExtracted;
  red_flags: RedFlag[];
  raw_text_preview: string;
  full_result: OmFullResult;
}

// ─── Retry helper ─────────────────────────────────────────────────────────────

async function withRetry<T>(
  fn: () => Promise<T>,
  attempts = 3,
  baseDelayMs = 1000
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, baseDelayMs * Math.pow(2, i)));
      }
    }
  }
  throw lastErr;
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    const match = raw.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (!match) return fallback;
    const cleaned = match[0]
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
    return JSON.parse(cleaned) as T;
  } catch {
    return fallback;
  }
}

// ─── Stage 1 — Metrics Extraction ────────────────────────────────────────────

async function extractMetrics(text: string): Promise<{
  property_details: PropertyDetails;
  financial_metrics: FinancialMetrics;
  assumptions: Assumptions;
  tokensUsed: number;
}> {
  const snippet = text.slice(0, 16000);

  const prompt = `You are an expert commercial real estate analyst. Extract all financial metrics and property details from this document. It may be an Offering Memorandum, a Rent Roll, or another financial document.

If this is a RENT ROLL: extract the total number of units/suites, total square footage (sum of all unit SFs), and compute total annual rent (sum of monthly rents × 12). Set unit_count = total units, sf = total SF, and noi = total annual rent minus a reasonable vacancy estimate.

DOCUMENT TEXT:
${snippet}

Extract and return ONLY a JSON object with this exact structure. Use null for any value you cannot find with confidence:

{
  "property_details": {
    "name": "property name or null",
    "address": "full street address or null",
    "property_type": "industrial|office|retail|multifamily|mixed_use|hospitality|land|other or null",
    "year_built": 2005,
    "sf": 45000,
    "unit_count": null
  },
  "financial_metrics": {
    "asking_price": 5500000,
    "noi": 385000,
    "cap_rate": 0.07,
    "grm": null,
    "cash_on_cash": null,
    "irr": null,
    "equity_multiple": null,
    "dscr": null,
    "vacancy_rate": 0.05,
    "expense_ratio": null,
    "price_per_sf": null,
    "price_per_unit": null
  },
  "assumptions": {
    "rent_growth": "3% annually or null",
    "hold_period": "7 years or null",
    "leverage": "65% LTV or null",
    "exit_cap_rate": "7.5% or null"
  }
}

Rules:
- cap_rate, vacancy_rate, expense_ratio as decimals (0.07 = 7%)
- All dollar values as integers/floats (no $ signs, no commas)
- If value has units (M, K) convert to full number
- Respond with ONLY the JSON object, no explanation`;

  const response = await withRetry(() =>
    getClient().messages.create({
      model: MODEL,
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    })
  );

  const raw = response.content[0].type === "text" ? response.content[0].text : "{}";
  const parsed = parseJson<{
    property_details: PropertyDetails;
    financial_metrics: FinancialMetrics;
    assumptions: Assumptions;
  }>(raw, {
    property_details: { name: null, address: null, property_type: null, year_built: null, sf: null, unit_count: null },
    financial_metrics: { asking_price: null, noi: null, cap_rate: null, grm: null, cash_on_cash: null, irr: null, equity_multiple: null, dscr: null, vacancy_rate: null, expense_ratio: null, price_per_sf: null, price_per_unit: null },
    assumptions: { rent_growth: null, hold_period: null, leverage: null, exit_cap_rate: null },
  });

  return {
    property_details: parsed.property_details,
    financial_metrics: parsed.financial_metrics,
    assumptions: parsed.assumptions,
    tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
  };
}

// ─── Stage 2 — Red Flags ──────────────────────────────────────────────────────

async function analyzeRedFlags(
  text: string,
  metrics: FinancialMetrics,
  propertyDetails: PropertyDetails,
  dealContext?: string
): Promise<{ red_flags: RedFlag[]; tokensUsed: number }> {
  const snippet = text.slice(0, 10000);

  const metricsContext = JSON.stringify(
    { ...metrics, ...propertyDetails },
    null,
    2
  );

  const contextBlock = dealContext?.trim()
    ? `\nINVESTOR'S BUSINESS PLAN & CONTEXT (CRITICAL — read before flagging anything):\n${dealContext.trim()}\n\nIMPORTANT: The investor has described their strategy above. Conditions that are INTENTIONAL parts of their plan (e.g. vacancy on a value-add play, missing leases on a vacant building, no rent roll for a repositioning) should NOT be flagged as critical or high issues. Only flag things that are genuinely unexpected risks given this strategy, or material issues the investor hasn't acknowledged.\n`
    : "";

  const prompt = `You are a deal associate working inside Deal Intelligence, a CRE acquisition platform. You are reviewing this OM at the initial screening stage — before underwriting, before site visits, before full due diligence. The acquisition team will run their own underwriting model, commission Phase I environmental, conduct a physical inspection, and verify title and zoning in later diligence stages. Do not flag items that will be covered in standard post-LOI diligence. At this stage brokers rarely share full financials, rent rolls, or CapEx budgets — that is expected and is not a red flag.

Focus only on issues that are genuinely material right now: things that could kill this deal or that need an answer before making an offer.
${contextBlock}
EXTRACTED METRICS:
${metricsContext}

OM TEXT:
${snippet}

Identify red flags in these categories — only flag genuine issues, not standard missing-information gaps:
- Financial (asking price dramatically disconnected from metrics, clearly fabricated NOI, unsupportable projections)
- Physical (known major structural issues, active environmental contamination, specific deferred maintenance called out)
- Legal (active litigation, deed restrictions that limit the intended use, known title clouds)
- Market (location-specific issues that would fundamentally undermine the strategy — e.g. zoning prohibits intended use)
- Tenant (only flag if leases exist and there is a specific concentration or credit concern)

Return ONLY a JSON array. If there are no genuine red flags in a category, omit it entirely. Keep the list short — 3–6 flags is normal at OM stage:
[
  {
    "severity": "critical|high|medium|low",
    "category": "Financial|Physical|Legal|Market|Tenant",
    "description": "Specific issue with supporting details from the document",
    "recommendation": "Exactly what to do next — and which workflow step handles it: 'Flag for underwriting model' / 'Add to diligence checklist' / 'Raise before LOI' / 'Verify on site visit'"
  }
]

Severity guide:
- critical: Stop pursuit now — this contradicts the strategy or is an outright deal-breaker
- high: Get an answer before submitting an LOI
- medium: Track through underwriting and diligence
- low: Note for site visit or diligence checklist

Do NOT flag: missing rent rolls on vacant buildings, absence of broker CapEx estimates, standard missing financials, items that will be addressed in post-LOI diligence, or conditions the investor's business plan explicitly accounts for.

Respond with ONLY the JSON array.`;

  const response = await withRetry(() =>
    getClient().messages.create({
      model: MODEL,
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }],
    })
  );

  const raw = response.content[0].type === "text" ? response.content[0].text : "[]";
  const flags = parseJson<RedFlag[]>(raw, []);

  return {
    red_flags: Array.isArray(flags) ? flags : [],
    tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
  };
}

// ─── Stage 3 — Deal Score ─────────────────────────────────────────────────────

async function calculateDealScore(
  metrics: FinancialMetrics,
  propertyDetails: PropertyDetails,
  redFlags: RedFlag[],
  dealContext?: string
): Promise<{ deal_score: number; score_reasoning: string; tokensUsed: number }> {
  const criticalCount = redFlags.filter((f) => f.severity === "critical").length;
  const highCount = redFlags.filter((f) => f.severity === "high").length;

  const contextBlock = dealContext?.trim()
    ? `\nINVESTOR'S BUSINESS PLAN:\n${dealContext.trim()}\n\nScore the deal relative to the stated strategy. A value-add play on a vacant building is a different risk profile than a stabilized core deal — score accordingly.\n`
    : "";

  const prompt = `You are scoring this deal for initial pursuit prioritization inside Deal Intelligence — not for final investment approval. This is a first-look screen to decide whether to spend time underwriting it.
${contextBlock}
PROPERTY:
${JSON.stringify(propertyDetails, null, 2)}

FINANCIALS:
${JSON.stringify(metrics, null, 2)}

RED FLAGS IDENTIFIED:
- Critical: ${criticalCount}
- High: ${highCount}
- Total: ${redFlags.length}
${redFlags.slice(0, 5).map((f) => `  • [${f.severity.toUpperCase()}] ${f.category}: ${f.description}`).join("\n")}

Score this deal 1–10 based on: fit with the stated strategy, quality of the opportunity, severity of genuine (not expected) red flags, and apparent upside. Missing data is not a reason to score lower if the business plan explains it.

Return ONLY a JSON object:
{
  "deal_score": 7,
  "score_reasoning": "2-3 sentences — what makes this worth pursuing or not, referenced to the strategy and the actual numbers available"
}

Score guide (pursuit prioritization):
1-3: Pass — fundamental issues with the strategy fit or serious deal-killers
4-5: Borderline — one key question needs an answer before spending more time
6-7: Worth underwriting — move it forward, pull the model together
8-9: Strong fit — prioritize, get an offer together quickly
10: Exceptional — extremely rare`;

  const response = await withRetry(() =>
    getClient().messages.create({
      model: MODEL,
      max_tokens: 512,
      messages: [{ role: "user", content: prompt }],
    })
  );

  const raw = response.content[0].type === "text" ? response.content[0].text : "{}";
  const parsed = parseJson<{ deal_score: number; score_reasoning: string }>(raw, {
    deal_score: 5,
    score_reasoning: "Unable to score — insufficient data.",
  });

  return {
    deal_score: Math.max(1, Math.min(10, Math.round(parsed.deal_score ?? 5))),
    score_reasoning: parsed.score_reasoning ?? "",
    tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
  };
}

// ─── Stage 4 — Recommendations ───────────────────────────────────────────────

async function generateRecommendations(
  metrics: FinancialMetrics,
  propertyDetails: PropertyDetails,
  redFlags: RedFlag[],
  dealScore: number,
  dealContext?: string
): Promise<{ summary: string; recommendations: string[]; tokensUsed: number }> {
  const contextBlock = dealContext?.trim()
    ? `\nINVESTOR'S BUSINESS PLAN & STRATEGY:\n${dealContext.trim()}\n\nCalibrate the summary and recommendations to this strategy. Do not suggest things that contradict or are irrelevant to it.\n`
    : "";

  const prompt = `You are a deal associate writing a quick first-look memo for the acquisition team inside Deal Intelligence. This is the OM screening stage. The team's next steps in the workflow are: underwriting model → full diligence checklist → site visit → LOI submission.

Write a concise executive summary and structure the next steps to hand off clearly to those workflow stages. Do not recommend asking the broker for things they won't provide at OM stage (rent rolls, CapEx budgets, full financials). Do not recommend standard diligence tasks that are already built into the diligence checklist — only call out things specific to this deal.
${contextBlock}
DEAL SCORE: ${dealScore}/10
PROPERTY: ${propertyDetails.property_type || "Commercial"} at ${propertyDetails.address || "unknown address"}
ASKING PRICE: ${metrics.asking_price ? `$${metrics.asking_price.toLocaleString()}` : "unknown"}
CAP RATE: ${metrics.cap_rate ? `${(metrics.cap_rate * 100).toFixed(2)}%` : "unknown"}
NOI: ${metrics.noi ? `$${metrics.noi.toLocaleString()}/yr` : "unknown"}

TOP FLAGS:
${redFlags.slice(0, 4).map((f) => `• [${f.severity}] ${f.description}`).join("\n") || "No major flags identified."}

Return ONLY a JSON object with this structure. The recommendations array should have 4–6 items, each prefixed with the workflow stage it belongs to:
{
  "summary": "3-4 sentences — deal type, strategy fit, key available metrics, and primary risk or opportunity. Written as if briefing a colleague who hasn't seen the OM.",
  "recommendations": [
    "BEFORE LOI: Confirm zoning allows the intended flex/industrial use",
    "UNDERWRITING: Model conservative rent comps at $X/SF based on market — broker projections appear optimistic",
    "DILIGENCE CHECKLIST: Flag roof age and HVAC condition for inspector — building is 1985 vintage",
    "SITE VISIT: Walk the loading dock configuration and confirm clear height matches tenant requirements"
  ]
}`;

  const response = await withRetry(() =>
    getClient().messages.create({
      model: MODEL,
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    })
  );

  const raw = response.content[0].type === "text" ? response.content[0].text : "{}";
  const parsed = parseJson<{ summary: string; recommendations: string[] }>(raw, {
    summary: "Analysis complete.",
    recommendations: [],
  });

  return {
    summary: parsed.summary ?? "",
    recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
    tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
  };
}

// ─── Main entry point — 4-stage pipeline ─────────────────────────────────────

export async function extractOmFull(pdfText: string, dealContext?: string): Promise<OmFullResult> {
  const startMs = Date.now();
  let totalTokens = 0;

  // Stage 1: Metrics (no context needed)
  const stage1 = await extractMetrics(pdfText);
  totalTokens += stage1.tokensUsed;

  // Stage 2: Red Flags (context-aware)
  const stage2 = await analyzeRedFlags(
    pdfText,
    stage1.financial_metrics,
    stage1.property_details,
    dealContext
  );
  totalTokens += stage2.tokensUsed;

  // Stage 3: Deal Score (context-aware)
  const stage3 = await calculateDealScore(
    stage1.financial_metrics,
    stage1.property_details,
    stage2.red_flags,
    dealContext
  );
  totalTokens += stage3.tokensUsed;

  // Stage 4: Recommendations (context-aware)
  const stage4 = await generateRecommendations(
    stage1.financial_metrics,
    stage1.property_details,
    stage2.red_flags,
    stage3.deal_score,
    dealContext
  );
  totalTokens += stage4.tokensUsed;

  const processingMs = Date.now() - startMs;

  // Cost estimate: claude-sonnet-4-5 pricing (~$3/M input, $15/M output — approximate)
  const costEstimate = (totalTokens / 1_000_000) * 9;

  return {
    property_details: stage1.property_details,
    financial_metrics: stage1.financial_metrics,
    assumptions: stage1.assumptions,
    red_flags: stage2.red_flags,
    deal_score: stage3.deal_score,
    score_reasoning: stage3.score_reasoning,
    summary: stage4.summary,
    recommendations: stage4.recommendations,
    model_used: MODEL,
    tokens_used: totalTokens,
    cost_estimate: costEstimate,
    processing_ms: processingMs,
  };
}

// ─── Legacy wrapper for backwards compat ─────────────────────────────────────

export async function extractOmMetrics(pdfText: string, dealContext?: string): Promise<OmExtractionResult> {
  const full = await extractOmFull(pdfText, dealContext);

  const om_extracted: OmExtracted = {
    asking_price: full.financial_metrics.asking_price ?? undefined,
    sf: full.property_details.sf ?? undefined,
    units: full.property_details.unit_count ?? undefined,
    cap_rate: full.financial_metrics.cap_rate ?? undefined,
    year_built: full.property_details.year_built ?? undefined,
    noi: full.financial_metrics.noi ?? undefined,
    occupancy: full.financial_metrics.vacancy_rate
      ? 1 - full.financial_metrics.vacancy_rate
      : undefined,
    address: full.property_details.address ?? undefined,
  };

  return {
    om_score: full.deal_score,
    om_extracted,
    red_flags: full.red_flags,
    raw_text_preview: pdfText.slice(0, 500),
    full_result: full,
  };
}

// ─── OM Q&A ───────────────────────────────────────────────────────────────────

export async function answerOmQuestion(
  question: string,
  pdfText: string,
  analysis: OmFullResult,
  history: Array<{ question: string; answer: string }>
): Promise<{ answer: string; tokensUsed: number }> {
  const recentHistory = history.slice(-6);

  const systemPrompt = `You are an expert real estate investment analyst who has thoroughly read and analyzed this Offering Memorandum.

PROPERTY: ${analysis.property_details.property_type || "Commercial"} — ${analysis.property_details.address || "Address unknown"}
DEAL SCORE: ${analysis.deal_score}/10
KEY METRICS: Asking Price ${analysis.financial_metrics.asking_price ? `$${analysis.financial_metrics.asking_price.toLocaleString()}` : "unknown"}, Cap Rate ${analysis.financial_metrics.cap_rate ? `${(analysis.financial_metrics.cap_rate * 100).toFixed(2)}%` : "unknown"}, NOI ${analysis.financial_metrics.noi ? `$${analysis.financial_metrics.noi.toLocaleString()}` : "unknown"}

ANALYSIS SUMMARY:
${analysis.summary}

RED FLAGS:
${analysis.red_flags.map((f) => `• [${f.severity.toUpperCase()}] ${f.category}: ${f.description}`).join("\n") || "None identified."}

OM DOCUMENT EXCERPT (first 8000 chars):
${pdfText.slice(0, 8000)}

Answer questions accurately and concisely based on the OM and analysis. Cite specific numbers when possible. Flag any concerns relevant to the question. Use markdown formatting.`;

  const messages: Anthropic.MessageParam[] = [
    ...recentHistory.flatMap((h) => [
      { role: "user" as const, content: h.question },
      { role: "assistant" as const, content: h.answer },
    ]),
    { role: "user", content: question },
  ];

  const response = await withRetry(() =>
    getClient().messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: systemPrompt,
      messages,
    })
  );

  const answer = response.content[0].type === "text" ? response.content[0].text : "";

  return {
    answer,
    tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
  };
}
