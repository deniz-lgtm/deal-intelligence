import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { constructabilityQueries } from "@/lib/db";
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
  const items = await constructabilityQueries.listByDeal(params.id);
  return NextResponse.json({ data: items });
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
  const created = await constructabilityQueries.create({
    id: uuidv4(),
    deal_id: params.id,
    title: body.title.trim(),
    description: body.description ?? null,
    category: body.category ?? null,
    severity: body.severity ?? "medium",
    assignee: body.assignee ?? null,
    due_date: body.due_date ?? null,
  });
  return NextResponse.json({ data: created });
}
