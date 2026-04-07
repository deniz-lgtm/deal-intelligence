import { NextRequest, NextResponse } from "next/server";
import { preDevCostQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; costId: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const body = await req.json();
    const cost = await preDevCostQueries.update(params.costId, body);
    if (!cost) {
      return NextResponse.json({ error: "Cost not found or no updates" }, { status: 404 });
    }
    return NextResponse.json({ data: cost });
  } catch (error) {
    console.error("PATCH /api/deals/[id]/predev-costs/[costId] error:", error);
    return NextResponse.json({ error: "Failed to update cost" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; costId: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    await preDevCostQueries.delete(params.costId);
    return NextResponse.json({ data: { success: true } });
  } catch (error) {
    console.error("DELETE /api/deals/[id]/predev-costs/[costId] error:", error);
    return NextResponse.json({ error: "Failed to delete cost" }, { status: 500 });
  }
}
