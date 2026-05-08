import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { decisionQueries } from "@/lib/db";
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

  const rows = await decisionQueries.listByDeal(params.id);
  return NextResponse.json({ data: rows });
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
  if (!body.title?.trim()) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  const created = await decisionQueries.create({
    id: uuidv4(),
    deal_id: params.id,
    title: body.title.trim(),
    body: body.body ?? null,
    category: body.category ?? null,
    status: body.status ?? "open",
    asked_by: userId,
    assigned_to: body.assigned_to ?? null,
    due_date: body.due_date || null,
    linked_document_id: body.linked_document_id ?? null,
    linked_phase_id: body.linked_phase_id ?? null,
  });
  return NextResponse.json({ data: created });
}
