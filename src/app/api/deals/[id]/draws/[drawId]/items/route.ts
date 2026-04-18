import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { drawItemQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; drawId: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const items = await drawItemQueries.getByDrawId(params.drawId);
    return NextResponse.json({ data: items });
  } catch (error) {
    console.error("GET /api/deals/[id]/draws/[drawId]/items error:", error);
    return NextResponse.json({ error: "Failed to fetch draw items" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; drawId: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const body = await req.json();
    if (!body.description?.trim()) {
      return NextResponse.json({ error: "description is required" }, { status: 400 });
    }

    const payload = {
      id: uuidv4(),
      draw_id: params.drawId,
      hardcost_item_id: body.hardcost_item_id || null,
      description: body.description.trim(),
      amount_requested: body.amount_requested ?? 0,
      amount_approved: body.amount_approved ?? null,
      sort_order: body.sort_order ?? 0,
    };

    const item = await drawItemQueries.create(payload);
    return NextResponse.json({ data: item });
  } catch (error) {
    console.error("POST /api/deals/[id]/draws/[drawId]/items error:", error);
    return NextResponse.json({ error: "Failed to create draw item" }, { status: 500 });
  }
}
