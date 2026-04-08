import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { compQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";

/**
 * POST /api/deals/[id]/comps/[compId]/to-workspace
 *
 * Clones a deal-attached comp into a workspace-level comp. The original row
 * stays attached to its deal; the new row has deal_id = null and
 * source_deal_id = the original deal, so the workspace library shows where
 * it came from.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string; compId: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(
      params.id,
      userId
    );
    if (accessError) return accessError;

    const original = await compQueries.getById(params.compId);
    if (!original || original.deal_id !== params.id) {
      return NextResponse.json({ error: "Comp not found" }, { status: 404 });
    }

    const clone = {
      id: uuidv4(),
      deal_id: null,
      source_deal_id: original.deal_id,
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
      source_note: `Promoted to workspace from deal ${params.id}`,
      extra: original.extra ?? {},
    };

    const row = await compQueries.create(clone);
    return NextResponse.json({ data: row });
  } catch (error) {
    console.error("POST to-workspace error:", error);
    return NextResponse.json(
      { error: "Failed to promote comp to workspace" },
      { status: 500 }
    );
  }
}
