import { NextRequest, NextResponse } from "next/server";
import {
  dealNoteQueries,
  dealQueries,
  devPhaseQueries,
  documentQueries,
} from "@/lib/db";
import { requireAuth, requireDealEditAccess } from "@/lib/auth";
import { exportDealHandoffToNotion } from "@/lib/notion";

export const dynamic = "force-dynamic";

/**
 * POST /api/deals/:id/notion
 * Push the current front-end deal package to Notion for ongoing management.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const { errorResponse: accessError } = await requireDealEditAccess(params.id, userId);
    if (accessError) return accessError;

    if (!process.env.NOTION_API_KEY) {
      return NextResponse.json(
        {
          error:
            "Notion integration is not configured. Add NOTION_API_KEY to environment variables.",
        },
        { status: 501 }
      );
    }

    const deal = await dealQueries.getById(params.id);
    if (!deal) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }

    const [documents, notes, tasks] = await Promise.all([
      documentQueries.getByDealId(params.id),
      dealNoteQueries.getByDealId(params.id),
      devPhaseQueries.getByDealId(params.id),
    ]);

    const result = await exportDealHandoffToNotion({
      deal,
      documents,
      notes,
      tasks,
    });

    return NextResponse.json({
      data: {
        notion_page_id: result.pageId,
        notion_url: result.url,
        message: "Deal linked to Notion Pipeline project and approved handoff records were pushed.",
      },
    });
  } catch (error) {
    console.error("POST /api/deals/[id]/notion error:", error);
    return NextResponse.json({ error: "Notion handoff failed" }, { status: 500 });
  }
}
