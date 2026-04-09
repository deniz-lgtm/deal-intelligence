import { NextRequest, NextResponse } from "next/server";
import { dealRoomQueries } from "@/lib/deal-room";
import { requireAuth, requireDealAccess } from "@/lib/auth";

export async function DELETE(
  _req: NextRequest,
  {
    params,
  }: {
    params: { id: string; roomId: string; inviteId: string };
  }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(
      params.id,
      userId
    );
    if (accessError) return accessError;

    await dealRoomQueries.revokeInvite(params.inviteId);
    return NextResponse.json({ data: { success: true } });
  } catch (error) {
    console.error(
      "DELETE /api/deals/[id]/rooms/[roomId]/invites/[inviteId] error:",
      error
    );
    return NextResponse.json(
      { error: "Failed to revoke invite" },
      { status: 500 }
    );
  }
}
