import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import {
  compQueries,
  dealQueries,
  underwritingQueries,
  omAnalysisQueries,
} from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { enrichCompWithGeocode } from "@/lib/geocode";

/**
 * POST /api/workspace/comps/from-deal
 * Body: { deal_id: string, comp_type?: "sale" | "rent", attach_to_deal?: boolean }
 *
 * Snapshots a deal's current state (underwriting + OM analysis + deal fields)
 * into a comp row. Useful for:
 *   - Saving deal actuals as a sale comp once a deal closes
 *   - Capturing an OM you reviewed but aren't pursuing as a workspace comp
 *   - Building institutional memory across deals
 *
 * The new comp is workspace-level by default (deal_id = null) with
 * source_deal_id tracking provenance. If `attach_to_deal` is true the
 * comp is ALSO attached to the same deal (deal_id = deal_id) — useful if
 * you want the snapshot to appear in that deal's Comps tab.
 */
export async function POST(req: NextRequest) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const body = await req.json();
    const dealId: string | undefined = body.deal_id;
    if (!dealId) {
      return NextResponse.json(
        { error: "deal_id is required" },
        { status: 400 }
      );
    }
    const compType: "sale" | "rent" =
      body.comp_type === "rent" ? "rent" : "sale";
    const attachToDeal: boolean = Boolean(body.attach_to_deal);

    // Deal access check
    const { errorResponse: accessError } = await requireDealAccess(
      dealId,
      userId
    );
    if (accessError) return accessError;

    const [deal, uwRow, om] = await Promise.all([
      dealQueries.getById(dealId),
      underwritingQueries.getByDealId(dealId),
      omAnalysisQueries.getByDealId(dealId),
    ]);

    if (!deal) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }

    const uw: Record<string, unknown> | null = uwRow?.data
      ? typeof uwRow.data === "string"
        ? JSON.parse(uwRow.data)
        : uwRow.data
      : null;

    // Numbers helper — coerce unknown → number | null
    const num = (v: unknown): number | null => {
      if (v == null) return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    // Derive sale-side fields
    const salePrice =
      num(uw?.purchase_price) ?? num(deal.asking_price) ?? num(om?.asking_price);
    const noi = num(uw?.stabilized_noi) ?? num(uw?.in_place_noi) ?? num(om?.noi);
    const capRate =
      salePrice && noi ? Number(((noi / salePrice) * 100).toFixed(2)) : num(om?.cap_rate);
    const units = num(deal.units) ?? num(om?.unit_count);
    const totalSf = num(deal.square_footage) ?? num(om?.sf);
    const pricePerUnit =
      salePrice && units ? Number((salePrice / units).toFixed(0)) : num(om?.price_per_unit);
    const pricePerSf =
      salePrice && totalSf ? Number((salePrice / totalSf).toFixed(2)) : num(om?.price_per_sf);

    // For rent comps we reach for market rent per unit / SF from underwriting.
    // UW stores these per unit_group; we aggregate to a weighted average.
    let rentPerUnit: number | null = null;
    let rentPerSf: number | null = null;
    if (compType === "rent" && Array.isArray(uw?.unit_groups)) {
      const groups = uw.unit_groups as Array<Record<string, unknown>>;
      let totalRent = 0;
      let totalUnits = 0;
      let totalSfAnnualRent = 0;
      let totalSfSum = 0;
      for (const g of groups) {
        const n = num(g.unit_count) ?? 0;
        const mrUnit = num(g.market_rent_per_unit);
        const mrSf = num(g.market_rent_per_sf);
        const sfPerUnit = num(g.sf_per_unit);
        if (mrUnit && n) {
          totalRent += mrUnit * n;
          totalUnits += n;
        }
        if (mrSf && sfPerUnit && n) {
          totalSfAnnualRent += mrSf * sfPerUnit * n;
          totalSfSum += sfPerUnit * n;
        }
      }
      if (totalUnits > 0) rentPerUnit = Math.round(totalRent / totalUnits);
      if (totalSfSum > 0) rentPerSf = Number((totalSfAnnualRent / totalSfSum).toFixed(2));
    }

    // Sale date: if the deal is closed, use today as a proxy; otherwise null
    const saleDate = deal.status === "closed" ? new Date().toISOString().slice(0, 10) : null;

    const draft = {
      id: uuidv4(),
      deal_id: attachToDeal ? dealId : null,
      source_deal_id: dealId,
      comp_type: compType,
      name: deal.name ?? null,
      address: deal.address ?? null,
      city: deal.city ?? null,
      state: deal.state ?? null,
      property_type: deal.property_type ?? null,
      year_built: num(deal.year_built),
      units,
      total_sf: totalSf,
      sale_price: compType === "sale" ? salePrice : null,
      sale_date: compType === "sale" ? saleDate : null,
      cap_rate: compType === "sale" ? capRate : null,
      noi: compType === "sale" ? noi : null,
      price_per_unit: compType === "sale" ? pricePerUnit : null,
      price_per_sf: compType === "sale" ? pricePerSf : null,
      rent_per_unit: compType === "rent" ? rentPerUnit : null,
      rent_per_sf: compType === "rent" ? rentPerSf : null,
      rent_per_bed: null,
      occupancy_pct: num(uw?.vacancy_rate)
        ? 100 - (num(uw?.vacancy_rate) as number)
        : null,
      lease_type: null,
      distance_mi: null,
      selected: true,
      source: "deal_snapshot",
      source_url: null,
      source_note: `Snapshot of ${deal.name} (${deal.status}) on ${new Date().toLocaleDateString()}`,
    };

    // Auto-geocode from the deal's address if we don't already have coords.
    // (Deals have their own lat/lng on the deals table now, but this route
    // runs before that field is always populated, so we geocode here too.)
    const enriched = await enrichCompWithGeocode(draft);
    const row = await compQueries.create(enriched);
    return NextResponse.json({ data: row });
  } catch (error) {
    console.error("POST /api/workspace/comps/from-deal error:", error);
    return NextResponse.json(
      { error: "Failed to snapshot deal as comp" },
      { status: 500 }
    );
  }
}
