import { NextRequest, NextResponse } from "next/server";
import { dealQueries, documentQueries, omAnalysisQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

/**
 * GET /api/deals/:id/om-analysis
 * Returns the latest OM analysis for a deal.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const analysis = await omAnalysisQueries.getByDealId(params.id);

    // Also check if there's an existing OM document for re-analysis capability
    let hasDocument = false;
    if (analysis?.document_id) {
      const doc = await documentQueries.getById(analysis.document_id);
      hasDocument = !!doc?.content_text;
    }

    return NextResponse.json({ data: { analysis, hasDocument } });
  } catch (error) {
    console.error("GET /api/deals/[id]/om-analysis error:", error);
    return NextResponse.json({ error: "Failed to fetch analysis" }, { status: 500 });
  }
}
