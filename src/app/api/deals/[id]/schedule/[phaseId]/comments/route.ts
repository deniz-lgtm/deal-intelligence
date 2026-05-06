import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { scheduleCommentQueries } from "@/lib/db";
import { requireAuth, requireDealAccess, requireDealEditAccess } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; phaseId: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const comments = await scheduleCommentQueries.listForPhase(params.id, params.phaseId);
    return NextResponse.json({ data: comments });
  } catch (error) {
    console.error("GET /api/deals/[id]/schedule/[phaseId]/comments error:", error);
    return NextResponse.json({ error: "Failed to fetch comments" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; phaseId: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealEditAccess(params.id, userId);
    if (accessError) return accessError;

    const body = (await req.json()) as { body?: unknown };
    const text = typeof body.body === "string" ? body.body.trim() : "";
    if (!text) {
      return NextResponse.json({ error: "body is required" }, { status: 400 });
    }

    const created = await scheduleCommentQueries.create({
      id: uuidv4(),
      deal_id: params.id,
      phase_id: params.phaseId,
      author_user_id: userId,
      body: text,
    });
    if (!created) {
      return NextResponse.json({ error: "Schedule item not found" }, { status: 404 });
    }

    return NextResponse.json({ data: created }, { status: 201 });
  } catch (error) {
    console.error("POST /api/deals/[id]/schedule/[phaseId]/comments error:", error);
    return NextResponse.json({ error: "Failed to create comment" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; phaseId: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealEditAccess(params.id, userId);
    if (accessError) return accessError;

    const body = (await req.json()) as { comment_id?: unknown; resolved?: unknown };
    const commentId = typeof body.comment_id === "string" ? body.comment_id : "";
    if (!commentId) {
      return NextResponse.json({ error: "comment_id is required" }, { status: 400 });
    }

    const updated = await scheduleCommentQueries.setResolved(
      params.id,
      params.phaseId,
      commentId,
      body.resolved !== false
    );
    if (!updated) {
      return NextResponse.json({ error: "Comment not found" }, { status: 404 });
    }
    return NextResponse.json({ data: updated });
  } catch (error) {
    console.error("PATCH /api/deals/[id]/schedule/[phaseId]/comments error:", error);
    return NextResponse.json({ error: "Failed to update comment" }, { status: 500 });
  }
}
