import { NextRequest, NextResponse } from "next/server";
import { generatedReportsQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";

// Opt out of static analysis at `next build`. Route reads auth + DB.
export const dynamic = "force-dynamic";

/**
 * DELETE /api/deals/:id/reports/:reportId
 * Remove a saved report from the deal's Reports hub.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; reportId: string } }
) {
  if (!process.env.DATABASE_URL) return NextResponse.json({ ok: true });
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;
    await generatedReportsQueries.delete(params.reportId, params.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/deals/[id]/reports/[reportId] error:", error);
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
}
