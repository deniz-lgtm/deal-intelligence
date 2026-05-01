import { NextRequest, NextResponse } from "next/server";
import { dealQueries, dealNoteQueries, getUnderwritingForMassing, documentQueries, checklistQueries, omAnalysisQueries, businessPlanQueries, devPhaseQueries, preDevCostQueries, compQueries, submarketMetricsQueries, locationIntelligenceQueries, marketReportsQueries } from "@/lib/db";
import Anthropic from "@anthropic-ai/sdk";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { summarizeAffordability } from "@/lib/affordability-summary";
import {
  buildUnderwritingSummary,
  buildOmSummary,
  buildMarketSummary,
} from "@/lib/deal-analytics-context";
import { fetchCapitalMarketsSnapshot } from "@/lib/capital-markets";
import { CONCISE_STYLE } from "@/lib/ai-style";
import { AnyRecord, SECTION_TITLES, buildDealContext, buildSectionContext } from "@/lib/investment-package-context";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

const MODEL = "claude-sonnet-4-6";
let _client: Anthropic | null = null;
function getClient() {
  if (!_client) _client = new Anthropic();
  return _client;
}

const AUDIENCE_TONES: Record<string, string> = {
  lp_investor:
    "AUDIENCE: Institutional LPs (pensions, sovereigns, endowments, insurance, large family offices). They benchmark every deal against their entire portfolio.\n" +
    "VOICE: Formal, institutional, return-focused. Every return figure gets a matching downside in the same bullet. Risks get mitigants in the same bullet. No adjectives about the deal — only about the sponsor's realized track record.",
  investment_committee:
    "AUDIENCE: Internal IC at a top-tier manager (Blackstone / KKR / Starwood / Oaktree caliber). Readers have 15 minutes before a 45-minute discussion. They do not need education.\n" +
    "VOICE: Blunt, analytical, assumption-driven. Separate UNDERWRITTEN / VERIFIED / ASSUMED. Compare basis to comp-set spread in bps. Take a position — do not hedge. No marketing language.",
  lender:
    "AUDIENCE: Senior lender / debt capital markets (balance-sheet bank, debt fund, agency, life co). They underwrite collateral and sponsor, not equity return.\n" +
    "VOICE: Conservative, coverage-focused. Lead every bullet with LTV / LTC / DSCR / debt yield / recourse. Stress DSCR and debt yield against +100/+200 bps rate moves and −10% NOI.",
  internal_review:
    "AUDIENCE: Internal acquisitions team, pre-IC screen.\n" +
    "VOICE: Direct, engineer-style. Flag blockers first. State the bid, walk price, and re-trade triggers. If the deal is a pass, say so and list the three dispositive reasons.",
};

// Each format has its own tuned instruction block. The editorial
// report shell (src/lib/report-html-shell.ts) renders everything in
// Fraunces + JetBrains Mono, brick/ochre/forest palette — so the
// prompts focus on *voice + structure*, not visual formatting. Common
// rules across every format:
//   - Use <em>…</em> wrappers around the single most important phrase
//     in a paragraph (the shell italicizes them in brick). Sparingly.
//   - Em-dashes are encouraged for asides — adds texture.
//   - Never use corporate jargon: "leverage," "synergies," "value-add
//     opportunity" without specifics, "robust," "best-in-class,"
//     "differentiated platform."
//   - Cite sources inline: (T-12), (CoStar Q3 '24), (broker OM),
//     (internal UW). Tag UNVERIFIED when the source is absent.
const COMMON_VOICE =
  "VOICE BASELINE (applies to every format):\n" +
  "- Declarative sentences. Vary length deliberately.\n" +
  "- Italicize the single most important phrase per paragraph with <em>…</em> — sparingly.\n" +
  "- Em-dashes for asides — like this — to add texture.\n" +
  "- Replace corporate jargon (\"leverage,\" \"synergies,\" \"robust,\" \"best-in-class\") with concrete, numeric claims.\n" +
  "- Numbers are characters in the story, not decoration. Every claim carries a number, a source citation, or both.\n" +
  "- Acknowledge tradeoffs and counter-arguments. Never oversell. Confidence comes from honest framing.\n" +
  "- Cite sources inline: (T-12), (CoStar Q3 '24), (broker OM), (internal UW). Tag UNVERIFIED when absent.";

const FORMAT_INSTRUCTIONS: Record<string, string> = {
  pitch_deck:
    COMMON_VOICE +
    "\n\n" +
    "FORMAT: Pitch deck section — board-ready, visually scannable.\n" +
    "- 3–6 bullets per section. Each bullet ≤ 15 words.\n" +
    "- Bullet 1 is the headline metric wrapped in <strong>…</strong>. Bullets 2+ are supporting evidence.\n" +
    "- Prefer numbers to adjectives. No run-on sentences. No filler.\n" +
    "- Markdown: `-` for bullets. `**bold**` only for the lead metric in bullet 1. No `##` headers.\n" +
    "- If the deal has a weakness the slide would skip, address it in one bullet with the mitigant in the same line.",
  investment_memo:
    COMMON_VOICE +
    "\n\n" +
    "FORMAT: Institutional investment memo — IC-ready, analytical, dense.\n" +
    "- Each section leads with a bold takeaway sentence ≤ 20 words, then 4–8 bullets ≤ 20 words each.\n" +
    "- TABLES FIRST when the section context supplies a markdown table (unit mix, sources & uses, comps). Paste verbatim; do NOT re-render its numbers in prose. Analytical bullets go AFTER the table.\n" +
    "- Every non-table bullet carries a specific number, a source citation, or an action. If it doesn't — delete it.\n" +
    "- NO multi-sentence paragraphs. NO section recaps. NO transitional language.\n" +
    "- Separate UNDERWRITTEN / VERIFIED / ASSUMED when a claim's provenance matters.\n" +
    "- For returns / exit / risk sections, show base / downside / upside on one inline line each, not three paragraphs.\n" +
    "- Take a position. Do not hedge. If the deal is a pass at this price, say so.",
  one_pager:
    COMMON_VOICE +
    "\n\n" +
    "FORMAT: One-pager / LP teaser — ≤ 350 words across ALL sections combined. Be ruthless.\n" +
    "- Each section: 1 headline sentence + up to 2 bullets. Bullets carry 3–4 numbers total.\n" +
    "- Cover the thesis in one breath, then basis ($/unit or $/SF), going-in yield, stabilized yield, levered IRR, equity multiple, hold, equity check.\n" +
    "- No narrative paragraphs. No adjectives. Numbers and the thesis.\n" +
    "- If you find yourself explaining anything, cut it. The reader either already knows or will ask.",
};

interface GenerateRequest {
  audience: string;
  format: string;
  sections: string[];
  existingNotes?: Record<string, string[]>; // sectionId -> user notes
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const body: GenerateRequest = await req.json();
    const { audience, format, sections, existingNotes = {} } = body;
    const massingId: string | undefined = (body as { massing_id?: string }).massing_id;

    // Fetch ALL deal data in parallel
    const [deal, uwRow, omAnalysis, docs, checklist, photosRes, devPhases, preDevCosts, compsAll, submarketMetrics, locationIntelRows, marketReports] = await Promise.all([
      dealQueries.getById(params.id),
      getUnderwritingForMassing(params.id, massingId),
      omAnalysisQueries.getByDealId(params.id),
      documentQueries.getByDealId(params.id),
      checklistQueries.getByDealId(params.id),
      fetch(`${process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"}/api/deals/${params.id}/photos`, { signal: AbortSignal.timeout(5000) }).then(r => r.json()).catch(() => ({ data: [] })),
      devPhaseQueries.getByDealId(params.id).catch(() => []),
      preDevCostQueries.getByDealId(params.id).catch(() => []),
      compQueries.getByDealId(params.id).catch(() => []),
      submarketMetricsQueries.getByDealId(params.id).catch(() => null),
      locationIntelligenceQueries.getByDealId(params.id).catch(() => []),
      marketReportsQueries.getByDealId(params.id).catch(() => []),
    ]);

    // Guard: if the deal row is missing (deleted between the click and the
    // request) we want a clean error, not a crash on deal.context_notes.
    if (!deal) {
      return NextResponse.json(
        { error: "Deal not found — it may have been deleted" },
        { status: 404 }
      );
    }

    // Use deal notes for context instead of legacy context_notes
    deal.context_notes = await dealNoteQueries
      .getMemoryText(params.id)
      .catch(() => "") || null;

    // Fetch linked business plan if set
    const businessPlan = deal.business_plan_id
      ? await businessPlanQueries.getById(deal.business_plan_id)
      : null;

    const uw: AnyRecord | null = uwRow?.data
      ? (typeof uwRow.data === "string" ? JSON.parse(uwRow.data) : uwRow.data)
      : null;
    const photos = photosRes?.data || [];
    const n = (v: unknown) => typeof v === "number" ? v : 0;
    const fc = (v: number) => `$${Math.round(v).toLocaleString()}`;

    // Pull analyst deal notes so they can flow into the UW summary (thesis,
    // risk, context buckets) instead of only landing in the section prompts.
    // Wrapped defensively — a missing deal_notes row should never take the
    // whole generation down.
    const allDealNotes = await dealNoteQueries
      .getByDealId(params.id)
      .catch((err) => {
        console.warn("generate-all: dealNoteQueries.getByDealId failed:", err);
        return [] as Array<{ text: string; category: string }>;
      }) as Array<{ text: string; category: string }>;

    // Build the full computed UW / OM / market analytics blocks ONCE so
    // every section prompt sees the same NOI, cap rate, yield on cost,
    // DSCR, debt yield, loss-to-lease, OpEx build, comp-set averages, and
    // submarket demographics. Each helper is wrapped so a single bad field
    // (e.g. a corrupt numeric in the UW JSONB) can't 500 the whole route.
    const safe = <T>(fn: () => T, label: string, fallback: T): T => {
      try { return fn(); } catch (err) {
        console.error(`generate-all: ${label} threw —`, err);
        return fallback;
      }
    };
    const uwSummary = safe(() => buildUnderwritingSummary(uw, deal, allDealNotes), "buildUnderwritingSummary", "");
    const omSummary = safe(() => buildOmSummary(omAnalysis), "buildOmSummary", "");
    const capitalMarkets = await fetchCapitalMarketsSnapshot().catch((err) => {
      console.warn("generate-all: fetchCapitalMarketsSnapshot failed:", err);
      return null;
    });

    const marketSummary = safe(() => buildMarketSummary(
      submarketMetrics as AnyRecord | null,
      compsAll as AnyRecord[],
      locationIntelRows as AnyRecord[],
      marketReports as AnyRecord[],
      capitalMarkets
    ), "buildMarketSummary", "");

    // Build master deal context — now enriched with full UW + OM + market.
    const dealContext = safe(() => buildDealContext(
      deal, uw, omAnalysis, docs as AnyRecord[], checklist as AnyRecord[],
      photos, businessPlan as AnyRecord | null,
      uwSummary, omSummary, marketSummary
    ), "buildDealContext", "");

    // Build per-section context
    const sectionContexts: Record<string, string> = {};
    for (const sectionId of sections) {
      sectionContexts[sectionId] = safe(
        () => buildSectionContext(sectionId, deal, uw, omAnalysis, docs as AnyRecord[], checklist as AnyRecord[], photos, n, fc, businessPlan as AnyRecord | null, devPhases as AnyRecord[], preDevCosts as AnyRecord[], compsAll as AnyRecord[], submarketMetrics as AnyRecord | null, locationIntelRows as AnyRecord[]),
        `buildSectionContext(${sectionId})`,
        ""
      );
    }

    const audienceTone = AUDIENCE_TONES[audience] || AUDIENCE_TONES.investment_committee;
    const formatInstr = FORMAT_INSTRUCTIONS[format] || FORMAT_INSTRUCTIONS.investment_memo;

    // Generate all sections
    const results: Array<{ id: string; content: string; generated_at: string }> = [];

    for (const sectionId of sections) {
      // Skip sections that don't need AI
      if (sectionId === "photos" || sectionId === "appendix") {
        results.push({ id: sectionId, content: sectionContexts[sectionId] || "", generated_at: new Date().toISOString() });
        continue;
      }

      const userNotes = existingNotes[sectionId]?.filter(n => n.trim()) || [];
      const sectionCtx = sectionContexts[sectionId] || "";

      const prompt = `${CONCISE_STYLE}

${audienceTone}

${formatInstr}

DEAL CONTEXT:
${dealContext}

SECTION-SPECIFIC DATA:
${sectionCtx}

${userNotes.length > 0 ? `THE ANALYST HAS PROVIDED THESE KEY POINTS TO INCORPORATE:\n${userNotes.map((n, i) => `${i + 1}. ${n}`).join("\n")}\n` : ""}
Write the "${SECTION_TITLES[sectionId] || sectionId}" section. Use the deal data provided — be specific with numbers. All percentage values are already in percent form (5 = 5%, not 0.05). Do not include the section title as a header — just the content.`;

      try {
        const response = await getClient().messages.create({
          model: MODEL,
          max_tokens: format === "one_pager" ? 500 : format === "pitch_deck" ? 1500 : 2500,
          messages: [{ role: "user", content: prompt }],
        });
        const text = response.content[0].type === "text" ? response.content[0].text : "";
        results.push({ id: sectionId, content: text, generated_at: new Date().toISOString() });
      } catch (err) {
        console.error(`Failed to generate section ${sectionId}:`, err);
        results.push({ id: sectionId, content: `*Generation failed for this section.*`, generated_at: new Date().toISOString() });
      }
    }

    return NextResponse.json({ data: results });
  } catch (error) {
    // Surface the actual error text in the response so the UI toast shows
    // something actionable instead of an opaque "Generation failed".
    console.error("Generate-all error:", error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: `Generation failed: ${message.slice(0, 300)}` },
      { status: 500 }
    );
  }
}

