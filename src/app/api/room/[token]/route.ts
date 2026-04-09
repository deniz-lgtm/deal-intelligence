import { NextRequest, NextResponse } from "next/server";
import { dealRoomQueries } from "@/lib/deal-room";
import { dealQueries } from "@/lib/db";

/**
 * GET /api/room/[token]
 *
 * Public endpoint — no auth. Validates the magic-link token, returns the
 * room metadata + document list (only if NDA accepted, or not required).
 * Also logs a `room_viewed` activity event on each call.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  try {
    const lookup = await dealRoomQueries.findInviteByToken(params.token);
    if (!lookup) {
      return NextResponse.json(
        { error: "Invalid or expired link" },
        { status: 404 }
      );
    }

    const { invite, room } = lookup;
    const deal = await dealQueries.getById(room.deal_id);

    const ndaRequired = room.nda_required;
    const ndaAccepted = !!invite.nda_accepted_at;

    // Log the view
    await dealRoomQueries.logActivity({
      room_id: room.id,
      invite_id: invite.id,
      email: invite.email,
      event: "room_viewed",
      ip: getIp(req),
      user_agent: req.headers.get("user-agent") || null,
    });

    // If NDA required and not yet accepted, return only the NDA text
    // (no document list, no deal details beyond name).
    if (ndaRequired && !ndaAccepted) {
      return NextResponse.json({
        data: {
          room: {
            id: room.id,
            name: room.name,
            description: room.description,
            nda_required: true,
            nda_text: room.nda_text,
          },
          deal: {
            name: deal?.name ?? "",
          },
          nda_accepted: false,
          documents: [],
          viewer_email: invite.email,
        },
      });
    }

    const documents = await dealRoomQueries.listDocuments(room.id);

    return NextResponse.json({
      data: {
        room: {
          id: room.id,
          name: room.name,
          description: room.description,
          nda_required: room.nda_required,
        },
        deal: {
          name: deal?.name ?? "",
          address: deal?.address ?? "",
          city: deal?.city ?? "",
          state: deal?.state ?? "",
        },
        nda_accepted: ndaAccepted,
        documents: documents.map((d: Record<string, unknown>) => ({
          id: d.document_id,
          name: d.name,
          original_name: d.original_name,
          category: d.category,
          mime_type: d.mime_type,
          file_size: d.file_size,
        })),
        viewer_email: invite.email,
      },
    });
  } catch (error) {
    console.error("GET /api/room/[token] error:", error);
    return NextResponse.json(
      { error: "Failed to load room" },
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
