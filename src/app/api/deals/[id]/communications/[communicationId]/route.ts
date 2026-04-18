import { NextRequest, NextResponse } from "next/server";
import { communicationQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; communicationId: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const body = await req.json();
    const row = await communicationQueries.update(params.communicationId, body);

    if (!row) {
      return NextResponse.json(
        { error: "Communication not found or no updates" },
        { status: 404 }
      );
    }

    return NextResponse.json({ data: row });
  } catch (error) {
    console.error(
      "PATCH /api/deals/[id]/communications/[communicationId] error:",
      error
    );
    return NextResponse.json(
      { error: "Failed to update communication" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; communicationId: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    await communicationQueries.delete(params.communicationId);
    return NextResponse.json({ data: { success: true } });
  } catch (error) {
    console.error(
      "DELETE /api/deals/[id]/communications/[communicationId] error:",
      error
    );
    return NextResponse.json(
      { error: "Failed to delete communication" },
      { status: 500 }
    );
  }
}
