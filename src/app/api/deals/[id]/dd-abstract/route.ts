import { NextRequest, NextResponse } from "next/server";
import { dealQueries, dealNoteQueries, documentQueries, checklistQueries, underwritingQueries, businessPlanQueries, omAnalysisQueries, locationIntelligenceQueries, compQueries, submarketMetricsQueries } from "@/lib/db";
import { generateDDAbstract } from "@/lib/claude";
import type { Document, ChecklistItem, Deal } from "@/lib/types";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { formatLocationIntelContext } from "@/lib/location-intel-context";
import {
  buildUnderwritingSummary,
  buildOmSummary,
  buildMarketSummary,
} from "@/lib/deal-analytics-context";

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

    const deal = await dealQueries.getById(params.id);

    const [documents, checklist, uwRow, omAnalysis, locationIntelRows, compsAll, submarketMetrics] = await Promise.all([
      documentQueries.getByDealId(params.id) as Promise<Document[]>,
      checklistQueries.getByDealId(params.id) as Promise<ChecklistItem[]>,
      underwritingQueries.getByDealId(params.id),
      omAnalysisQueries.getByDealId(params.id),
      locationIntelligenceQueries.getByDealId(params.id).catch(() => []),
      compQueries.getByDealId(params.id).catch(() => []),
      submarketMetricsQueries.getByDealId(params.id).catch(() => null),
    ]);

    // Parse raw UW data — it's stored as JSONB, may be string or object
    let rawUw: Record<string, unknown> | null = null;
    if (uwRow?.data) {
      rawUw = typeof uwRow.data === "string" ? JSON.parse(uwRow.data) : uwRow.data;
    }

    // Fetch deal notes from the new unified table
    const allDealNotes = await dealNoteQueries.getByDealId(params.id);

    // Build a comprehensive underwriting summary + OM comparison + market
    // context. All three use the SAME helpers as the Investment Package
    // generator so the two documents never drift on computed metrics.
    const uwSummary = [
      buildUnderwritingSummary(rawUw, deal, allDealNotes),
      buildOmSummary(omAnalysis),
      buildMarketSummary(
        submarketMetrics as Record<string, unknown> | null,
        compsAll as Array<Record<string, unknown>>,
        locationIntelRows as Array<Record<string, unknown>>
      ),
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
    return NextResponse.json({ error: "Failed to generate DD abstract" }, { status: 500 });
  }
}

