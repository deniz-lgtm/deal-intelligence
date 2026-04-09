import { NextRequest, NextResponse } from "next/server";
import { dealRoomQueries } from "@/lib/deal-room";
import { requireAuth, requireDealAccess } from "@/lib/auth";

export async function GET(
  _req: NextRequest,
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

    const room = await dealRoomQueries.getById(params.roomId);
    if (!room || room.deal_id !== params.id) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }
    const [documents, invites, activity] = await Promise.all([
      dealRoomQueries.listDocuments(params.roomId),
      dealRoomQueries.listInvites(params.roomId),
      dealRoomQueries.listActivity(params.roomId, 100),
    ]);

    return NextResponse.json({
      data: { room, documents, invites, activity },
    });
  } catch (error) {
    console.error("GET /api/deals/[id]/rooms/[roomId] error:", error);
    return NextResponse.json(
      { error: "Failed to fetch room" },
      { status: 500 }
    );
  }
}

export async function PATCH(
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

    const existing = await dealRoomQueries.getById(params.roomId);
    if (!existing || existing.deal_id !== params.id) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }

    const body = await req.json();
    const row = await dealRoomQueries.update(params.roomId, body);
    return NextResponse.json({ data: row });
  } catch (error) {
    console.error("PATCH /api/deals/[id]/rooms/[roomId] error:", error);
    return NextResponse.json(
      { error: "Failed to update room" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; roomId: string } }
) {
  // "Delete" is actually revoke so the activity log is preserved.
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(
      params.id,
      userId
    );
    if (accessError) return accessError;

    await dealRoomQueries.revoke(params.roomId);
    return NextResponse.json({ data: { success: true } });
  } catch (error) {
    console.error("DELETE /api/deals/[id]/rooms/[roomId] error:", error);
    return NextResponse.json(
      { error: "Failed to revoke room" },
      { status: 500 }
    );
  }
}
