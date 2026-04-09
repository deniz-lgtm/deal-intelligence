import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { compQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";

/**
 * POST /api/workspace/comps/[id]/copy-to-deal
 * Body: { deal_id: string }
 *
 * Clones a workspace library comp into a target deal. The original row is
 * left untouched; a new row is inserted with deal_id = target, and
 * source_deal_id preserved from the original (or set to the original's
 * deal_id if the original was deal-attached).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const body = await req.json();
    const targetDealId: string | undefined = body.deal_id;
    if (!targetDealId) {
      return NextResponse.json(
        { error: "deal_id is required" },
        { status: 400 }
      );
    }

    // Caller must have access to the target deal
    const { errorResponse: accessError } = await requireDealAccess(
      targetDealId,
      userId
    );
    if (accessError) return accessError;

    const original = await compQueries.getById(params.id);
    if (!original) {
      return NextResponse.json({ error: "Comp not found" }, { status: 404 });
    }

    // Preserve provenance: prefer existing source_deal_id, fall back to the
    // original row's deal_id if it was attached. If neither, leave null.
    const sourceDealId =
      original.source_deal_id ?? original.deal_id ?? null;

    const clone = {
      id: uuidv4(),
      deal_id: targetDealId,
      source_deal_id: sourceDealId,
      comp_type: original.comp_type,
      name: original.name,
      address: original.address,
      city: original.city,
      state: original.state,
      property_type: original.property_type,
      year_built: original.year_built,
      units: original.units,
      total_sf: original.total_sf,
      sale_price: original.sale_price,
      sale_date: original.sale_date,
      cap_rate: original.cap_rate,
      noi: original.noi,
      price_per_unit: original.price_per_unit,
      price_per_sf: original.price_per_sf,
      rent_per_unit: original.rent_per_unit,
      rent_per_sf: original.rent_per_sf,
      rent_per_bed: original.rent_per_bed,
      occupancy_pct: original.occupancy_pct,
      lease_type: original.lease_type,
      distance_mi: original.distance_mi,
      selected: true,
      source: original.source,
      source_url: original.source_url,
      source_note: sourceDealId
        ? `Copied from Comps Library (source deal ${sourceDealId})`
        : `Copied from Comps Library`,
      extra: original.extra ?? {},
    };

    const row = await compQueries.create(clone);
    return NextResponse.json({ data: row });
  } catch (error) {
    console.error("POST /api/workspace/comps/[id]/copy-to-deal error:", error);
    return NextResponse.json(
      { error: "Failed to copy comp to deal" },
      { status: 500 }
    );
  }
}
