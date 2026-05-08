import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { decisionQueries } from "@/lib/db";
import { requireAuth, requireDealAccess, requireDealEditAccess } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; decisionId: string } }
) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
  if (accessError) return accessError;

  const rows = await decisionQueries.listComments(params.decisionId);
  return NextResponse.json({ data: rows });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; decisionId: string } }
) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const { errorResponse: accessError } = await requireDealEditAccess(params.id, userId);
  if (accessError) return accessError;

  const body = await req.json();
  if (!body.body?.trim()) {
    return NextResponse.json({ error: "body is required" }, { status: 400 });
  }

  const created = await decisionQueries.addComment({
    id: uuidv4(),
    decision_id: params.decisionId,
    author_user_id: userId,
    body: body.body.trim(),
  });
  return NextResponse.json({ data: created });
}
