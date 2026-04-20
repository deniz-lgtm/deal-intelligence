import { NextRequest, NextResponse } from "next/server";
import { locationIntelligenceQueries, dealQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { assertAllowedFetchUrl } from "@/lib/web-allowlist";
import { buildAmiTables } from "@/lib/ami-calc";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

// ── HUD Income Limits / Area Median Income (AMI) ─────────────────────────────
//
// Published annually by HUD. The official data source for:
//   - LIHTC rent/income limits (30%, 50%, 60% AMI)
//   - Section 8 / Housing Choice Voucher income eligibility
//   - HOME Investment Partnerships Program
//   - Local inclusionary zoning programs (typically 80% or 120% AMI)
//   - Density bonus programs (many cities use 50%, 80%, 120% AMI tiers)
//
// API: https://www.huduser.gov/hudapi/public/il
// Requires HUD_API_TOKEN env var (free, same key as FMR).
//
// Returns Median Family Income + income limits by household size (1-8 persons)
// at Very Low (50%), Extremely Low (30%), and Low (80%) income levels.
// We compute 60%, 100%, and 120% AMI from the median for LIHTC use.

async function getCountyFips(lat: number, lng: number): Promise<{ state: string; county: string } | null> {
  const url = `https://geocoding.geo.census.gov/geocoder/geographies/coordinates?x=${lng}&y=${lat}&benchmark=Public_AR_Current&vintage=Current_Current&format=json`;
  try {
    assertAllowedFetchUrl(url);
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const json = await res.json();
    const counties = json.result?.geographies?.["Counties"] || [];
    const first = counties[0];
    if (!first) return null;
    return { state: first.STATE || first.STATEFP, county: first.COUNTY || first.COUNTYFP };
  } catch { return null; }
}

interface AmiData {
  year: number;
  area_name: string;
  median_family_income: number;
  // Income limits by AMI level → array indexed by household size (0=1person, 7=8person)
  income_limits: {
    extremely_low_30: number[];  // 30% AMI
    very_low_50: number[];       // 50% AMI
    sixty_pct: number[];         // 60% AMI (computed: 50% × 1.2)
    low_80: number[];            // 80% AMI
    median_100: number[];        // 100% AMI (computed from median)
    moderate_120: number[];      // 120% AMI (computed)
  };
  // Max rents at each AMI level (30% of monthly income, for common unit sizes)
  // Standard: rent = (AMI_limit × 30%) / 12, minus utility allowance
  max_rents: {
    ami_30: { studio: number; one_br: number; two_br: number; three_br: number; four_br: number };
    ami_50: { studio: number; one_br: number; two_br: number; three_br: number; four_br: number };
    ami_60: { studio: number; one_br: number; two_br: number; three_br: number; four_br: number };
    ami_80: { studio: number; one_br: number; two_br: number; three_br: number; four_br: number };
    ami_100: { studio: number; one_br: number; two_br: number; three_br: number; four_br: number };
    ami_120: { studio: number; one_br: number; two_br: number; three_br: number; four_br: number };
  };
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
    const radiusMiles = body.radius_miles ?? 3;

    const deal = await dealQueries.getById(params.id);
    if (!deal?.lat || !deal?.lng) {
      return NextResponse.json({ error: "Deal has no coordinates." }, { status: 400 });
    }

    const hudToken = process.env.HUD_API_TOKEN;
    if (!hudToken) {
      return NextResponse.json(
        { error: "HUD_API_TOKEN not configured. Register free at huduser.gov/hudapi." },
        { status: 503 }
      );
    }

    const fips = await getCountyFips(Number(deal.lat), Number(deal.lng));
    if (!fips) {
      return NextResponse.json({ error: "Could not determine county." }, { status: 502 });
    }

    // HUD entity ID for county income limits
    const entityId = `${fips.state}${fips.county}99999`;

    // Try current year first, then fall back
    const currentYear = new Date().getFullYear();
    const yearsToTry = [currentYear, currentYear - 1];
    let amiResult: AmiData | null = null;

    for (const year of yearsToTry) {
      const url = `https://www.huduser.gov/hudapi/public/il/data/${entityId}?year=${year}`;

      try {
        assertAllowedFetchUrl(url);
        const res = await fetch(url, {
          signal: AbortSignal.timeout(15000),
          headers: { Authorization: `Bearer ${hudToken}` },
        });

        if (!res.ok) continue;
        const json = await res.json();
        const d = json.data;
        if (!d || !d.median_income) continue;

        const medianIncome = Number(d.median_income) || 0;

        // HUD's Income Limits API nests the per-HH-size fields under
        // `very_low`, `extremely_low`, and `low` objects (e.g.
        // d.very_low.il50_p1). Older or alternate payloads flatten these onto
        // the root. Accept either format.
        const getHHLimits = (prefix: string, nestedKey: string): number[] => {
          const nested = d[nestedKey] as Record<string, unknown> | undefined;
          const limits: number[] = [];
          for (let p = 1; p <= 8; p++) {
            const key = `${prefix}_p${p}`;
            const raw = nested?.[key] ?? d[key];
            limits.push(Number(raw) || 0);
          }
          return limits;
        };

        // buildAmiTables applies HUD standard family-size adjustments and falls
        // back to deriving from MFI when the HUD response omits per-HH limits
        // (common for non-metro counties).
        const tables = buildAmiTables(medianIncome, {
          very_low_50: getHHLimits("il50", "very_low"),
          extremely_low_30: getHHLimits("il30", "extremely_low"),
          low_80: getHHLimits("il80", "low"),
        });

        amiResult = {
          year,
          area_name: d.area_name || d.county_name || `County ${fips.state}${fips.county}`,
          median_family_income: medianIncome,
          income_limits: tables.income_limits,
          max_rents: tables.max_rents,
        };
        break;
      } catch (err) {
        console.error(`HUD IL fetch error (${year}):`, err);
      }
    }

    if (!amiResult) {
      return NextResponse.json(
        { error: "HUD Income Limit data not available for this county." },
        { status: 404 }
      );
    }

    // Merge into location intelligence
    const existing = await locationIntelligenceQueries.getByDealAndRadius(params.id, radiusMiles);
    if (existing) {
      const data = typeof existing.data === "string" ? JSON.parse(existing.data) : existing.data || {};
      data.ami = amiResult;
      data.median_family_income = amiResult.median_family_income;
      data.ami_year = amiResult.year;

      const projections = typeof existing.projections === "string" ? JSON.parse(existing.projections) : existing.projections || {};

      await locationIntelligenceQueries.upsert(
        params.id, existing.id, radiusMiles, data, projections,
        "mixed", existing.source_year,
        `${existing.source_notes || ""}; HUD AMI ${amiResult.year} (${amiResult.area_name})`
      );
    }

    return NextResponse.json({
      data: amiResult,
      meta: {
        source: `HUD Income Limits FY${amiResult.year}`,
        area: amiResult.area_name,
        note: `Area Median Income: $${amiResult.median_family_income.toLocaleString()}. Max 60% AMI 2BR rent: $${amiResult.max_rents.ami_60.two_br}/mo.`,
      },
    });
  } catch (error) {
    console.error("POST /api/deals/[id]/location-intelligence/fetch-ami error:", error);
    return NextResponse.json({ error: "Failed to fetch AMI data" }, { status: 500 });
  }
}
