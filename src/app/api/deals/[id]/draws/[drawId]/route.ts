import { NextRequest, NextResponse } from "next/server";
import { drawQueries, drawItemQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; drawId: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const draw = await drawQueries.getById(params.drawId);
    if (!draw) {
      return NextResponse.json({ error: "Draw not found" }, { status: 404 });
    }
    const items = await drawItemQueries.getByDrawId(params.drawId);
    return NextResponse.json({ data: { ...draw, items } });
  } catch (error) {
    console.error("GET /api/deals/[id]/draws/[drawId] error:", error);
    return NextResponse.json({ error: "Failed to fetch draw" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; drawId: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const body = await req.json();
    const draw = await drawQueries.update(params.drawId, body);
    if (!draw) {
      return NextResponse.json({ error: "Draw not found or no updates" }, { status: 404 });
    }
    return NextResponse.json({ data: draw });
  } catch (error) {
    console.error("PATCH /api/deals/[id]/draws/[drawId] error:", error);
    return NextResponse.json({ error: "Failed to update draw" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; drawId: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    await drawQueries.delete(params.drawId);
    return NextResponse.json({ data: { success: true } });
  } catch (error) {
    console.error("DELETE /api/deals/[id]/draws/[drawId] error:", error);
    return NextResponse.json({ error: "Failed to delete draw" }, { status: 500 });
  }
}
