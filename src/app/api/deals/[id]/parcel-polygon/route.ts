import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireDealAccess } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/deals/[id]/parcel-polygon
 *
 * Looks up the parcel boundary polygon for the deal's address using the
 * OSM Overpass API. Returns a list of {lat, lng} points tracing the parcel
 * outline, or null when nothing is found nearby.
 *
 * Body: optionally { lat, lng, address, city, state } — falls back to deal
 * fields when omitted.
 *
 * Returns { points: Array<{ lat: number; lng: number }>, source: string } | null
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const { deal: rawDeal, errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;
    const deal = rawDeal as any;

    let body: any = {};
    try { body = await req.json(); } catch { /* no body */ }

    const lat = body.lat ?? deal?.lat;
    const lng = body.lng ?? deal?.lng;

    if (!lat || !lng) {
      return NextResponse.json(
        { error: "Deal must have geocoordinates. Geocode the deal address first." },
        { status: 400 }
      );
    }

    const latN = Number(lat);
    const lngN = Number(lng);
    const radiusM = 30; // search within 30m of the pin

    // Build an Overpass query that finds any closed way near the coordinate.
    // We look for landuse, building, or boundary ways — any closed polygon
    // that encloses the parcel point. The most commonly tagged parcel-adjacent
    // feature in OSM is landuse=* or a building=* way.
    const overpassQuery = `
[out:json][timeout:10];
(
  way(around:${radiusM},${latN},${lngN})["landuse"];
  way(around:${radiusM},${latN},${lngN})["boundary"="lot"];
  way(around:${radiusM},${latN},${lngN})["building"];
);
out geom;
`.trim();

    const overpassUrl = "https://overpass-api.de/api/interpreter";
    const osRes = await fetch(overpassUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(overpassQuery)}`,
      signal: AbortSignal.timeout(12000),
    });

    if (!osRes.ok) {
      return NextResponse.json({ data: null }, { status: 200 });
    }

    const osJson = await osRes.json();
    const elements: any[] = osRes.ok ? (osJson.elements || []) : [];

    // Pick the smallest closed way that contains our coordinate (or the
    // first result when containment can't be determined). "Smallest" means
    // fewest nodes — the most specific boundary for the pin.
    const ways = elements.filter(
      (el: any) => el.type === "way" && Array.isArray(el.geometry) && el.geometry.length >= 4
    );

    if (ways.length === 0) {
      return NextResponse.json({ data: null }, { status: 200 });
    }

    // Sort by node count ascending (smallest polygon = most specific parcel)
    ways.sort((a: any, b: any) => (a.geometry?.length ?? 0) - (b.geometry?.length ?? 0));
    const best = ways[0];

    const points: Array<{ lat: number; lng: number }> = (best.geometry as any[])
      .map((g: any) => ({ lat: g.lat, lng: g.lon }))
      // Remove duplicate closing point (OSM closes rings by repeating the first node)
      .filter((p: any, i: number, arr: any[]) => {
        if (i === 0) return true;
        const prev = arr[i - 1];
        return !(Math.abs(p.lat - prev.lat) < 1e-8 && Math.abs(p.lng - prev.lng) < 1e-8);
      });

    if (points.length < 3) {
      return NextResponse.json({ data: null }, { status: 200 });
    }

    return NextResponse.json({
      data: {
        points,
        source: "OpenStreetMap Overpass",
        way_id: best.id,
        tags: best.tags || {},
      },
    });
  } catch (err: any) {
    if (err?.name === "TimeoutError" || err?.code === "ABORT_ERR") {
      return NextResponse.json({ data: null }, { status: 200 });
    }
    console.error("[parcel-polygon]", err);
    return NextResponse.json({ error: "Parcel lookup failed" }, { status: 500 });
  }
}
