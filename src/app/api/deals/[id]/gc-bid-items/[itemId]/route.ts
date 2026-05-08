import { NextRequest, NextResponse } from "next/server";
import { gcBidQueries } from "@/lib/db";
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
  const updated = await gcBidQueries.updateBidItem(params.itemId, body);
  if (!updated) {
    return NextResponse.json({ error: "Bid item not found or no updates" }, { status: 404 });
  }
  return NextResponse.json({ data: updated });
}
