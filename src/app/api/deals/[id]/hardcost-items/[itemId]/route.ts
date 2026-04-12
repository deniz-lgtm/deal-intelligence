import { NextRequest, NextResponse } from "next/server";
import { hardCostQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; itemId: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const body = await req.json();
    const item = await hardCostQueries.update(params.itemId, body);
    if (!item) {
      return NextResponse.json({ error: "Item not found or no updates" }, { status: 404 });
    }
    return NextResponse.json({ data: item });
  } catch (error) {
    console.error("PATCH /api/deals/[id]/hardcost-items/[itemId] error:", error);
    return NextResponse.json({ error: "Failed to update hard cost item" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; itemId: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    await hardCostQueries.delete(params.itemId);
    return NextResponse.json({ data: { success: true } });
  } catch (error) {
    console.error("DELETE /api/deals/[id]/hardcost-items/[itemId] error:", error);
    return NextResponse.json({ error: "Failed to delete hard cost item" }, { status: 500 });
  }
}
