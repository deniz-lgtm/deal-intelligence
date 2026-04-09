import { NextRequest, NextResponse } from "next/server";
import { dealRoomQueries } from "@/lib/deal-room";
import { requireAuth, requireDealAccess } from "@/lib/auth";

/**
 * POST body: { document_ids: string[] }
 * Adds the listed documents to the room. Dedupes via UNIQUE(room_id, document_id).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; roomId: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(
      params.id,
      userId
    );
    if (accessError) return accessError;

    const body = await req.json();
    const ids: string[] = Array.isArray(body.document_ids) ? body.document_ids : [];
    if (ids.length === 0) {
      return NextResponse.json(
        { error: "document_ids is required" },
        { status: 400 }
      );
    }

    await dealRoomQueries.addDocuments(params.roomId, ids);
    const docs = await dealRoomQueries.listDocuments(params.roomId);
    return NextResponse.json({ data: docs });
  } catch (error) {
    console.error("POST /api/deals/[id]/rooms/[roomId]/documents error:", error);
    return NextResponse.json(
      { error: "Failed to add documents" },
      { status: 500 }
    );
  }
}
