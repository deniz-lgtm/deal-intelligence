import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { siteWalkQueries, siteWalkDeficiencyQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; walkId: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;
    const deficiencies = await siteWalkDeficiencyQueries.getByWalkId(params.walkId);
    return NextResponse.json({ data: deficiencies });
  } catch (err) {
    console.error("GET deficiencies error:", err);
    return NextResponse.json({ error: "Failed to fetch deficiencies" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; walkId: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const walk = await siteWalkQueries.getById(params.walkId) as { deal_id: string } | null;
    if (!walk || walk.deal_id !== params.id) {
      return NextResponse.json({ error: "Site walk not found" }, { status: 404 });
    }

    const body = await req.json();
    if (!body.description?.trim()) {
      return NextResponse.json({ error: "description is required" }, { status: 400 });
    }

    const deficiency = await siteWalkDeficiencyQueries.create({
      id: uuidv4(),
      site_walk_id: params.walkId,
      deal_id: params.id,
      area_tag: body.area_tag || "general",
      description: body.description.trim(),
      severity: body.severity || "minor",
      category: body.category || "other",
      estimated_cost: body.estimated_cost ?? null,
      photo_id: body.photo_id ?? null,
      status: body.status || "open",
      notes: body.notes ?? null,
    });

    return NextResponse.json({ data: deficiency });
  } catch (err) {
    console.error("POST deficiency error:", err);
    return NextResponse.json({ error: "Failed to create deficiency" }, { status: 500 });
  }
}
