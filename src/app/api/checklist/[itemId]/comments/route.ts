import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { checklistQueries } from "@/lib/db";
import { requireAuth, requireDealAccess, requireDealEditAccess } from "@/lib/auth";

export const dynamic = "force-dynamic";

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
  const rows = await checklistQueries.listComments(params.itemId);
  return NextResponse.json({ data: rows });
}

export async function POST(
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
  const text = typeof body.body === "string" ? body.body.trim().slice(0, 4000) : "";
  if (!text) {
    return NextResponse.json({ error: "body is required" }, { status: 400 });
  }
  const row = await checklistQueries.addComment({
    id: uuidv4(),
    checklist_item_id: params.itemId,
    author_user_id: userId ?? null,
    body: text,
  });
  return NextResponse.json({ data: row }, { status: 201 });
}
