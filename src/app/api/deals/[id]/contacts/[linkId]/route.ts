import { NextRequest, NextResponse } from "next/server";
import { dealContactQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; linkId: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const body = await req.json();
    const updates: Record<string, unknown> = {};
    if (body.role_on_deal !== undefined) {
      updates.role_on_deal = body.role_on_deal ? String(body.role_on_deal).trim() : null;
    }
    if (body.notes !== undefined) {
      updates.notes = body.notes ? String(body.notes).trim() : null;
    }

    const row = await dealContactQueries.update(params.linkId, updates);
    if (!row) {
      return NextResponse.json({ error: "Link not found or no updates" }, { status: 404 });
    }
    return NextResponse.json({ data: row });
  } catch (error) {
    console.error("PATCH /api/deals/[id]/contacts/[linkId] error:", error);
    return NextResponse.json({ error: "Failed to update link" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; linkId: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    await dealContactQueries.unlink(params.linkId);
    return NextResponse.json({ data: { success: true } });
  } catch (error) {
    console.error("DELETE /api/deals/[id]/contacts/[linkId] error:", error);
    return NextResponse.json({ error: "Failed to unlink contact" }, { status: 500 });
  }
}
