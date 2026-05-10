import { NextRequest, NextResponse } from "next/server";
import { longLeadQueries } from "@/lib/db";
import { requireAuth, requireDealEditAccess } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; itemId: string } }
) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const { errorResponse: accessError } = await requireDealEditAccess(params.id, userId);
  if (accessError) return accessError;
  const body = await req.json();
  const updated = await longLeadQueries.update(params.itemId, body);
  if (!updated) {
    return NextResponse.json({ error: "long-lead item not found or no updates" }, { status: 404 });
  }
  return NextResponse.json({ data: updated });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; itemId: string } }
) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const { errorResponse: accessError } = await requireDealEditAccess(params.id, userId);
  if (accessError) return accessError;
  await longLeadQueries.delete(params.itemId);
  return NextResponse.json({ data: { success: true } });
}
