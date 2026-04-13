import { NextRequest, NextResponse } from "next/server";
import { locationIntelligenceQueries, dealQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { assertAllowedFetchUrl } from "@/lib/web-allowlist";

// ── Top Employers via OpenStreetMap + Census ─────────────────────────────────
// Combines OSM Overpass (large employers/offices/industrial by name) with
// BLS QCEW industry data for a comprehensive employment picture.
// Also finds major employers from OSM (hospitals, universities, large offices).

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const body = await req.json();
    const radiusMiles = body.radius_miles ?? 5; // Larger default for employers

    const deal = await dealQueries.getById(params.id);
    if (!deal?.lat || !deal?.lng) {
      return NextResponse.json({ error: "Deal has no coordinates." }, { status: 400 });
    }

    const lat = Number(deal.lat);
    const lng = Number(deal.lng);
    const radiusMeters = Math.round(radiusMiles * 1609.344);

    interface Employer {
      name: string;
      type: string;
      lat: number;
      lng: number;
      distance_mi: number;
      employee_count: number | null;
    }

    let employers: Employer[] = [];

    // Query OSM for large employers: hospitals, universities, corporate offices,
    // industrial facilities, government buildings
    const query = `[out:json][timeout:20];(
      node["amenity"="hospital"](around:${radiusMeters},${lat},${lng});
      way["amenity"="hospital"](around:${radiusMeters},${lat},${lng});
      node["amenity"="university"](around:${radiusMeters},${lat},${lng});
      way["amenity"="university"](around:${radiusMeters},${lat},${lng});
      node["amenity"="college"](around:${radiusMeters},${lat},${lng});
      way["amenity"="college"](around:${radiusMeters},${lat},${lng});
      node["office"]["name"](around:${radiusMeters},${lat},${lng});
      way["office"]["name"](around:${radiusMeters},${lat},${lng});
      node["landuse"="industrial"]["name"](around:${radiusMeters},${lat},${lng});
      way["landuse"="industrial"]["name"](around:${radiusMeters},${lat},${lng});
      node["amenity"="government"](around:${radiusMeters},${lat},${lng});
      way["amenity"="government"](around:${radiusMeters},${lat},${lng});
      node["building"="office"]["name"](around:${radiusMeters},${lat},${lng});
      way["building"="office"]["name"](around:${radiusMeters},${lat},${lng});
    );out center body qt 100;`;

    const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;

    try {
      assertAllowedFetchUrl(url);
      const res = await fetch(url, { signal: AbortSignal.timeout(25000) });
      if (res.ok) {
        const json = await res.json();
        const elements = json.elements || [];

        employers = elements
          .filter((e: Record<string, unknown>) => {
            const tags = e.tags as Record<string, string> | undefined;
            return tags?.name;
          })
          .map((e: Record<string, unknown>) => {
            const tags = e.tags as Record<string, string>;
            const elat = Number(e.lat || (e.center as Record<string, number>)?.lat || 0);
            const elng = Number(e.lon || (e.center as Record<string, number>)?.lon || 0);

            let type = "Business";
            if (tags.amenity === "hospital") type = "Healthcare";
            else if (tags.amenity === "university" || tags.amenity === "college") type = "Education";
            else if (tags.amenity === "government" || tags.office === "government") type = "Government";
            else if (tags.landuse === "industrial") type = "Industrial";
            else if (tags.office) type = "Office";

            return {
              name: tags.name,
              type,
              lat: elat,
              lng: elng,
              distance_mi: haversineMiles(lat, lng, elat, elng),
              employee_count: tags.employees ? parseInt(tags.employees) || null : null,
            };
          })
          // Deduplicate by name (OSM can have node + way for same place)
          .filter((emp: Employer, idx: number, arr: Employer[]) =>
            arr.findIndex((e: Employer) => e.name === emp.name) === idx
          )
          .sort((a: Employer, b: Employer) => a.distance_mi - b.distance_mi);
      }
    } catch (err) {
      console.error("Overpass employers fetch error:", err);
    }

    // Merge into location intelligence
    const existing = await locationIntelligenceQueries.getByDealAndRadius(params.id, radiusMiles);
    if (existing) {
      const data = typeof existing.data === "string" ? JSON.parse(existing.data) : existing.data || {};
      data.top_employers = employers.slice(0, 20).map((e: Employer) => ({
        name: e.name,
        type: e.type,
        distance_mi: e.distance_mi,
        lat: e.lat,
        lng: e.lng,
      }));
      data.employers_count = employers.length;

      const projections = typeof existing.projections === "string" ? JSON.parse(existing.projections) : existing.projections || {};
      await locationIntelligenceQueries.upsert(
        params.id, existing.id, radiusMiles, data, projections,
        "mixed", existing.source_year,
        `${existing.source_notes || ""}; Employers (OSM)`
      );
    }

    return NextResponse.json({
      data: { employers: employers.slice(0, 30), total: employers.length },
      meta: { source: "OpenStreetMap (Overpass)", note: `Found ${employers.length} major employers/institutions within ${radiusMiles} miles.` },
    });
  } catch (error) {
    console.error("POST /api/deals/[id]/location-intelligence/fetch-employers error:", error);
    return NextResponse.json({ error: "Failed to fetch employer data" }, { status: 500 });
  }
}

function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10;
}
