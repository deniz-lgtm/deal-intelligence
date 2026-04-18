import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { locationIntelligenceQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";

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

    const rows = await locationIntelligenceQueries.getByDealId(params.id);
    return NextResponse.json({ data: rows });
  } catch (error) {
    console.error("GET /api/deals/[id]/location-intelligence error:", error);
    return NextResponse.json(
      { error: "Failed to fetch location intelligence" },
      { status: 500 }
    );
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const body = await req.json();
    const {
      radius_miles,
      data = {},
      projections = {},
      data_source = "manual",
      source_year = null,
      source_notes = null,
    } = body;

    if (!radius_miles || radius_miles <= 0) {
      return NextResponse.json(
        { error: "radius_miles is required and must be positive" },
        { status: 400 }
      );
    }

    const existing = await locationIntelligenceQueries.getByDealAndRadius(
      params.id,
      radius_miles
    );
    const id = existing?.id ?? uuidv4();

    const row = await locationIntelligenceQueries.upsert(
      params.id,
      id,
      radius_miles,
      data,
      projections,
      data_source,
      source_year,
      source_notes
    );

    return NextResponse.json({ data: row });
  } catch (error) {
    console.error("PUT /api/deals/[id]/location-intelligence error:", error);
    return NextResponse.json(
      { error: "Failed to save location intelligence" },
      { status: 500 }
    );
  }
}
