import { NextRequest, NextResponse } from "next/server";
import { generatedReportsQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/deals/:id/reports/:reportId/sections
 *
 * Returns just the {id, title} pairs from a saved report's sections JSONB,
 * so the Reports modal can show a table of contents on row expansion
 * without having to pull the full section bodies.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; reportId: string } }
) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ data: [] });
  }
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const row = await generatedReportsQueries.getById(params.reportId, params.id);
    if (!row) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }
    const sections = typeof row.sections === "string" ? JSON.parse(row.sections) : row.sections;
    const pairs = Array.isArray(sections)
      ? sections.map((s: { id?: string; title?: string }, i: number) => ({
          id: s?.id || `s-${i}`,
          title: s?.title || `Section ${i + 1}`,
        }))
      : [];
    return NextResponse.json({ data: pairs });
  } catch (error) {
    console.error("GET /api/deals/[id]/reports/[reportId]/sections error:", error);
    return NextResponse.json({ error: "Failed to load sections" }, { status: 500 });
  }
}
