import { NextRequest, NextResponse } from "next/server";
import { dealQueries, dealNoteQueries, documentQueries, checklistQueries, getUnderwritingForMassing, businessPlanQueries, omAnalysisQueries, locationIntelligenceQueries, compQueries, submarketMetricsQueries, marketReportsQueries } from "@/lib/db";
import { generateDDAbstract } from "@/lib/claude";
import type { Document, ChecklistItem, Deal } from "@/lib/types";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { formatLocationIntelContext } from "@/lib/location-intel-context";
import {
  buildUnderwritingSummary,
  buildOmSummary,
  buildMarketSummary,
} from "@/lib/deal-analytics-context";
import { fetchCapitalMarketsSnapshot } from "@/lib/capital-markets";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const body = await req.json().catch(() => ({}));
    const sections: string[] | undefined = body.sections;
    const massingId: string | undefined = body.massing_id;

    const deal = await dealQueries.getById(params.id);
    if (!deal) {
      return NextResponse.json(
        { error: "Deal not found — it may have been deleted" },
        { status: 404 }
      );
    }

    const [documents, checklist, uwRow, omAnalysis, locationIntelRows, compsAll, submarketMetrics, marketReports] = await Promise.all([
      documentQueries.getByDealId(params.id).catch(() => []) as Promise<Document[]>,
      checklistQueries.getByDealId(params.id).catch(() => []) as Promise<ChecklistItem[]>,
      getUnderwritingForMassing(params.id, massingId).catch(() => null),
      omAnalysisQueries.getByDealId(params.id).catch(() => null),
      locationIntelligenceQueries.getByDealId(params.id).catch(() => []),
      compQueries.getByDealId(params.id).catch(() => []),
      submarketMetricsQueries.getByDealId(params.id).catch(() => null),
      marketReportsQueries.getByDealId(params.id).catch(() => []),
    ]);

    // Parse raw UW data — it's stored as JSONB, may be string or object
    let rawUw: Record<string, unknown> | null = null;
    if (uwRow?.data) {
      try {
        rawUw = typeof uwRow.data === "string" ? JSON.parse(uwRow.data) : uwRow.data;
      } catch (err) {
        console.warn("dd-abstract: failed to parse UW data JSONB:", err);
      }
    }

    // Fetch deal notes from the new unified table
    const allDealNotes = await dealNoteQueries
      .getByDealId(params.id)
      .catch(() => [] as Array<{ text: string; category: string }>);

    // Live FRED rates — threaded through the market block so the abstract
    // references today's 10Y UST + SOFR rather than stale assumptions.
    const capitalMarkets = await fetchCapitalMarketsSnapshot().catch((err) => {
      console.warn("dd-abstract: fetchCapitalMarketsSnapshot failed:", err);
      return null;
    });

    // Build a comprehensive underwriting summary + OM comparison + market
    // context. Each helper is wrapped so a single bad field in the UW JSONB
    // or a missing location-intel row doesn't 500 the whole abstract.
    const safe = <T>(fn: () => T, label: string, fallback: T): T => {
      try { return fn(); } catch (err) {
        console.error(`dd-abstract: ${label} threw —`, err);
        return fallback;
      }
    };
    const uwSummary = [
      safe(() => buildUnderwritingSummary(rawUw, deal, allDealNotes), "buildUnderwritingSummary", ""),
      safe(() => buildOmSummary(omAnalysis), "buildOmSummary", ""),
      safe(() => buildMarketSummary(
        submarketMetrics as Record<string, unknown> | null,
        compsAll as Array<Record<string, unknown>>,
        locationIntelRows as Array<Record<string, unknown>>,
        marketReports as Array<Record<string, unknown>>,
        capitalMarkets
      ), "buildMarketSummary", ""),
    ].filter(Boolean).join("\n\n");

    // Build context from memory-included deal notes
    const memoryText = await dealNoteQueries.getMemoryText(params.id);
    let bpContext = memoryText || "";
    if (deal.business_plan_id) {
      const bp = await businessPlanQueries.getById(deal.business_plan_id);
      if (bp) {
        const bpLines: string[] = [`BUSINESS PLAN — ${bp.name}:`];
        const theses = bp.investment_theses || [];
        if (theses.length > 0) bpLines.push(`Investment Thesis: ${theses.join(", ")}`);
        const markets = bp.target_markets || [];
        if (markets.length > 0) bpLines.push(`Target Markets: ${markets.join(", ")}`);
        if (bp.description?.trim()) bpLines.push(`Strategy: ${bp.description.trim()}`);
        bpContext = bpLines.join("\n") + (bpContext ? `\n\n${bpContext}` : "");
      }
    }

    // Append location intelligence to the context
    const locationContext = formatLocationIntelContext(locationIntelRows);
    const fullContext = [bpContext, locationContext].filter(Boolean).join("\n\n");

    const abstract = await generateDDAbstract(
      deal as Deal,
      documents,
      checklist,
      uwSummary,
      fullContext,
      sections
    );
    return NextResponse.json({ data: abstract });
  } catch (error) {
    console.error("POST /api/deals/[id]/dd-abstract error:", error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: `Failed to generate DD abstract: ${message.slice(0, 300)}` },
      { status: 500 }
    );
  }
}

