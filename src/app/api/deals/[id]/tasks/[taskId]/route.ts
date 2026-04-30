import { NextRequest, NextResponse } from "next/server";
import { taskQueries } from "@/lib/db";
import { requireAuth, requireDealEditAccess } from "@/lib/auth";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; taskId: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealEditAccess(params.id, userId);
    if (accessError) return accessError;

    const body = await req.json();
    const task = await taskQueries.updateInDeal(params.taskId, params.id, body);

    if (!task) {
      return NextResponse.json({ error: "Task not found or no updates" }, { status: 404 });
    }

    return NextResponse.json({ data: task });
  } catch (error) {
    console.error("PATCH /api/deals/[id]/tasks/[taskId] error:", error);
    return NextResponse.json({ error: "Failed to update task" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; taskId: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealEditAccess(params.id, userId);
    if (accessError) return accessError;

    const deleted = await taskQueries.deleteInDeal(params.taskId, params.id);
    if (!deleted) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }
    return NextResponse.json({ data: { success: true } });
  } catch (error) {
    console.error("DELETE /api/deals/[id]/tasks/[taskId] error:", error);
    return NextResponse.json({ error: "Failed to delete task" }, { status: 500 });
  }
}
