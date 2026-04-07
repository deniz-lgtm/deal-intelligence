import { NextRequest, NextResponse } from "next/server";
import { devPhaseQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; phaseId: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const body = await req.json();
    const phase = await devPhaseQueries.update(params.phaseId, body);
    if (!phase) {
      return NextResponse.json({ error: "Phase not found or no updates" }, { status: 404 });
    }
    return NextResponse.json({ data: phase });
  } catch (error) {
    console.error("PATCH /api/deals/[id]/dev-schedule/[phaseId] error:", error);
    return NextResponse.json({ error: "Failed to update phase" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; phaseId: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    await devPhaseQueries.delete(params.phaseId);
    return NextResponse.json({ data: { success: true } });
  } catch (error) {
    console.error("DELETE /api/deals/[id]/dev-schedule/[phaseId] error:", error);
    return NextResponse.json({ error: "Failed to delete phase" }, { status: 500 });
  }
}
