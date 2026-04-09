import { NextRequest, NextResponse } from "next/server";
import { dealRoomQueries, DEFAULT_NDA_TEXT } from "@/lib/deal-room";
import { requireAuth, requireDealAccess } from "@/lib/auth";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(
      params.id,
      userId
    );
    if (accessError) return accessError;

    const rooms = await dealRoomQueries.getByDealId(params.id);
    return NextResponse.json({ data: rooms });
  } catch (error) {
    console.error("GET /api/deals/[id]/rooms error:", error);
    return NextResponse.json(
      { error: "Failed to fetch rooms" },
      { status: 500 }
    );
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(
      params.id,
      userId
    );
    if (accessError) return accessError;

    const body = await req.json().catch(() => ({}));
    const name: string = (body.name || "Deal Room").trim();
    const description: string | undefined = body.description?.trim() || undefined;
    const nda_required: boolean =
      body.nda_required != null ? Boolean(body.nda_required) : true;
    const nda_text: string = body.nda_text?.trim() || DEFAULT_NDA_TEXT;
    const expires_at: string | null = body.expires_at ?? null;

    const room = await dealRoomQueries.create({
      deal_id: params.id,
      name,
      description,
      nda_required,
      nda_text,
      expires_at,
      created_by: userId,
    });

    return NextResponse.json({ data: room });
  } catch (error) {
    console.error("POST /api/deals/[id]/rooms error:", error);
    return NextResponse.json(
      { error: "Failed to create room" },
      { status: 500 }
    );
  }
}
