import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireDealEditAccess } from "@/lib/auth";
import { ensureDealNotionProject, pushReviewPacketItems } from "@/lib/notion";
import { notionSyncQueries } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const body = await req.json().catch(() => ({}));
    const dealId = String(body.deal_id ?? body.dealId ?? "");
    if (!dealId) {
      return NextResponse.json({ error: "deal_id is required" }, { status: 400 });
    }

    const { errorResponse: accessError } = await requireDealEditAccess(dealId, userId);
    if (accessError) return accessError;

    const approvedItems = body.approved_items ?? body.approvedItems ?? {};
    const projectLink = await ensureDealNotionProject(dealId);
    const created = await pushReviewPacketItems(projectLink.notion_page_id, approvedItems);

    await notionSyncQueries.upsert({
      local_type: "review_packet",
      local_id: params.id,
      notion_role: "push_summary",
      notion_data_source: "pipeline",
      notion_page_id: projectLink.notion_page_id,
      notion_url: projectLink.notion_url,
      metadata: { deal_id: dealId, created },
    });

    return NextResponse.json({
      data: {
        notion_project_id: projectLink.notion_page_id,
        notion_url: projectLink.notion_url,
        created,
      },
    });
  } catch (error) {
    if ((error as Error).name === "NotionProjectRequired") {
      return NextResponse.json(
        {
          error: "Link/Create Notion Project first.",
          code: "NOTION_PROJECT_REQUIRED",
        },
        { status: 409 }
      );
    }
    console.error("POST /api/review-packets/[id]/push-to-notion error:", error);
    return NextResponse.json({ error: "Failed to push review packet to Notion" }, { status: 500 });
  }
}
