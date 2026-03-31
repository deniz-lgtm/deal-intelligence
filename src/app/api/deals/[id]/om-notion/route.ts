import { NextRequest, NextResponse } from "next/server";
import { dealQueries, omAnalysisQueries } from "@/lib/db";
import { exportDealToNotion } from "@/lib/notion";
import { requireAuth, requireDealAccess } from "@/lib/auth";

/**
 * POST /api/deals/:id/om-notion
 * Export the deal + latest OM analysis to Notion.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    if (!process.env.NOTION_API_KEY || !process.env.NOTION_DEALS_DATABASE_ID) {
      return NextResponse.json(
        { error: "Notion integration not configured. Add NOTION_API_KEY and NOTION_DEALS_DATABASE_ID to environment variables." },
        { status: 501 }
      );
    }

    const deal = await dealQueries.getById(params.id);
    const analysis = await omAnalysisQueries.getByDealId(params.id);
    if (!analysis || analysis.status !== "complete") {
      return NextResponse.json(
        { error: "No completed OM analysis found. Analyze an OM first." },
        { status: 400 }
      );
    }

    const result = await exportDealToNotion(deal, analysis);

    return NextResponse.json({
      data: {
        notion_page_id: result.pageId,
        notion_url: result.url,
        message: "Successfully exported to Notion.",
      },
    });
  } catch (error) {
    console.error("POST /api/deals/[id]/om-notion error:", error);
    return NextResponse.json({ error: "Notion export failed" }, { status: 500 });
  }
}
