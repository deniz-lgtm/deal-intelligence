import { NextRequest, NextResponse } from "next/server";
import { locationIntelligenceQueries, dealQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { assertAllowedFetchUrl } from "@/lib/web-allowlist";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

// ── Google Places API (Nearby Search) ────────────────────────────────────────
//
// Returns nearby points of interest with star ratings, review counts, price
// levels, and photos. Much richer than OSM for investment report quality.
//
// Requires GOOGLE_MAPS_API_KEY env var with Places API enabled.
// Pricing: ~$32/1000 requests (Nearby Search), $200/mo free credit.
//
// We search multiple place types to build a complete neighborhood profile,
// then merge the results into the location intelligence snapshot.

const PLACE_CATEGORIES = [
  { type: "restaurant", label: "Restaurants" },
  { type: "cafe", label: "Cafes" },
  { type: "supermarket", label: "Grocery" },
  { type: "shopping_mall", label: "Shopping" },
  { type: "gym", label: "Fitness" },
  { type: "park", label: "Parks" },
  { type: "hospital", label: "Healthcare" },
  { type: "pharmacy", label: "Pharmacies" },
  { type: "bank", label: "Banks" },
  { type: "gas_station", label: "Gas Stations" },
  { type: "bar", label: "Bars & Nightlife" },
  { type: "movie_theater", label: "Entertainment" },
] as const;

interface GooglePlace {
  name: string;
  category: string;
  lat: number;
  lng: number;
  rating: number | null;
  review_count: number | null;
  price_level: number | null; // 0-4 ($-$$$$)
  address: string | null;
  place_id: string;
  open_now: boolean | null;
  distance_mi: number;
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
    const radiusMiles = body.radius_miles ?? 1;
    const categories = body.categories || PLACE_CATEGORIES.map((c) => c.type);

    const deal = await dealQueries.getById(params.id);
    if (!deal?.lat || !deal?.lng) {
      return NextResponse.json({ error: "Deal has no coordinates." }, { status: 400 });
    }

    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "GOOGLE_MAPS_API_KEY not configured. Enable Places API in Google Cloud Console." },
        { status: 503 }
      );
    }

    const lat = Number(deal.lat);
    const lng = Number(deal.lng);
    const radiusMeters = Math.round(radiusMiles * 1609.344);

    const allPlaces: GooglePlace[] = [];
    const seenIds = new Set<string>();

    // Fetch each category (Google only allows one type per request)
    const selectedCats = PLACE_CATEGORIES.filter((c) =>
      categories.includes(c.type)
    );

    for (const cat of selectedCats) {
      const url =
        `https://maps.googleapis.com/maps/api/place/nearbysearch/json` +
        `?location=${lat},${lng}` +
        `&radius=${radiusMeters}` +
        `&type=${cat.type}` +
        `&key=${apiKey}`;

      try {
        assertAllowedFetchUrl(url);
        const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
        if (!res.ok) continue;
        const json = await res.json();

        if (json.status !== "OK" && json.status !== "ZERO_RESULTS") {
          console.error(`Google Places error (${cat.type}):`, json.status, json.error_message);
          continue;
        }

        const results = json.results || [];
        for (const r of results) {
          if (seenIds.has(r.place_id)) continue;
          seenIds.add(r.place_id);

          const plat = r.geometry?.location?.lat ?? 0;
          const plng = r.geometry?.location?.lng ?? 0;

          allPlaces.push({
            name: r.name || "Unknown",
            category: cat.label,
            lat: plat,
            lng: plng,
            rating: r.rating ?? null,
            review_count: r.user_ratings_total ?? null,
            price_level: r.price_level ?? null,
            address: r.vicinity ?? null,
            place_id: r.place_id,
            open_now: r.opening_hours?.open_now ?? null,
            distance_mi: haversineMiles(lat, lng, plat, plng),
          });
        }
      } catch (err) {
        console.error(`Google Places fetch error (${cat.type}):`, err);
      }

      // Small delay between requests to be polite
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    // Sort by rating (highest first), then by distance
    allPlaces.sort((a, b) => {
      if (a.rating != null && b.rating != null) return b.rating - a.rating;
      if (a.rating != null) return -1;
      if (b.rating != null) return 1;
      return a.distance_mi - b.distance_mi;
    });

    // Build category summary
    const summary: Record<
      string,
      {
        count: number;
        avg_rating: number | null;
        nearest_mi: number | null;
        top_rated: Array<{ name: string; rating: number; reviews: number }>;
      }
    > = {};

    for (const place of allPlaces) {
      if (!summary[place.category]) {
        summary[place.category] = {
          count: 0,
          avg_rating: null,
          nearest_mi: null,
          top_rated: [],
        };
      }
      const cat = summary[place.category];
      cat.count++;
      if (cat.nearest_mi == null || place.distance_mi < cat.nearest_mi) {
        cat.nearest_mi = place.distance_mi;
      }
      if (
        place.rating != null &&
        place.review_count != null &&
        cat.top_rated.length < 3
      ) {
        cat.top_rated.push({
          name: place.name,
          rating: place.rating,
          reviews: place.review_count,
        });
      }
    }

    // Compute average ratings per category
    for (const catKey of Object.keys(summary)) {
      const rated = allPlaces.filter(
        (p) => p.category === catKey && p.rating != null
      );
      if (rated.length > 0) {
        summary[catKey].avg_rating =
          Math.round(
            (rated.reduce((s, p) => s + (p.rating ?? 0), 0) / rated.length) *
              10
          ) / 10;
      }
    }

    // Merge into location intelligence
    const existing = await locationIntelligenceQueries.getByDealAndRadius(
      params.id,
      radiusMiles
    );
    if (existing) {
      const data =
        typeof existing.data === "string"
          ? JSON.parse(existing.data)
          : existing.data || {};

      // Google Places data replaces OSM amenities (richer data)
      data.google_places = allPlaces.slice(0, 100);
      data.google_places_summary = summary;
      data.amenities = allPlaces.slice(0, 100).map((p) => ({
        name: p.name,
        category: p.category.toLowerCase(),
        lat: p.lat,
        lng: p.lng,
        distance_mi: p.distance_mi,
        rating: p.rating,
        review_count: p.review_count,
        price_level: p.price_level,
        tags: { address: p.address || "" },
      }));
      data.amenities_total = allPlaces.length;
      data.amenities_source = "google";

      const projections =
        typeof existing.projections === "string"
          ? JSON.parse(existing.projections)
          : existing.projections || {};

      await locationIntelligenceQueries.upsert(
        params.id,
        existing.id,
        radiusMiles,
        data,
        projections,
        "mixed",
        existing.source_year,
        `${existing.source_notes || ""}; Google Places`
      );
    }

    return NextResponse.json({
      data: {
        places: allPlaces.slice(0, 100),
        summary,
        total: allPlaces.length,
      },
      meta: {
        source: "Google Places API",
        total: allPlaces.length,
        categories: Object.keys(summary).length,
        note: `Found ${allPlaces.length} places across ${Object.keys(summary).length} categories within ${radiusMiles} mi.`,
      },
    });
  } catch (error) {
    console.error(
      "POST /api/deals/[id]/location-intelligence/fetch-places error:",
      error
    );
    return NextResponse.json(
      { error: "Failed to fetch Google Places data" },
      { status: 500 }
    );
  }
}

function haversineMiles(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return (
    Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10
  );
}
