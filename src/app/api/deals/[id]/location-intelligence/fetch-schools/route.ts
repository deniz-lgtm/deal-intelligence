import { NextRequest, NextResponse } from "next/server";
import { locationIntelligenceQueries, dealQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { assertAllowedFetchUrl } from "@/lib/web-allowlist";

// ── Nearby Schools via OpenStreetMap Overpass ─────────────────────────────────
// Free, no key required. Returns nearby schools with name, type, and location.
// School ratings are not available from free sources — users can enrich
// via the "Paste Report" flow with Niche.com or GreatSchools data.

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

    const lat = Number(deal.lat);
    const lng = Number(deal.lng);

    interface School {
      name: string;
      type: string;
      level: string;
      distance_mi: number | null;
      lat: number;
      lng: number;
      address: string | null;
    }

    let schools: School[] = [];

    const radiusMeters = Math.round(radiusMiles * 1609.344);
    const query = `[out:json][timeout:15];(node["amenity"="school"](around:${radiusMeters},${lat},${lng});way["amenity"="school"](around:${radiusMeters},${lat},${lng}););out center body;`;
    const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;

    try {
      assertAllowedFetchUrl(url);
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (res.ok) {
        const json = await res.json();
        const elements = json.elements || [];
        schools = elements
          .filter((e: Record<string, unknown>) => {
            const tags = e.tags as Record<string, string> | undefined;
            return tags?.name;
          })
          .map((e: Record<string, unknown>) => {
            const tags = e.tags as Record<string, string>;
            const elat = Number(e.lat || (e.center as Record<string, number>)?.lat || 0);
            const elng = Number(e.lon || (e.center as Record<string, number>)?.lon || 0);
            return {
              name: tags.name,
              type: tags["school:type"] || tags.operator_type || "unknown",
              level: tags.isced_level || tags.grades || "unknown",
              distance_mi: haversineMiles(lat, lng, elat, elng),
              lat: elat,
              lng: elng,
              address: tags["addr:street"] ? `${tags["addr:housenumber"] || ""} ${tags["addr:street"]}`.trim() : null,
            };
          })
          .sort((a: School, b: School) => (a.distance_mi ?? 99) - (b.distance_mi ?? 99))
          .slice(0, 25);
      }
    } catch (err) {
      console.error("Overpass schools fetch error:", err);
    }

    // Merge into location intelligence
    const existing = await locationIntelligenceQueries.getByDealAndRadius(params.id, radiusMiles);
    if (existing) {
      const data = typeof existing.data === "string" ? JSON.parse(existing.data) : existing.data || {};
      data.schools = schools;
      data.schools_count = schools.length;

      const projections = typeof existing.projections === "string" ? JSON.parse(existing.projections) : existing.projections || {};
      await locationIntelligenceQueries.upsert(
        params.id, existing.id, radiusMiles, data, projections,
        "mixed", existing.source_year,
        `${existing.source_notes || ""}; Schools (OSM)`
      );
    }

    return NextResponse.json({
      data: { schools, source: "OpenStreetMap (Overpass)" },
      meta: { source: "OpenStreetMap (Overpass)", note: `Found ${schools.length} schools within ${radiusMiles} miles.` },
    });
  } catch (error) {
    console.error("POST /api/deals/[id]/location-intelligence/fetch-schools error:", error);
    return NextResponse.json({ error: "Failed to fetch school data" }, { status: 500 });
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
