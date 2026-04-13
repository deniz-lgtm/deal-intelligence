import { NextRequest, NextResponse } from "next/server";
import { locationIntelligenceQueries, dealQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { assertAllowedFetchUrl } from "@/lib/web-allowlist";

// ── Walk Score API ───────────────────────────────────────────────────────────
// Free tier: 5,000 requests/day. Returns walk, transit, and bike scores.
// Requires WALKSCORE_API_KEY env var (register free at walkscore.com/professional).

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

    const apiKey = process.env.WALKSCORE_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "WALKSCORE_API_KEY not configured. Register free at walkscore.com/professional/api." },
        { status: 503 }
      );
    }

    const address = [deal.address, deal.city, deal.state, deal.zip].filter(Boolean).join(", ");
    const url = `https://api.walkscore.com/score?format=json&address=${encodeURIComponent(address)}&lat=${deal.lat}&lon=${deal.lng}&transit=1&bike=1&wsapikey=${apiKey}`;

    try {
      assertAllowedFetchUrl(url);
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) {
        return NextResponse.json({ error: "Walk Score API returned an error." }, { status: 502 });
      }
      const json = await res.json();

      if (json.status !== 1) {
        return NextResponse.json({ error: "Walk Score not available for this address." }, { status: 404 });
      }

      const result = {
        walkscore: json.walkscore ?? null,
        walkscore_description: json.description ?? null,
        transit_score: json.transit?.score ?? null,
        transit_description: json.transit?.description ?? null,
        transit_summary: json.transit?.summary ?? null,
        bike_score: json.bike?.score ?? null,
        bike_description: json.bike?.description ?? null,
        walkscore_url: json.ws_link ?? null,
      };

      // Merge into location intelligence
      const existing = await locationIntelligenceQueries.getByDealAndRadius(params.id, radiusMiles);
      if (existing) {
        const data = typeof existing.data === "string" ? JSON.parse(existing.data) : existing.data || {};
        data.walkscore = result.walkscore;
        data.transit_score = result.transit_score;
        data.bike_score = result.bike_score;
        data.walkscore_description = result.walkscore_description;
        data.transit_description = result.transit_description;
        data.bike_description = result.bike_description;

        const projections = typeof existing.projections === "string" ? JSON.parse(existing.projections) : existing.projections || {};
        await locationIntelligenceQueries.upsert(
          params.id, existing.id, radiusMiles, data, projections,
          "mixed", existing.source_year,
          `${existing.source_notes || ""}; Walk Score`
        );
      }

      return NextResponse.json({
        data: result,
        meta: { source: "Walk Score API", note: `Walk: ${result.walkscore}, Transit: ${result.transit_score ?? "N/A"}, Bike: ${result.bike_score ?? "N/A"}` },
      });
    } catch (err) {
      console.error("Walk Score fetch error:", err);
      return NextResponse.json({ error: "Failed to fetch Walk Score." }, { status: 502 });
    }
  } catch (error) {
    console.error("POST /api/deals/[id]/location-intelligence/fetch-walkscore error:", error);
    return NextResponse.json({ error: "Failed to fetch Walk Score" }, { status: 500 });
  }
}
