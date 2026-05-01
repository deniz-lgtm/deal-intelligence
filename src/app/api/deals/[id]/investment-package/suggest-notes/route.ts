import { NextRequest, NextResponse } from "next/server";
import { dealQueries, dealNoteQueries, getUnderwritingForMassing, documentQueries, checklistQueries, omAnalysisQueries, businessPlanQueries, devPhaseQueries, preDevCostQueries, compQueries, submarketMetricsQueries, locationIntelligenceQueries, marketReportsQueries } from "@/lib/db";
import Anthropic from "@anthropic-ai/sdk";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import {
  buildUnderwritingSummary,
  buildOmSummary,
  buildMarketSummary,
} from "@/lib/deal-analytics-context";
import { fetchCapitalMarketsSnapshot } from "@/lib/capital-markets";
import { AnyRecord, buildDealContext, buildSectionContext } from "@/lib/investment-package-context";

export const dynamic = "force-dynamic";

const MODEL = "claude-sonnet-4-6";
let _client: Anthropic | null = null;
function getClient() {
  if (!_client) _client = new Anthropic();
  return _client;
}

interface SuggestRequest {
  sectionId: string;
  audience?: string;
  format?: string;
  massing_id?: string;
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

    const body: SuggestRequest = await req.json();
    const { sectionId, audience = "lp_investor", massing_id } = body;

    // Fetch all deal data in parallel
    const [deal, uwRow, omAnalysis, docs, checklist, photosRes, devPhases, preDevCosts, compsAll, submarketMetrics, locationIntelRows, marketReports] = await Promise.all([
      dealQueries.getById(params.id),
      getUnderwritingForMassing(params.id, massing_id),
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

    if (!deal) {
      return NextResponse.json(
        { error: "Deal not found" },
        { status: 404 }
      );
    }

    deal.context_notes = await dealNoteQueries
      .getMemoryText(params.id)
      .catch(() => "") || null;

    const businessPlan = deal.business_plan_id
      ? await businessPlanQueries.getById(deal.business_plan_id)
      : null;

    const uw: AnyRecord | null = uwRow?.data
      ? (typeof uwRow.data === "string" ? JSON.parse(uwRow.data) : uwRow.data)
      : null;
    const photos = photosRes?.data || [];
    const n = (v: unknown) => typeof v === "number" ? v : 0;
    const fc = (v: number) => `$${Math.round(v).toLocaleString()}`;

    const allDealNotes = await dealNoteQueries
      .getByDealId(params.id)
      .catch((err) => {
        console.warn("suggest-notes: dealNoteQueries.getByDealId failed:", err);
        return [] as Array<{ text: string; category: string }>;
      }) as Array<{ text: string; category: string }>;

    const safe = <T>(fn: () => T, label: string, fallback: T): T => {
      try { return fn(); } catch (err) {
        console.error(`suggest-notes: ${label} threw —`, err);
        return fallback;
      }
    };

    const uwSummary = safe(() => buildUnderwritingSummary(uw, deal, allDealNotes), "buildUnderwritingSummary", "");
    const omSummary = safe(() => buildOmSummary(omAnalysis), "buildOmSummary", "");
    const capitalMarkets = await fetchCapitalMarketsSnapshot().catch((err) => {
      console.warn("suggest-notes: fetchCapitalMarketsSnapshot failed:", err);
      return null;
    });

    const marketSummary = safe(() => buildMarketSummary(
      submarketMetrics as AnyRecord | null,
      compsAll as AnyRecord[],
      locationIntelRows as AnyRecord[],
      marketReports as AnyRecord[],
      capitalMarkets
    ), "buildMarketSummary", "");

    const dealContext = safe(() => buildDealContext(
      deal, uw, omAnalysis, docs as AnyRecord[], checklist as AnyRecord[],
      photos, businessPlan as AnyRecord | null,
      uwSummary, omSummary, marketSummary
    ), "buildDealContext", "");

    const sectionContext = safe(
      () => buildSectionContext(sectionId, deal, uw, omAnalysis, docs as AnyRecord[], checklist as AnyRecord[], photos, n, fc, businessPlan as AnyRecord | null, devPhases as AnyRecord[], preDevCosts as AnyRecord[], compsAll as AnyRecord[], submarketMetrics as AnyRecord | null, locationIntelRows as AnyRecord[]),
      `buildSectionContext(${sectionId})`,
      ""
    );

    const audienceTone = audience === "lender"
      ? "Your audience is a lender. Tone: conservative, coverage-focused."
      : audience === "internal_review"
      ? "Your audience is internal team. Tone: direct, flag concerns."
      : "Your tone should be confident, realistic, professional, and optimistic.";

    const prompt = `${audienceTone}

DEAL CONTEXT:
${dealContext}

SECTION: ${sectionId}

SECTION-SPECIFIC DATA:
${sectionContext}

Generate 3-5 bullet-point starter notes for this section. Each bullet should be ≤ 20 words and stand alone as a complete point. Format each as a separate line starting with "- ". Focus on key analytical points that would help expand this section.`;

    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";

    // Parse: split on newlines, trim, drop empties, strip leading bullets/numbers
    const bullets = text
      .split("\n")
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(line => line.replace(/^[-*]\s*/, "").replace(/^\d+\.\s*/, ""))
      .filter(line => line.length > 0);

    return NextResponse.json({ data: bullets });
  } catch (error) {
    console.error("Suggest-notes error:", error);
    return NextResponse.json({ error: "Suggestion failed" }, { status: 500 });
  }
}
