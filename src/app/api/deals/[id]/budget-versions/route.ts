import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { budgetVersionQueries } from "@/lib/db";
import { requireAuth, requireDealAccess, requireDealEditAccess } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
  if (accessError) return accessError;

  const versions = await budgetVersionQueries.listByDeal(params.id);
  return NextResponse.json({ data: versions });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const { errorResponse: accessError } = await requireDealEditAccess(params.id, userId);
  if (accessError) return accessError;

  const body = await req.json();
  if (!body.label?.trim()) {
    return NextResponse.json({ error: "label is required" }, { status: 400 });
  }

  const created = await budgetVersionQueries.create({
    id: uuidv4(),
    deal_id: params.id,
    label: body.label.trim(),
    notes: body.notes ?? null,
    cloned_from_version_id: body.cloned_from_version_id ?? null,
    created_by: userId,
  });

  // First version on a deal is automatically active. Subsequent versions
  // default inactive — caller can set active explicitly.
  const all = await budgetVersionQueries.listByDeal(params.id);
  if (all.length === 1 || body.set_active === true) {
    await budgetVersionQueries.setActive(params.id, created.id);
  }

  return NextResponse.json({ data: created });
}
