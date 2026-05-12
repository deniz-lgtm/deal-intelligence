import { NextRequest, NextResponse } from "next/server";
import { checklistQueries } from "@/lib/db";
import { requireAuth, requireDealAccess, requireDealEditAccess } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/checklist/[itemId]
 * Returns the full detail bundle for the drawer — item row + attachments
 * (joined with documents) + linked deal_dev_phases rows that point back
 * via linked_checklist_item_id.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { itemId: string } }
) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  const item = await checklistQueries.getById(params.itemId) as { deal_id: string } | null;
  if (!item) return NextResponse.json({ error: "Checklist item not found" }, { status: 404 });
  const { errorResponse: accessError } = await requireDealAccess(item.deal_id, userId);
  if (accessError) return accessError;

  const detail = await checklistQueries.getByIdWithDetail(params.itemId);
  return NextResponse.json({ data: detail });
}

/**
 * PATCH /api/checklist/[itemId]
 * Partial update of editable task-like fields: title, notes, status,
 * assignee_user_id, due_date.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { itemId: string } }
) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  const item = await checklistQueries.getById(params.itemId) as { deal_id: string } | null;
  if (!item) return NextResponse.json({ error: "Checklist item not found" }, { status: 404 });
  const { errorResponse: accessError } = await requireDealEditAccess(item.deal_id, userId);
  if (accessError) return accessError;

  const body = await req.json().catch(() => ({}));
  const updates: Record<string, unknown> = {};
  if (body.title !== undefined) updates.title = body.title ? String(body.title).trim().slice(0, 200) : null;
  if (body.notes !== undefined) updates.notes = body.notes ? String(body.notes) : null;
  if (body.status !== undefined) updates.status = body.status;
  if (body.assignee_user_id !== undefined) updates.assignee_user_id = body.assignee_user_id || null;
  if (body.due_date !== undefined) updates.due_date = body.due_date || null;

  const row = await checklistQueries.update(params.itemId, updates);
  if (!row) return NextResponse.json({ error: "No updates applied" }, { status: 400 });
  return NextResponse.json({ data: row });
}
