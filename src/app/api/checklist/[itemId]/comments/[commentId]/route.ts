import { NextRequest, NextResponse } from "next/server";
import { checklistQueries } from "@/lib/db";
import { requireAuth, requireDealEditAccess } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { itemId: string; commentId: string } }
) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const item = await checklistQueries.getById(params.itemId) as { deal_id: string } | null;
  if (!item) return NextResponse.json({ error: "Checklist item not found" }, { status: 404 });
  const { errorResponse: accessError } = await requireDealEditAccess(item.deal_id, userId);
  if (accessError) return accessError;

  await checklistQueries.deleteComment(params.commentId);
  return NextResponse.json({ data: { ok: true } });
}
