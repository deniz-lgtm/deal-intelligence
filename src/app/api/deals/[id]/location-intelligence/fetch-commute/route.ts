import { NextRequest, NextResponse } from "next/server";
import { locationIntelligenceQueries, dealQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { assertAllowedFetchUrl } from "@/lib/web-allowlist";

// ── Google Distance Matrix API ───────────────────────────────────────────────
//
// Computes drive time from the property to key destinations: the nearest
// major employment centers, airports, downtown, and any custom destinations.
//
// Uses Google's traffic-aware routing for realistic commute times.
// Requires GOOGLE_MAPS_API_KEY with Distance Matrix API enabled.
// Pricing: ~$5/1000 elements, $200/mo free credit.

// We auto-discover destinations using Google Places, then compute commute
// times to the top results.

interface CommuteDestination {
  name: string;
  type: string;
  address: string | null;
  lat: number;
  lng: number;
  drive_minutes: number | null;
  drive_miles: number | null;
  drive_text: string | null;
  transit_minutes: number | null;
  transit_text: string | null;
}

// Key destination types for CRE investment analysis
const DESTINATION_SEARCHES = [
  { type: "airport", label: "Airport", keyword: "international airport", limit: 2 },
  { type: "cbd", label: "Downtown/CBD", keyword: "city hall", limit: 1 },
  { type: "hospital", label: "Major Hospital", keyword: "hospital medical center", limit: 2 },
  { type: "university", label: "University", keyword: "university", limit: 2 },
  { type: "train_station", label: "Transit Hub", keyword: "train station metro station", limit: 2 },
  { type: "shopping_mall", label: "Major Retail", keyword: "shopping mall", limit: 1 },
];

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
    const customDestinations: Array<{ name: string; address: string }> =
      body.custom_destinations || [];

    const deal = await dealQueries.getById(params.id);
    if (!deal?.lat || !deal?.lng) {
      return NextResponse.json(
        { error: "Deal has no coordinates." },
        { status: 400 }
      );
    }

    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            "GOOGLE_MAPS_API_KEY not configured. Enable Distance Matrix API in Google Cloud Console.",
        },
        { status: 503 }
      );
    }

    const lat = Number(deal.lat);
    const lng = Number(deal.lng);
    const origin = `${lat},${lng}`;

    // Step 1: Auto-discover key destinations via Google Places text search
    const destinations: Array<{
      name: string;
      type: string;
      lat: number;
      lng: number;
      address: string | null;
    }> = [];

    for (const search of DESTINATION_SEARCHES) {
      const url =
        `https://maps.googleapis.com/maps/api/place/textsearch/json` +
        `?query=${encodeURIComponent(search.keyword)}` +
        `&location=${lat},${lng}` +
        `&radius=80000` + // 50 miles in meters
        `&key=${apiKey}`;

      try {
        assertAllowedFetchUrl(url);
        const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
        if (!res.ok) continue;
        const json = await res.json();
        if (json.status !== "OK") continue;

        const results = (json.results || []).slice(0, search.limit);
        for (const r of results) {
          destinations.push({
            name: r.name || search.label,
            type: search.label,
            lat: r.geometry?.location?.lat ?? 0,
            lng: r.geometry?.location?.lng ?? 0,
            address: r.formatted_address ?? null,
          });
        }
      } catch {
        // Non-fatal
      }

      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    // Add custom destinations
    for (const cd of customDestinations) {
      // Geocode custom address
      const geoUrl =
        `https://maps.googleapis.com/maps/api/geocode/json` +
        `?address=${encodeURIComponent(cd.address)}` +
        `&key=${apiKey}`;

      try {
        assertAllowedFetchUrl(geoUrl);
        const res = await fetch(geoUrl, { signal: AbortSignal.timeout(8000) });
        if (res.ok) {
          const json = await res.json();
          const loc = json.results?.[0]?.geometry?.location;
          if (loc) {
            destinations.push({
              name: cd.name,
              type: "Custom",
              lat: loc.lat,
              lng: loc.lng,
              address: cd.address,
            });
          }
        }
      } catch {
        // Non-fatal
      }
    }

    if (destinations.length === 0) {
      return NextResponse.json(
        { error: "Could not find any key destinations near this property." },
        { status: 404 }
      );
    }

    // Step 2: Compute drive times via Distance Matrix (batch up to 25 destinations)
    const destCoords = destinations
      .slice(0, 25)
      .map((d) => `${d.lat},${d.lng}`)
      .join("|");

    const commuteResults: CommuteDestination[] = [];

    // Driving
    const driveUrl =
      `https://maps.googleapis.com/maps/api/distancematrix/json` +
      `?origins=${origin}` +
      `&destinations=${encodeURIComponent(destCoords)}` +
      `&mode=driving` +
      `&departure_time=now` +
      `&key=${apiKey}`;

    let driveData: Array<{
      duration: { value: number; text: string } | null;
      distance: { value: number; text: string } | null;
      status: string;
    }> = [];

    try {
      assertAllowedFetchUrl(driveUrl);
      const res = await fetch(driveUrl, { signal: AbortSignal.timeout(15000) });
      if (res.ok) {
        const json = await res.json();
        if (json.status === "OK" && json.rows?.[0]?.elements) {
          driveData = json.rows[0].elements;
        }
      }
    } catch (err) {
      console.error("Distance Matrix (driving) error:", err);
    }

    // Transit (separate request)
    const transitUrl =
      `https://maps.googleapis.com/maps/api/distancematrix/json` +
      `?origins=${origin}` +
      `&destinations=${encodeURIComponent(destCoords)}` +
      `&mode=transit` +
      `&key=${apiKey}`;

    let transitData: Array<{
      duration: { value: number; text: string } | null;
      status: string;
    }> = [];

    try {
      assertAllowedFetchUrl(transitUrl);
      const res = await fetch(transitUrl, {
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) {
        const json = await res.json();
        if (json.status === "OK" && json.rows?.[0]?.elements) {
          transitData = json.rows[0].elements;
        }
      }
    } catch {
      // Transit may not be available in all areas
    }

    // Combine results
    for (let i = 0; i < destinations.length && i < 25; i++) {
      const dest = destinations[i];
      const drive = driveData[i];
      const transit = transitData[i];

      commuteResults.push({
        name: dest.name,
        type: dest.type,
        address: dest.address,
        lat: dest.lat,
        lng: dest.lng,
        drive_minutes:
          drive?.status === "OK" && drive.duration
            ? Math.round(drive.duration.value / 60)
            : null,
        drive_miles:
          drive?.status === "OK" && drive.distance
            ? Math.round((drive.distance.value / 1609.344) * 10) / 10
            : null,
        drive_text:
          drive?.status === "OK" && drive.duration
            ? drive.duration.text
            : null,
        transit_minutes:
          transit?.status === "OK" && transit.duration
            ? Math.round(transit.duration.value / 60)
            : null,
        transit_text:
          transit?.status === "OK" && transit.duration
            ? transit.duration.text
            : null,
      });
    }

    // Sort by drive time
    commuteResults.sort(
      (a, b) => (a.drive_minutes ?? 999) - (b.drive_minutes ?? 999)
    );

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
      data.commute_destinations = commuteResults;
      data.nearest_airport_min = commuteResults.find(
        (d) => d.type === "Airport"
      )?.drive_minutes ?? null;
      data.nearest_hospital_min = commuteResults.find(
        (d) => d.type === "Major Hospital"
      )?.drive_minutes ?? null;
      data.nearest_transit_min = commuteResults.find(
        (d) => d.type === "Transit Hub"
      )?.drive_minutes ?? null;

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
        `${existing.source_notes || ""}; Google Commute Analysis`
      );
    }

    return NextResponse.json({
      data: { destinations: commuteResults },
      meta: {
        source: "Google Distance Matrix API",
        destinations_found: commuteResults.length,
        note: `Commute times to ${commuteResults.length} key destinations. Nearest airport: ${commuteResults.find((d) => d.type === "Airport")?.drive_text ?? "N/A"}.`,
      },
    });
  } catch (error) {
    console.error(
      "POST /api/deals/[id]/location-intelligence/fetch-commute error:",
      error
    );
    return NextResponse.json(
      { error: "Failed to compute commute times" },
      { status: 500 }
    );
  }
}
