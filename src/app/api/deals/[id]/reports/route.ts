import { NextRequest, NextResponse } from "next/server";
import { generatedReportsQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";

// Opt out of static analysis at `next build`. Route reads auth + DB so
// Next.js's static-page generation would otherwise fail it.
export const dynamic = "force-dynamic";

/**
 * GET /api/deals/:id/reports
 *
 * Lists every report that's been exported for this deal (investment memo,
 * pitch deck, one-pager, DD abstract). Powers the Reports hub modal on
 * the investment-package page. Newest first. Section bodies are NOT
 * returned here — the list row carries only metadata. Fetch the body via
 * /reports/[reportId]/download.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ data: [] });
  }
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const rows = await generatedReportsQueries.getByDealId(params.id);
    return NextResponse.json({ data: rows });
  } catch (error) {
    console.error("GET /api/deals/[id]/reports error:", error);
    return NextResponse.json({ error: "Failed to load reports" }, { status: 500 });
  }
}
