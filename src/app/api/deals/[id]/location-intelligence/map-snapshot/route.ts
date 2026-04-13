import { NextRequest, NextResponse } from "next/server";
import { locationIntelligenceQueries, dealQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";

// ── Mapbox Static Images API ─────────────────────────────────────────────────
//
// Generates a server-side map PNG using Mapbox Static Images API.
// Uses MAPBOX_SECRET_TOKEN (server-only) for higher rate limits.
// Returns a base64 data URL or stores it in map_snapshot_url.
//
// Docs: https://docs.mapbox.com/api/maps/static-images/

const MAPBOX_SECRET = process.env.MAPBOX_SECRET_TOKEN || "";
const MAPBOX_PUBLIC = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

// Pin color by layer type
const PIN_COLORS: Record<string, string> = {
  subject: "10b981",
  amenities: "f59e0b",
  employers: "6366f1",
  schools: "06b6d4",
  commute: "ec4899",
  comps_sale: "eab308",
  comps_rent: "3b82f6",
};

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const token = MAPBOX_SECRET || MAPBOX_PUBLIC;
    if (!token) {
      return NextResponse.json(
        { error: "No Mapbox token configured. Set MAPBOX_SECRET_TOKEN or NEXT_PUBLIC_MAPBOX_TOKEN." },
        { status: 503 }
      );
    }

    const body = await req.json();
    const {
      radius_miles = 3,
      style = "dark-v11",
      width = 1280,
      height = 720,
      layers = ["amenities", "employers", "schools", "commute"],
      title,
    } = body;

    const deal = await dealQueries.getById(params.id);
    if (!deal?.lat || !deal?.lng) {
      return NextResponse.json({ error: "Deal has no coordinates." }, { status: 400 });
    }

    const lat = Number(deal.lat);
    const lng = Number(deal.lng);

    // Get location intelligence data for markers
    const existing = await locationIntelligenceQueries.getByDealAndRadius(params.id, radius_miles);
    const ext = existing?.data
      ? typeof existing.data === "string" ? JSON.parse(existing.data) : existing.data
      : {};

    // Build GeoJSON overlay with markers
    const features: Array<Record<string, unknown>> = [];

    // Subject pin (always)
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lng, lat] },
      properties: { "marker-color": `#${PIN_COLORS.subject}`, "marker-size": "large", "marker-symbol": "star" },
    });

    // Add data points from enabled layers
    const addPoints = (items: Array<{ lat: number; lng: number; name?: string }>, layer: string) => {
      if (!layers.includes(layer)) return;
      for (const item of (items || []).slice(0, 20)) {
        if (!item.lat || !item.lng) continue;
        features.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: [Number(item.lng), Number(item.lat)] },
          properties: { "marker-color": `#${PIN_COLORS[layer] || "888888"}`, "marker-size": "small" },
        });
      }
    };

    addPoints(ext.google_places || ext.amenities || [], "amenities");
    addPoints(ext.top_employers || [], "employers");
    addPoints(ext.schools || [], "schools");
    addPoints(ext.commute_destinations || [], "commute");

    // Build the Mapbox Static API URL
    const geojson = encodeURIComponent(JSON.stringify({
      type: "FeatureCollection",
      features,
    }));

    // Auto-fit to markers
    const mapUrl = `https://api.mapbox.com/styles/v1/mapbox/${style}/static/geojson(${geojson})/auto/${width}x${height}@2x?access_token=${token}&padding=40`;

    try {
      const res = await fetch(mapUrl, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        console.error(`Mapbox Static API error: ${res.status} — ${errText.slice(0, 200)}`);

        // If GeoJSON is too long, fall back to center/zoom approach
        if (res.status === 414 || res.status === 400) {
          const fallbackUrl = `https://api.mapbox.com/styles/v1/mapbox/${style}/static/pin-l-star+10b981(${lng},${lat})/${lng},${lat},12/${width}x${height}@2x?access_token=${token}`;
          const fallbackRes = await fetch(fallbackUrl, { signal: AbortSignal.timeout(15000) });
          if (!fallbackRes.ok) {
            return NextResponse.json({ error: "Mapbox Static API failed." }, { status: 502 });
          }
          const buffer = await fallbackRes.arrayBuffer();
          const base64 = Buffer.from(buffer).toString("base64");
          const dataUrl = `data:image/png;base64,${base64}`;

          // Store snapshot URL
          if (existing) {
            const data = typeof existing.data === "string" ? JSON.parse(existing.data) : existing.data || {};
            data.map_snapshot_style = style;
            data.map_snapshot_title = title || null;
            const projections = typeof existing.projections === "string" ? JSON.parse(existing.projections) : existing.projections || {};
            await locationIntelligenceQueries.upsert(
              params.id, existing.id, radius_miles, data, projections,
              existing.data_source || "mixed", existing.source_year,
              existing.source_notes || ""
            );
          }

          return NextResponse.json({ data: { image_url: dataUrl, width, height, style, markers: 1 } });
        }

        return NextResponse.json({ error: "Mapbox Static API failed." }, { status: 502 });
      }

      const buffer = await res.arrayBuffer();
      const base64 = Buffer.from(buffer).toString("base64");
      const dataUrl = `data:image/png;base64,${base64}`;

      return NextResponse.json({
        data: {
          image_url: dataUrl,
          width,
          height,
          style,
          markers: features.length,
          title: title || null,
        },
      });
    } catch (err) {
      console.error("Mapbox Static fetch error:", err);
      return NextResponse.json({ error: "Failed to generate map snapshot." }, { status: 502 });
    }
  } catch (error) {
    console.error("POST /api/deals/[id]/location-intelligence/map-snapshot error:", error);
    return NextResponse.json({ error: "Failed to generate map snapshot" }, { status: 500 });
  }
}
