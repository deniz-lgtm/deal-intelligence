import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { compQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { enrichCompWithGeocode } from "@/lib/geocode";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const typeParam = req.nextUrl.searchParams.get("type");
    const compType =
      typeParam === "sale" || typeParam === "rent" ? typeParam : undefined;

    const rows = await compQueries.getByDealId(params.id, compType);
    return NextResponse.json({ data: rows });
  } catch (error) {
    console.error("GET /api/deals/[id]/comps error:", error);
    return NextResponse.json({ error: "Failed to fetch comps" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const body = await req.json();
    if (body.comp_type !== "sale" && body.comp_type !== "rent") {
      return NextResponse.json(
        { error: "comp_type must be 'sale' or 'rent'" },
        { status: 400 }
      );
    }

    // Auto-geocode the comp before saving (if address + no existing coords).
    // Failures are swallowed — the comp just saves without lat/lng and the
    // user can run "Geocode Missing" later.
    const payload = await enrichCompWithGeocode({
      ...body,
      id: uuidv4(),
      deal_id: params.id,
    });

    const row = await compQueries.create(payload);
    return NextResponse.json({ data: row });
  } catch (error) {
    console.error("POST /api/deals/[id]/comps error:", error);
    return NextResponse.json({ error: "Failed to create comp" }, { status: 500 });
  }
}
