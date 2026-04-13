import { NextRequest, NextResponse } from "next/server";
import { locationIntelligenceQueries, dealQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { assertAllowedFetchUrl } from "@/lib/web-allowlist";

// ── Census Population Estimates Program (PEP) ────────────────────────────────
//
// Annual population estimates by county, more current than ACS 5-Year.
// Released each March for the prior July 1 estimate.
//
// API: https://api.census.gov/data/YEAR/pep/population

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

    const fips = await getCountyFips(Number(deal.lat), Number(deal.lng));
    if (!fips) {
      return NextResponse.json({ error: "Could not determine county." }, { status: 502 });
    }

    // Try recent PEP vintages (released ~March each year)
    const currentYear = new Date().getFullYear();
    const vintages = [currentYear - 1, currentYear - 2, currentYear];
    let pepData: Array<{ date: string; population: number }> = [];
    let vintageYear: number | null = null;

    for (const vintage of vintages) {
      // PEP API returns population estimates for a range of dates
      const url = `https://api.census.gov/data/${vintage}/pep/population?get=POP_2020,POP_2021,POP_2022,POP_2023,NAME&for=county:${fips.county}&in=state:${fips.state}`;

      try {
        assertAllowedFetchUrl(url);
        const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (!res.ok) continue;
        const json = await res.json();
        if (!Array.isArray(json) || json.length < 2) continue;

        const headers = json[0] as string[];
        const values = json[1];

        // Extract population values for each year available
        for (let i = 0; i < headers.length; i++) {
          const match = headers[i].match(/^POP_(\d{4})$/);
          if (match) {
            const year = parseInt(match[1]);
            const pop = parseInt(values[i]);
            if (!isNaN(pop) && pop > 0) {
              pepData.push({ date: `${year}-07-01`, population: pop });
            }
          }
        }

        vintageYear = vintage;
        break;
      } catch { continue; }
    }

    // Fallback: try the simpler charEstimate endpoint
    if (pepData.length === 0) {
      for (const vintage of vintages) {
        const url = `https://api.census.gov/data/${vintage}/pep/charEstimates?get=POP,DATE_DESC&for=county:${fips.county}&in=state:${fips.state}`;
        try {
          assertAllowedFetchUrl(url);
          const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
          if (!res.ok) continue;
          const json = await res.json();
          if (!Array.isArray(json) || json.length < 2) continue;

          const headers = json[0] as string[];
          const popIdx = headers.indexOf("POP");
          const descIdx = headers.indexOf("DATE_DESC");

          for (let r = 1; r < json.length; r++) {
            const pop = parseInt(json[r][popIdx]);
            const desc = json[r][descIdx] || "";
            if (!isNaN(pop) && pop > 0 && desc.includes("estimate")) {
              pepData.push({ date: desc, population: pop });
            }
          }
          vintageYear = vintage;
          break;
        } catch { continue; }
      }
    }

    if (pepData.length === 0) {
      return NextResponse.json(
        { error: "Census Population Estimates not available for this county." },
        { status: 404 }
      );
    }

    // Sort by date and compute growth
    pepData.sort((a, b) => a.date.localeCompare(b.date));
    const latest = pepData[pepData.length - 1];
    const earliest = pepData[0];
    const yearSpan = pepData.length > 1 ? pepData.length - 1 : 1;
    const annualGrowth = earliest.population > 0
      ? Math.round(((latest.population - earliest.population) / earliest.population / yearSpan) * 1000) / 10
      : null;

    // Merge into location intelligence
    const existing = await locationIntelligenceQueries.getByDealAndRadius(params.id, radiusMiles);
    if (existing) {
      const data = typeof existing.data === "string" ? JSON.parse(existing.data) : existing.data || {};
      data.pep_population = latest.population;
      data.pep_date = latest.date;
      data.pep_trend = pepData;
      if (annualGrowth != null) {
        data.population_growth_pct = annualGrowth;
      }

      const projections = typeof existing.projections === "string" ? JSON.parse(existing.projections) : existing.projections || {};

      await locationIntelligenceQueries.upsert(
        params.id, existing.id, radiusMiles, data, projections,
        "mixed", existing.source_year,
        `${existing.source_notes || ""}; Census PEP ${vintageYear} (county ${fips.state}${fips.county})`
      );
    }

    return NextResponse.json({
      data: {
        estimates: pepData,
        latest_population: latest.population,
        latest_date: latest.date,
        annual_growth_pct: annualGrowth,
        vintage: vintageYear,
        county_fips: `${fips.state}${fips.county}`,
      },
      meta: {
        source: "Census Population Estimates Program",
        vintage: vintageYear,
        note: `County population: ${latest.population.toLocaleString()} (${latest.date}). Annual growth: ${annualGrowth ?? "N/A"}%.`,
      },
    });
  } catch (error) {
    console.error("POST /api/deals/[id]/location-intelligence/fetch-population error:", error);
    return NextResponse.json({ error: "Failed to fetch population estimates" }, { status: 500 });
  }
}
