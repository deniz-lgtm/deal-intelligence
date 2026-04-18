import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { siteWalkQueries } from "@/lib/db";
import { requireAuth, requireDealAccess, syncCurrentUser } from "@/lib/auth";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;
    const walks = await siteWalkQueries.getByDealId(params.id);
    return NextResponse.json({ data: walks });
  } catch (err) {
    console.error("GET /api/deals/[id]/site-walks error:", err);
    return NextResponse.json({ error: "Failed to fetch site walks" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    await syncCurrentUser(userId);
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const body = await req.json();
    const walk = await siteWalkQueries.create({
      id: uuidv4(),
      deal_id: params.id,
      title: body.title ?? "",
      walk_date: body.walk_date ?? undefined,
      status: body.status ?? "draft",
      attendees: Array.isArray(body.attendees) ? body.attendees : [],
      property_contact: body.property_contact ?? null,
      weather: body.weather ?? null,
      summary: body.summary ?? null,
      created_by: userId,
    });

    return NextResponse.json({ data: walk });
  } catch (err) {
    console.error("POST /api/deals/[id]/site-walks error:", err);
    return NextResponse.json({ error: "Failed to create site walk" }, { status: 500 });
  }
}
