import { NextRequest, NextResponse } from "next/server";
import { dealRoomQueries } from "@/lib/deal-room";

// Opt out of static analysis at `next build`. Reads auth / headers() / DB.
// Without this flag Next.js evaluates the handler during static-page
// generation and throws Dynamic-server / DATABASE_URL errors.
export const dynamic = "force-dynamic";

/**
 * GET /api/room/[token]/threads — list Q&A threads for the guest.
 * POST /api/room/[token]/threads — create a new thread or reply.
 *   Body for new thread: { subject, content, document_id? }
 *   Body for reply: { thread_id, content }
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { token: string } }
) {
  const lookup = await dealRoomQueries.findInviteByToken(params.token);
  if (!lookup) {
    return NextResponse.json({ error: "Invalid or expired link" }, { status: 404 });
  }
  if (lookup.room.nda_required && !lookup.invite.nda_accepted_at) {
    return NextResponse.json({ error: "NDA not accepted" }, { status: 403 });
  }

  const threads = await dealRoomQueries.listThreads(lookup.room.id);
  // For each thread, also load messages so the guest can see the conversation
  const withMessages = await Promise.all(
    threads.map(async (t: Record<string, unknown>) => {
      const detail = await dealRoomQueries.getThread(t.id as string);
      return detail;
    })
  );
  return NextResponse.json({ data: withMessages.filter(Boolean) });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  const lookup = await dealRoomQueries.findInviteByToken(params.token);
  if (!lookup) {
    return NextResponse.json({ error: "Invalid or expired link" }, { status: 404 });
  }
  if (lookup.room.nda_required && !lookup.invite.nda_accepted_at) {
    return NextResponse.json({ error: "NDA not accepted" }, { status: 403 });
  }

  const body = await req.json();

  // Reply to existing thread
  if (body.thread_id && body.content?.trim()) {
    const result = await dealRoomQueries.addMessage({
      thread_id: body.thread_id,
      author_email: lookup.invite.email,
      author_role: "guest",
      content: body.content.trim(),
    });
    return NextResponse.json({ data: result });
  }

  // New thread
  if (body.subject?.trim() && body.content?.trim()) {
    const result = await dealRoomQueries.createThread({
      room_id: lookup.room.id,
      invite_id: lookup.invite.id,
      author_email: lookup.invite.email,
      subject: body.subject.trim(),
      document_id: body.document_id ?? null,
      initial_message: body.content.trim(),
    });
    return NextResponse.json({ data: result });
  }

  return NextResponse.json(
    { error: "subject + content required for new thread, or thread_id + content for reply" },
    { status: 400 }
  );
}
