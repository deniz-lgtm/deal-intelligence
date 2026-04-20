import { NextRequest, NextResponse } from "next/server";
import { questionQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; questionId: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const body = await req.json();
    const row = await questionQueries.update(params.questionId, body);

    if (!row) {
      return NextResponse.json(
        { error: "Question not found or no updates" },
        { status: 404 }
      );
    }

    return NextResponse.json({ data: row });
  } catch (error) {
    console.error("PATCH /api/deals/[id]/questions/[questionId] error:", error);
    return NextResponse.json({ error: "Failed to update question" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; questionId: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    await questionQueries.delete(params.questionId);
    return NextResponse.json({ data: { success: true } });
  } catch (error) {
    console.error("DELETE /api/deals/[id]/questions/[questionId] error:", error);
    return NextResponse.json({ error: "Failed to delete question" }, { status: 500 });
  }
}
