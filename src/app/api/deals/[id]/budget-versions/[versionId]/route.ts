import { NextRequest, NextResponse } from "next/server";
import { budgetVersionQueries } from "@/lib/db";
import { requireAuth, requireDealEditAccess } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; versionId: string } }
) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const { errorResponse: accessError } = await requireDealEditAccess(params.id, userId);
  if (accessError) return accessError;

  const body = await req.json();
  if (body.set_active === true) {
    await budgetVersionQueries.setActive(params.id, params.versionId);
  }
  if (body.label || body.notes !== undefined) {
    await budgetVersionQueries.update(params.versionId, {
      label: body.label,
      notes: body.notes,
    });
  }
  return NextResponse.json({ data: { success: true } });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; versionId: string } }
) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const { errorResponse: accessError } = await requireDealEditAccess(params.id, userId);
  if (accessError) return accessError;

  // Don't allow deleting the only version — would orphan all budget lines.
  const versions = await budgetVersionQueries.listByDeal(params.id);
  if (versions.length <= 1) {
    return NextResponse.json({ error: "Cannot delete the only budget version." }, { status: 400 });
  }
  await budgetVersionQueries.delete(params.versionId);
  return NextResponse.json({ data: { success: true } });
}
