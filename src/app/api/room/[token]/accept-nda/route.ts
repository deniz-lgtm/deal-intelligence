import { NextRequest, NextResponse } from "next/server";
import { dealRoomQueries } from "@/lib/deal-room";

// Opt out of static analysis at `next build`. Reads auth / headers() / DB.
// Without this flag Next.js evaluates the handler during static-page
// generation and throws Dynamic-server / DATABASE_URL errors.
export const dynamic = "force-dynamic";

/**
 * POST /api/room/[token]/accept-nda
 * Body: { name: string }
 *
 * Records the NDA acceptance for the invite bound to this token. The guest
 * types their name as a "signature" — we store it alongside the timestamp.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  try {
    const body = await req.json();
    const name: string = body.name?.trim();
    if (!name || name.length < 2) {
      return NextResponse.json(
        { error: "Please type your full name to accept" },
        { status: 400 }
      );
    }

    const lookup = await dealRoomQueries.findInviteByToken(params.token);
    if (!lookup) {
      return NextResponse.json(
        { error: "Invalid or expired link" },
        { status: 404 }
      );
    }

    await dealRoomQueries.acceptNda(lookup.invite.id, name);
    await dealRoomQueries.logActivity({
      room_id: lookup.room.id,
      invite_id: lookup.invite.id,
      email: lookup.invite.email,
      event: "nda_accepted",
      ip: getIp(req),
      user_agent: req.headers.get("user-agent") || null,
    });

    return NextResponse.json({ data: { success: true } });
  } catch (error) {
    console.error("POST /api/room/[token]/accept-nda error:", error);
    return NextResponse.json(
      { error: "Failed to record acceptance" },
      { status: 500 }
    );
  }
}

function getIp(req: NextRequest): string | null {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    null
  );
}
