import { NextRequest, NextResponse } from "next/server";
import {
  siteWalkQueries,
  siteWalkRecordingQueries,
  siteWalkPhotoQueries,
  siteWalkDeficiencyQueries,
  dealQueries,
} from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { generateWalkReport } from "@/lib/site-walk-ai";
import type { SiteWalk } from "@/lib/types";

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string; walkId: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const walk = await siteWalkQueries.getById(params.walkId) as SiteWalk | null;
    if (!walk || walk.deal_id !== params.id) {
      return NextResponse.json({ error: "Site walk not found" }, { status: 404 });
    }

    const [recordings, photos, deficiencies, deal] = await Promise.all([
      siteWalkRecordingQueries.getByWalkId(params.walkId),
      siteWalkPhotoQueries.getByWalkId(params.walkId),
      siteWalkDeficiencyQueries.getByWalkId(params.walkId),
      dealQueries.getById(params.id),
    ]);

    const dealContext =
      (deal?.context_notes as string | undefined) ||
      (deal?.notes as string | undefined) ||
      undefined;

    const report = await generateWalkReport({
      walk,
      recordings,
      photos,
      deficiencies,
      dealContext,
    });

    const updated = await siteWalkQueries.update(params.walkId, { ai_report: report });
    return NextResponse.json({ data: { walk: updated, report } });
  } catch (err) {
    console.error("POST report error:", err);
    const message = err instanceof Error ? err.message : "Failed to generate report";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
