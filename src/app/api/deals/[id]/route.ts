import { NextRequest, NextResponse } from "next/server";
import { dealQueries } from "@/lib/db";
import { requireAuth, requireDealAccess, requirePermission } from "@/lib/auth";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  try {
    const { deal, errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;
    return NextResponse.json({ data: deal });
  } catch (error) {
    console.error("GET /api/deals/[id] error:", error);
    return NextResponse.json({ error: "Failed to fetch deal" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  try {
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const body = await req.json();
    const deal = await dealQueries.update(params.id, body);
    return NextResponse.json({ data: deal });
  } catch (error) {
    console.error("PATCH /api/deals/[id] error:", error);
    const msg = error instanceof Error ? error.message : "Failed to update deal";
    return NextResponse.json({ error: `Failed to update deal: ${msg}` }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { userId, errorResponse } = await requirePermission("deals.delete");
  if (errorResponse) return errorResponse;

  try {
    // Only the owner can delete a deal
    const deal = await dealQueries.getByIdWithAccess(params.id, userId);
    if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    if (deal.owner_id && deal.owner_id !== userId) {
      return NextResponse.json({ error: "Only the deal owner can delete it" }, { status: 403 });
    }

    await dealQueries.delete(params.id);
    return NextResponse.json({ data: { success: true } });
  } catch (error) {
    console.error("DELETE /api/deals/[id] error:", error);
    return NextResponse.json({ error: "Failed to delete deal" }, { status: 500 });
  }
}
