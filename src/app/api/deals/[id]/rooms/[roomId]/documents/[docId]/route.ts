import { NextRequest, NextResponse } from "next/server";
import { dealRoomQueries } from "@/lib/deal-room";
import { requireAuth, requireDealAccess } from "@/lib/auth";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; roomId: string; docId: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(
      params.id,
      userId
    );
    if (accessError) return accessError;

    await dealRoomQueries.removeDocument(params.roomId, params.docId);
    return NextResponse.json({ data: { success: true } });
  } catch (error) {
    console.error(
      "DELETE /api/deals/[id]/rooms/[roomId]/documents/[docId] error:",
      error
    );
    return NextResponse.json(
      { error: "Failed to remove document" },
      { status: 500 }
    );
  }
}
