import { NextRequest, NextResponse } from "next/server";
import { marketReportsQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; reportId: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    await marketReportsQueries.delete(params.reportId, params.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/deals/[id]/market-reports/[reportId] error:", error);
    return NextResponse.json({ error: "Failed to delete market report" }, { status: 500 });
  }
}
