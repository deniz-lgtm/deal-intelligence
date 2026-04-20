import { NextRequest, NextResponse } from "next/server";
import { locationIntelligenceQueries, dealQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { assertAllowedFetchUrl } from "@/lib/web-allowlist";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

// ── Neighborhood Amenities via OpenStreetMap Overpass API ─────────────────────
// Free, no key required. Returns nearby restaurants, shopping, groceries,
// gyms, parks, hospitals, etc. from the crowdsourced OSM database.

const AMENITY_CATEGORIES = [
  { key: "restaurant", label: "Restaurants", query: `node["amenity"="restaurant"]`, icon: "restaurant" },
  { key: "cafe", label: "Cafes & Coffee", query: `node["amenity"="cafe"]`, icon: "cafe" },
  { key: "grocery", label: "Grocery Stores", query: `node["shop"="supermarket"];node["shop"="grocery"]`, icon: "grocery" },
  { key: "shopping", label: "Shopping", query: `node["shop"="mall"];node["shop"="department_store"];node["shop"="clothes"]`, icon: "shopping" },
  { key: "gym", label: "Gyms & Fitness", query: `node["leisure"="fitness_centre"];node["amenity"="gym"]`, icon: "gym" },
  { key: "park", label: "Parks & Recreation", query: `way["leisure"="park"]`, icon: "park" },
  { key: "hospital", label: "Hospitals & Clinics", query: `node["amenity"="hospital"];node["amenity"="clinic"]`, icon: "hospital" },
  { key: "pharmacy", label: "Pharmacies", query: `node["amenity"="pharmacy"]`, icon: "pharmacy" },
  { key: "bank", label: "Banks", query: `node["amenity"="bank"]`, icon: "bank" },
  { key: "gas_station", label: "Gas Stations", query: `node["amenity"="fuel"]`, icon: "gas" },
];

interface Amenity {
  name: string;
  category: string;
  lat: number;
  lng: number;
  distance_mi: number;
  tags: Record<string, string>;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const body = await req.json();
    const radiusMiles = body.radius_miles ?? 1; // Default 1mi for amenities
    const categories = body.categories || AMENITY_CATEGORIES.map((c) => c.key);

    const deal = await dealQueries.getById(params.id);
    if (!deal?.lat || !deal?.lng) {
      return NextResponse.json({ error: "Deal has no coordinates." }, { status: 400 });
    }

    const lat = Number(deal.lat);
    const lng = Number(deal.lng);
    const radiusMeters = Math.round(radiusMiles * 1609.344);

    // Build Overpass query for selected categories
    const selectedCats = AMENITY_CATEGORIES.filter((c) => categories.includes(c.key));
    const queryParts = selectedCats.map((c) =>
      c.query.split(";").map((q) => `${q}(around:${radiusMeters},${lat},${lng})`).join(";")
    );
    const query = `[out:json][timeout:25];(${queryParts.join(";")};);out center body qt 200;`;
    const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;

    let amenities: Amenity[] = [];

    try {
      assertAllowedFetchUrl(url);
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) {
        return NextResponse.json({ error: "OpenStreetMap Overpass API unavailable." }, { status: 502 });
      }
      const json = await res.json();
      const elements = json.elements || [];

      amenities = elements
        .filter((e: Record<string, unknown>) => {
          const tags = e.tags as Record<string, string> | undefined;
          return tags?.name;
        })
        .map((e: Record<string, unknown>) => {
          const tags = e.tags as Record<string, string>;
          const elat = Number(e.lat || (e.center as Record<string, number>)?.lat || 0);
          const elng = Number(e.lon || (e.center as Record<string, number>)?.lon || 0);

          // Determine category
          let category = "other";
          if (tags.amenity === "restaurant") category = "restaurant";
          else if (tags.amenity === "cafe") category = "cafe";
          else if (tags.shop === "supermarket" || tags.shop === "grocery") category = "grocery";
          else if (tags.shop === "mall" || tags.shop === "department_store" || tags.shop === "clothes") category = "shopping";
          else if (tags.leisure === "fitness_centre" || tags.amenity === "gym") category = "gym";
          else if (tags.leisure === "park") category = "park";
          else if (tags.amenity === "hospital" || tags.amenity === "clinic") category = "hospital";
          else if (tags.amenity === "pharmacy") category = "pharmacy";
          else if (tags.amenity === "bank") category = "bank";
          else if (tags.amenity === "fuel") category = "gas_station";

          return {
            name: tags.name,
            category,
            lat: elat,
            lng: elng,
            distance_mi: haversineMiles(lat, lng, elat, elng),
            tags: {
              cuisine: tags.cuisine || "",
              brand: tags.brand || "",
              opening_hours: tags.opening_hours || "",
              website: tags.website || "",
            },
          };
        })
        .sort((a: Amenity, b: Amenity) => a.distance_mi - b.distance_mi);
    } catch (err) {
      console.error("Overpass amenities fetch error:", err);
      return NextResponse.json({ error: "Failed to fetch amenities." }, { status: 502 });
    }

    // Group by category for summary
    const summary: Record<string, { count: number; nearest_mi: number | null; notable: string[] }> = {};
    for (const a of amenities) {
      if (!summary[a.category]) {
        summary[a.category] = { count: 0, nearest_mi: null, notable: [] };
      }
      summary[a.category].count++;
      if (summary[a.category].nearest_mi == null || a.distance_mi < summary[a.category].nearest_mi!) {
        summary[a.category].nearest_mi = a.distance_mi;
      }
      if (summary[a.category].notable.length < 5) {
        summary[a.category].notable.push(a.name);
      }
    }

    // Merge into location intelligence
    const existing = await locationIntelligenceQueries.getByDealAndRadius(params.id, radiusMiles);
    if (existing) {
      const data = typeof existing.data === "string" ? JSON.parse(existing.data) : existing.data || {};
      data.amenities = amenities.slice(0, 100); // Cap at 100 for storage
      data.amenities_summary = summary;
      data.amenities_total = amenities.length;

      const projections = typeof existing.projections === "string" ? JSON.parse(existing.projections) : existing.projections || {};
      await locationIntelligenceQueries.upsert(
        params.id, existing.id, radiusMiles, data, projections,
        "mixed", existing.source_year,
        `${existing.source_notes || ""}; Amenities (OSM)`
      );
    }

    return NextResponse.json({
      data: { amenities: amenities.slice(0, 100), summary, total: amenities.length },
      meta: { source: "OpenStreetMap (Overpass)", note: `Found ${amenities.length} amenities within ${radiusMiles} miles.` },
    });
  } catch (error) {
    console.error("POST /api/deals/[id]/location-intelligence/fetch-amenities error:", error);
    return NextResponse.json({ error: "Failed to fetch amenities" }, { status: 500 });
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
