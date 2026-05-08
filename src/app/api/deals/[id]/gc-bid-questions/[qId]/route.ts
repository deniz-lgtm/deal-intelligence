import { NextRequest, NextResponse } from "next/server";
import { gcBidQueries } from "@/lib/db";
import { requireAuth, requireDealEditAccess } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; qId: string } }
) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const { errorResponse: accessError } = await requireDealEditAccess(params.id, userId);
  if (accessError) return accessError;

  const body = await req.json();
  const updated = await gcBidQueries.updateQuestion(params.qId, body);
  if (!updated) {
    return NextResponse.json({ error: "Question not found or no updates" }, { status: 404 });
  }
  return NextResponse.json({ data: updated });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; qId: string } }
) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const { errorResponse: accessError } = await requireDealEditAccess(params.id, userId);
  if (accessError) return accessError;

  await gcBidQueries.deleteQuestion(params.qId);
  return NextResponse.json({ data: { success: true } });
}
