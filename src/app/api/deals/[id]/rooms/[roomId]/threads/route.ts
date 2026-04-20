import { NextRequest, NextResponse } from "next/server";
import { dealRoomQueries } from "@/lib/deal-room";
import { requireAuth, requireDealAccess } from "@/lib/auth";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

/** GET — list threads for a room (owner view). */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; roomId: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const threads = await dealRoomQueries.listThreads(params.roomId);
    return NextResponse.json({ data: threads });
  } catch (error) {
    console.error("GET threads error:", error);
    return NextResponse.json({ error: "Failed to fetch threads" }, { status: 500 });
  }
}

/** POST — owner replies to a thread. Body: { thread_id, content, email } */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; roomId: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const body = await req.json();
    const { thread_id, content, email } = body;

    if (!thread_id || !content?.trim()) {
      return NextResponse.json({ error: "thread_id and content required" }, { status: 400 });
    }

    const result = await dealRoomQueries.addMessage({
      thread_id,
      author_email: email || "owner",
      author_role: "owner",
      content: content.trim(),
    });

    return NextResponse.json({ data: result });
  } catch (error) {
    console.error("POST thread reply error:", error);
    return NextResponse.json({ error: "Failed to reply" }, { status: 500 });
  }
}
