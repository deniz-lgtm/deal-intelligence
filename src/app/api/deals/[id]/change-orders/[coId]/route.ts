import { NextRequest, NextResponse } from "next/server";
import { changeOrderQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; coId: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const body = await req.json();
    const item = await changeOrderQueries.update(params.coId, body);
    if (!item) {
      return NextResponse.json({ error: "Change order not found or no updates" }, { status: 404 });
    }
    return NextResponse.json({ data: item });
  } catch (error) {
    console.error("PATCH /api/deals/[id]/change-orders/[coId] error:", error);
    return NextResponse.json({ error: "Failed to update change order" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; coId: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    await changeOrderQueries.delete(params.coId);
    return NextResponse.json({ data: { success: true } });
  } catch (error) {
    console.error("DELETE /api/deals/[id]/change-orders/[coId] error:", error);
    return NextResponse.json({ error: "Failed to delete change order" }, { status: 500 });
  }
}
