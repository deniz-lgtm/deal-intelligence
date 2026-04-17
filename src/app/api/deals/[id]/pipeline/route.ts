import { NextRequest, NextResponse } from "next/server";
import { dealQueries, marketReportsQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";

/**
 * GET /api/deals/:id/pipeline?radius_mi=5
 *
 * Aggregates every under-construction / planned project across every market
 * report uploaded for this deal, deduplicates by project name, and (if a
 * radius is supplied and the deal is geocoded) filters to projects within
 * that radius of the subject.
 *
 * This is the data source for the supply-pipeline layer on the site plan —
 * the developer can see what's competing for absorption around their parcel.
 *
 * Dedupe rule: when the same project_name appears in multiple reports, the
 * most-recent vintage's data wins (so a delivery-date change in the latest
 * CBRE report supersedes last quarter's JLL note).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

const EARTH_RADIUS_MI = 3958.8;
function haversineMiles(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sa =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.sqrt(sa));
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const url = new URL(req.url);
    const radiusMi = Number(url.searchParams.get("radius_mi") || 0);

    const [deal, reports] = await Promise.all([
      dealQueries.getById(params.id),
      marketReportsQueries.getByDealId(params.id),
    ]);

    const subject = deal?.lat != null && deal?.lng != null
      ? { lat: Number(deal.lat), lng: Number(deal.lng) }
      : null;

    // Newest reports first so the dedupe below keeps the latest vintage's
    // view of each project.
    const sorted = [...reports].sort((a, b) => {
      const ad = a.as_of_date ? new Date(a.as_of_date).getTime() : 0;
      const bd = b.as_of_date ? new Date(b.as_of_date).getTime() : 0;
      return bd - ad;
    });

    const byKey = new Map<string, AnyRec>();
    for (const r of sorted) {
      const raw = typeof r.pipeline === "string" ? JSON.parse(r.pipeline || "[]") : r.pipeline;
      const pipeline: AnyRec[] = Array.isArray(raw) ? raw : [];
      for (const p of pipeline) {
        if (!p || typeof p !== "object") continue;
        const key = (p.project_name || p.address || "").toString().trim().toLowerCase();
        if (!key) continue;
        if (byKey.has(key)) continue; // newest-first: first write wins
        byKey.set(key, {
          ...p,
          source_report_id: r.id,
          source_publisher: r.publisher,
          source_report_name: r.report_name,
          source_as_of_date: r.as_of_date,
        });
      }
    }

    let projects = Array.from(byKey.values());

    // Radius filter (only if the deal is geocoded and a radius was requested).
    if (subject && radiusMi > 0) {
      projects = projects
        .map((p) => {
          if (p.lat == null || p.lng == null) return { ...p, distance_mi: null };
          const d = haversineMiles(subject, { lat: Number(p.lat), lng: Number(p.lng) });
          return { ...p, distance_mi: Math.round(d * 10) / 10 };
        })
        .filter((p) => p.distance_mi == null || p.distance_mi <= radiusMi);
    } else if (subject) {
      projects = projects.map((p) => {
        if (p.lat == null || p.lng == null) return { ...p, distance_mi: null };
        const d = haversineMiles(subject, { lat: Number(p.lat), lng: Number(p.lng) });
        return { ...p, distance_mi: Math.round(d * 10) / 10 };
      });
    }

    // Split for the UI — mapped projects have coords, unmapped is the
    // fallback table the developer can scan alongside the map.
    const mapped = projects.filter((p) => p.lat != null && p.lng != null);
    const unmapped = projects.filter((p) => p.lat == null || p.lng == null);

    // Quick aggregate totals — useful for a "nearby supply" badge next to
    // the toggle on the site plan.
    const totalUnits = projects.reduce(
      (s, p) => s + (Number(p.units) || 0),
      0
    );
    const underConstruction = projects.filter((p) => p.status === "under_construction");
    const planned = projects.filter((p) => p.status === "planned" || p.status === "proposed");

    return NextResponse.json({
      data: {
        subject,
        radius_mi: radiusMi || null,
        mapped,
        unmapped,
        totals: {
          project_count: projects.length,
          mapped_count: mapped.length,
          total_units: totalUnits,
          under_construction_count: underConstruction.length,
          under_construction_units: underConstruction.reduce((s, p) => s + (Number(p.units) || 0), 0),
          planned_count: planned.length,
          planned_units: planned.reduce((s, p) => s + (Number(p.units) || 0), 0),
        },
      },
    });
  } catch (error) {
    console.error("GET /api/deals/[id]/pipeline error:", error);
    return NextResponse.json({ error: "Failed to load pipeline" }, { status: 500 });
  }
}
