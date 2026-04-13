import { NextRequest, NextResponse } from "next/server";
import { locationIntelligenceQueries, dealQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { assertAllowedFetchUrl } from "@/lib/web-allowlist";

// ── GreatSchools API ─────────────────────────────────────────────────────────
// Free tier available. Returns nearby schools with ratings (1-10 scale).
// Requires GREATSCHOOLS_API_KEY env var.
// API: https://www.greatschools.org/api/docs/
//
// Fallback: If no API key, we use the Overpass API to find school locations
// from OpenStreetMap (no ratings, but still useful for proximity mapping).

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
    const gsKey = process.env.GREATSCHOOLS_API_KEY;

    interface School {
      name: string;
      type: string; // "public", "private", "charter"
      level: string; // "elementary", "middle", "high"
      rating: number | null; // 1-10 (GreatSchools only)
      distance_mi: number | null;
      lat: number;
      lng: number;
      enrollment: number | null;
      address: string | null;
    }

    let schools: School[] = [];
    let source = "";

    if (gsKey) {
      // GreatSchools API
      const url = `https://gs-api.greatschools.org/schools?lat=${lat}&lon=${lng}&radius=${radiusMiles}&limit=25&api_key=${gsKey}`;
      try {
        assertAllowedFetchUrl(url);
        const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (res.ok) {
          const json = await res.json();
          const items = json.schools || json || [];
          schools = items.map((s: Record<string, unknown>) => ({
            name: s.name || s.schoolName || "Unknown",
            type: (s.type || s.schoolType || "unknown") as string,
            level: (s.level || s.gradeRange || "unknown") as string,
            rating: s.rating != null ? Number(s.rating) : s.gsRating != null ? Number(s.gsRating) : null,
            distance_mi: s.distance != null ? Math.round(Number(s.distance) * 10) / 10 : null,
            lat: Number(s.lat || s.latitude || 0),
            lng: Number(s.lon || s.lng || s.longitude || 0),
            enrollment: s.enrollment != null ? Number(s.enrollment) : null,
            address: (s.address || s.street || null) as string | null,
          }));
          source = "GreatSchools API";
        }
      } catch (err) {
        console.error("GreatSchools fetch error:", err);
      }
    }

    // Fallback: OpenStreetMap Overpass for school locations
    if (schools.length === 0) {
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
                rating: null,
                distance_mi: haversineMiles(lat, lng, elat, elng),
                lat: elat,
                lng: elng,
                enrollment: null,
                address: tags["addr:street"] ? `${tags["addr:housenumber"] || ""} ${tags["addr:street"]}`.trim() : null,
              };
            })
            .sort((a: School, b: School) => (a.distance_mi ?? 99) - (b.distance_mi ?? 99))
            .slice(0, 25);
          source = "OpenStreetMap (Overpass)";
        }
      } catch (err) {
        console.error("Overpass schools fetch error:", err);
      }
    }

    // Merge into location intelligence
    const existing = await locationIntelligenceQueries.getByDealAndRadius(params.id, radiusMiles);
    if (existing) {
      const data = typeof existing.data === "string" ? JSON.parse(existing.data) : existing.data || {};
      data.schools = schools;
      data.schools_count = schools.length;
      data.schools_avg_rating = schools.filter((s: School) => s.rating != null).length > 0
        ? Math.round(schools.reduce((sum: number, s: School) => sum + (s.rating ?? 0), 0) / schools.filter((s: School) => s.rating != null).length * 10) / 10
        : null;

      const projections = typeof existing.projections === "string" ? JSON.parse(existing.projections) : existing.projections || {};
      await locationIntelligenceQueries.upsert(
        params.id, existing.id, radiusMiles, data, projections,
        "mixed", existing.source_year,
        `${existing.source_notes || ""}; Schools (${source})`
      );
    }

    return NextResponse.json({
      data: { schools, source },
      meta: { source, note: `Found ${schools.length} schools within ${radiusMiles} miles.` },
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
