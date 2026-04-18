import { NextRequest, NextResponse } from "next/server";
import { progressReportQueries, progressReportPhotoQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; reportId: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const report = await progressReportQueries.getById(params.reportId);
    if (!report || report.deal_id !== params.id) {
      return NextResponse.json({ error: "Progress report not found" }, { status: 404 });
    }

    const photos = await progressReportPhotoQueries.getByReportId(params.reportId);

    return NextResponse.json({ data: { ...report, photos } });
  } catch (err) {
    console.error("GET /api/deals/[id]/progress-reports/[reportId] error:", err);
    return NextResponse.json({ error: "Failed to fetch progress report" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; reportId: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const report = await progressReportQueries.getById(params.reportId);
    if (!report || report.deal_id !== params.id) {
      return NextResponse.json({ error: "Progress report not found" }, { status: 404 });
    }

    const body = await req.json();
    const updated = await progressReportQueries.update(params.reportId, body);
    return NextResponse.json({ data: updated });
  } catch (err) {
    console.error("PATCH /api/deals/[id]/progress-reports/[reportId] error:", err);
    return NextResponse.json({ error: "Failed to update progress report" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; reportId: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const report = await progressReportQueries.getById(params.reportId);
    if (!report || report.deal_id !== params.id) {
      return NextResponse.json({ error: "Progress report not found" }, { status: 404 });
    }

    await progressReportQueries.delete(params.reportId);
    return NextResponse.json({ data: { deleted: true } });
  } catch (err) {
    console.error("DELETE /api/deals/[id]/progress-reports/[reportId] error:", err);
    return NextResponse.json({ error: "Failed to delete progress report" }, { status: 500 });
  }
}
