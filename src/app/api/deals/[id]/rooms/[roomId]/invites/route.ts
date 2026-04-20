import { NextRequest, NextResponse } from "next/server";
import { dealRoomQueries } from "@/lib/deal-room";
import { requireAuth, requireDealAccess } from "@/lib/auth";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

/**
 * POST body: { email: string, name?: string, expires_at?: string }
 * Creates a magic-link invite. Returns the raw token exactly ONCE so the
 * owner can copy the link. The raw token is never stored.
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
    const email: string = body.email?.trim();
    if (!email) {
      return NextResponse.json({ error: "email is required" }, { status: 400 });
    }

    const { invite, token } = await dealRoomQueries.createInvite({
      room_id: params.roomId,
      email,
      name: body.name?.trim() || undefined,
      expires_at: body.expires_at ?? null,
    });

    return NextResponse.json({ data: { invite, token } });
  } catch (error) {
    console.error(
      "POST /api/deals/[id]/rooms/[roomId]/invites error:",
      error
    );
    return NextResponse.json(
      { error: "Failed to create invite" },
      { status: 500 }
    );
  }
}
