import { NextRequest, NextResponse } from "next/server";
import { getPool, dealQueries, submarketMetricsQueries, locationIntelligenceQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/deals/[id]/copilot/benchmarks
 *
 * Returns a reference set of benchmark values the Co-Pilot sidebar can
 * display alongside the current UW values. Three sources:
 *
 *   1. Submarket metrics for this deal (from the Comps & Market tab)
 *   2. Workspace comps aggregates — median cap rate and rent/SF by
 *      property type, computed across every comp the user can see
 *   3. Hard-coded market defaults by property type, used as a fallback
 *
 * No Claude calls — this is pure DB aggregation + static data.
 */

const PROPERTY_TYPE_DEFAULTS: Record<
  string,
  {
    vacancy_rate: number;
    expense_ratio: number;
    management_fee_pct: number;
    cap_rate: number;
    rent_growth: number;
    expense_growth: number;
  }
> = {
  multifamily: {
    vacancy_rate: 5,
    expense_ratio: 45,
    management_fee_pct: 4,
    cap_rate: 5.5,
    rent_growth: 3,
    expense_growth: 3,
  },
  student_housing: {
    vacancy_rate: 7,
    expense_ratio: 48,
    management_fee_pct: 4,
    cap_rate: 6,
    rent_growth: 3,
    expense_growth: 3,
  },
  office: {
    vacancy_rate: 10,
    expense_ratio: 40,
    management_fee_pct: 3,
    cap_rate: 7,
    rent_growth: 2.5,
    expense_growth: 3,
  },
  retail: {
    vacancy_rate: 7,
    expense_ratio: 25,
    management_fee_pct: 3,
    cap_rate: 6.5,
    rent_growth: 2,
    expense_growth: 3,
  },
  industrial: {
    vacancy_rate: 5,
    expense_ratio: 15,
    management_fee_pct: 2.5,
    cap_rate: 6,
    rent_growth: 3.5,
    expense_growth: 3,
  },
  mixed_use: {
    vacancy_rate: 7,
    expense_ratio: 38,
    management_fee_pct: 3.5,
    cap_rate: 6,
    rent_growth: 2.5,
    expense_growth: 3,
  },
  hospitality: {
    vacancy_rate: 30,
    expense_ratio: 65,
    management_fee_pct: 4,
    cap_rate: 8,
    rent_growth: 2,
    expense_growth: 3,
  },
};

// Ground-up development benchmarks by property type (California-focused)
const GROUND_UP_DEFAULTS: Record<
  string,
  {
    hard_cost_per_sf_low: number;
    hard_cost_per_sf_high: number;
    soft_cost_pct: number;
    parking_cost_surface: number;
    parking_cost_structured: number;
    parking_cost_underground: number;
    parking_ratio_residential: number;
    parking_ratio_commercial: number;
    absorption_units_per_month: number;
    construction_months: number;
    construction_loan_rate: number;
    construction_ltc: number;
    dev_fee_pct: number;
  }
> = {
  multifamily: {
    hard_cost_per_sf_low: 250, hard_cost_per_sf_high: 450,
    soft_cost_pct: 25, parking_cost_surface: 10000, parking_cost_structured: 35000,
    parking_cost_underground: 55000, parking_ratio_residential: 1.5, parking_ratio_commercial: 4.0,
    absorption_units_per_month: 15, construction_months: 18, construction_loan_rate: 7.5,
    construction_ltc: 65, dev_fee_pct: 4,
  },
  mixed_use: {
    hard_cost_per_sf_low: 280, hard_cost_per_sf_high: 500,
    soft_cost_pct: 28, parking_cost_surface: 10000, parking_cost_structured: 40000,
    parking_cost_underground: 60000, parking_ratio_residential: 1.25, parking_ratio_commercial: 4.0,
    absorption_units_per_month: 12, construction_months: 22, construction_loan_rate: 7.5,
    construction_ltc: 60, dev_fee_pct: 4,
  },
  retail: {
    hard_cost_per_sf_low: 200, hard_cost_per_sf_high: 400,
    soft_cost_pct: 22, parking_cost_surface: 8000, parking_cost_structured: 30000,
    parking_cost_underground: 50000, parking_ratio_residential: 0, parking_ratio_commercial: 5.0,
    absorption_units_per_month: 0, construction_months: 14, construction_loan_rate: 7.5,
    construction_ltc: 60, dev_fee_pct: 3.5,
  },
};

function defaultsFor(propertyType: string | null) {
  if (!propertyType) return PROPERTY_TYPE_DEFAULTS.multifamily;
  return (
    PROPERTY_TYPE_DEFAULTS[propertyType] ?? PROPERTY_TYPE_DEFAULTS.multifamily
  );
}

function groundUpDefaultsFor(propertyType: string | null) {
  if (!propertyType) return GROUND_UP_DEFAULTS.multifamily;
  return GROUND_UP_DEFAULTS[propertyType] ?? GROUND_UP_DEFAULTS.multifamily;
}

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

    const [deal, submarket, locationIntelRows] = await Promise.all([
      dealQueries.getById(params.id),
      submarketMetricsQueries.getByDealId(params.id),
      locationIntelligenceQueries.getByDealId(params.id).catch(() => []),
    ]);

    const propertyType: string | null = deal?.property_type ?? null;
    const defaults = defaultsFor(propertyType);

    // Aggregate workspace comps for the same property type. Medians avoid
    // having a single outlier swing the averages.
    const pool = getPool();
    const accessibleSub = `(
      SELECT DISTINCT d.id FROM deals d
      LEFT JOIN deal_shares ds ON d.id = ds.deal_id AND ds.user_id = $1
      WHERE d.owner_id IS NULL OR d.owner_id = $1 OR ds.deal_id IS NOT NULL
    )`;

    const compsAgg = await pool.query(
      `SELECT
         comp_type,
         COUNT(*)::int AS n,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY cap_rate)      AS median_cap_rate,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY price_per_unit) AS median_price_per_unit,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY price_per_sf)   AS median_price_per_sf,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY rent_per_unit)  AS median_rent_per_unit,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY rent_per_sf)    AS median_rent_per_sf,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY occupancy_pct)  AS median_occupancy
       FROM comps c
       WHERE (c.deal_id IS NULL OR c.deal_id IN ${accessibleSub})
         AND ($2::text IS NULL OR c.property_type = $2)
       GROUP BY comp_type`,
      [userId, propertyType]
    );

    type AggRow = {
      comp_type: "sale" | "rent";
      n: number;
      median_cap_rate: number | null;
      median_price_per_unit: number | null;
      median_price_per_sf: number | null;
      median_rent_per_unit: number | null;
      median_rent_per_sf: number | null;
      median_occupancy: number | null;
    };

    const sale = (compsAgg.rows as AggRow[]).find(
      (r) => r.comp_type === "sale"
    );
    const rent = (compsAgg.rows as AggRow[]).find(
      (r) => r.comp_type === "rent"
    );

    const groundUpDefaults = groundUpDefaultsFor(propertyType);

    // Pick best location intel row (prefer 3mi radius)
    const bestLocIntel = (() => {
      if (!locationIntelRows || locationIntelRows.length === 0) return null;
      const sorted = [...locationIntelRows].sort((a, b) => {
        if (Number(a.radius_miles) === 3) return -1;
        if (Number(b.radius_miles) === 3) return 1;
        return Number(a.radius_miles) - Number(b.radius_miles);
      });
      const row = sorted[0];
      const data = typeof row.data === "string" ? JSON.parse(row.data) : (row.data || {});
      return {
        radius_miles: Number(row.radius_miles),
        population: data.total_population ?? null,
        median_household_income: data.median_household_income ?? null,
        median_home_value: data.median_home_value ?? null,
        median_rent: data.median_gross_rent ?? null,
        unemployment_rate: data.unemployment_rate ?? null,
        owner_occupied_pct: data.owner_occupied_pct ?? null,
        renter_occupied_pct: data.renter_occupied_pct ?? null,
        source_year: row.source_year ?? null,
      };
    })();

    return NextResponse.json({
      data: {
        property_type: propertyType,
        defaults,
        ground_up_defaults: groundUpDefaults,
        submarket: submarket
          ? {
              submarket_name: submarket.submarket_name,
              market_cap_rate: submarket.market_cap_rate,
              market_vacancy: submarket.market_vacancy,
              market_rent_growth: submarket.market_rent_growth,
            }
          : null,
        location_intel: bestLocIntel,
        comps: {
          sale: sale
            ? {
                count: sale.n,
                median_cap_rate: num(sale.median_cap_rate),
                median_price_per_unit: num(sale.median_price_per_unit),
                median_price_per_sf: num(sale.median_price_per_sf),
              }
            : null,
          rent: rent
            ? {
                count: rent.n,
                median_rent_per_unit: num(rent.median_rent_per_unit),
                median_rent_per_sf: num(rent.median_rent_per_sf),
                median_occupancy: num(rent.median_occupancy),
              }
            : null,
        },
      },
    });
  } catch (error) {
    console.error("GET /api/deals/[id]/copilot/benchmarks error:", error);
    return NextResponse.json(
      { error: "Failed to load benchmarks" },
      { status: 500 }
    );
  }
}

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
