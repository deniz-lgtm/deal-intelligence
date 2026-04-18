import { NextRequest, NextResponse } from "next/server";
import { locationIntelligenceQueries, dealQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { assertAllowedFetchUrl } from "@/lib/web-allowlist";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

// ── HUD Fair Market Rents (FMR) ──────────────────────────────────────────────
//
// Annual rent limits by county/metro and bedroom count. Used for Section 8,
// LIHTC, and as official rent benchmarks by appraisers and lenders.
//
// API: https://www.huduser.gov/hudapi/public/fmr/data/{ENTITYID}
// Requires HUD_API_TOKEN env var (free, register at huduser.gov).
// Falls back to statewide FMR if county-level unavailable.

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

interface FmrData {
  year: number;
  area_name: string;
  studio: number | null;
  one_br: number | null;
  two_br: number | null;
  three_br: number | null;
  four_br: number | null;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
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

    // HUD entity ID for county FMR is the 10-digit FIPS + 99999
    const entityId = `${fips.state}${fips.county}99999`;
    const url = `https://www.huduser.gov/hudapi/public/fmr/data/${entityId}`;

    let fmrResult: FmrData | null = null;

    try {
      assertAllowedFetchUrl(url);
      const res = await fetch(url, {
        signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${hudToken}` },
      });

      if (res.ok) {
        const json = await res.json();
        const d = json.data;
        if (d) {
          fmrResult = {
            year: d.year || new Date().getFullYear(),
            area_name: d.area_name || d.county_name || `County ${fips.state}${fips.county}`,
            studio: d.Efficiency || d.efficiency || null,
            one_br: d.One_Bedroom || d.one_bedroom || null,
            two_br: d.Two_Bedroom || d.two_bedroom || null,
            three_br: d.Three_Bedroom || d.three_bedroom || null,
            four_br: d.Four_Bedroom || d.four_bedroom || null,
          };
        }
      }
    } catch (err) {
      console.error("HUD FMR fetch error:", err);
    }

    if (!fmrResult) {
      return NextResponse.json(
        { error: "HUD Fair Market Rent data not available for this county." },
        { status: 404 }
      );
    }

    // Merge into location intelligence
    const existing = await locationIntelligenceQueries.getByDealAndRadius(params.id, radiusMiles);
    if (existing) {
      const data = typeof existing.data === "string" ? JSON.parse(existing.data) : existing.data || {};
      data.hud_fmr = fmrResult;
      data.hud_fmr_2br = fmrResult.two_br;

      const projections = typeof existing.projections === "string" ? JSON.parse(existing.projections) : existing.projections || {};

      await locationIntelligenceQueries.upsert(
        params.id, existing.id, radiusMiles, data, projections,
        "mixed", existing.source_year,
        `${existing.source_notes || ""}; HUD FMR ${fmrResult.year} (${fmrResult.area_name})`
      );
    }

    return NextResponse.json({
      data: fmrResult,
      meta: {
        source: "HUD Fair Market Rents",
        year: fmrResult.year,
        area: fmrResult.area_name,
        note: `FY${fmrResult.year} Fair Market Rents for ${fmrResult.area_name}. 2BR: $${fmrResult.two_br}/mo.`,
      },
    });
  } catch (error) {
    console.error("POST /api/deals/[id]/location-intelligence/fetch-fmr error:", error);
    return NextResponse.json({ error: "Failed to fetch HUD FMR data" }, { status: 500 });
  }
}
