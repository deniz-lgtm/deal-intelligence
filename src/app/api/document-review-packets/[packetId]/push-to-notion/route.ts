import { NextRequest, NextResponse } from "next/server";
import { documentReviewPacketQueries } from "@/lib/db";
import { requireAuth, requireDealEditAccess } from "@/lib/auth";
import { ensureDealNotionProject, pushReviewPacketItems } from "@/lib/notion";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: { packetId: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const packet = await documentReviewPacketQueries.getById(params.packetId);
    if (!packet) return NextResponse.json({ error: "Review packet not found" }, { status: 404 });

    const { errorResponse: accessError } = await requireDealEditAccess(packet.deal_id, userId);
    if (accessError) return accessError;

    const body = await req.json().catch(() => ({}));
    const approvedItems = body.approved_items ?? body.approvedItems ?? {};
    const projectLink = await ensureDealNotionProject(packet.deal_id);
    const created = await pushReviewPacketItems(projectLink.notion_page_id, approvedItems);
    const updated = await documentReviewPacketQueries.markPushedToNotion(params.packetId, {
      project_id: projectLink.notion_page_id,
      notion_url: projectLink.notion_url,
      created,
    });

    return NextResponse.json({
      data: {
        notion_project_id: projectLink.notion_page_id,
        notion_url: projectLink.notion_url,
        created,
        packet: updated,
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
    console.error("POST /api/document-review-packets/[packetId]/push-to-notion error:", error);
    return NextResponse.json({ error: "Failed to push review packet to Notion" }, { status: 500 });
  }
}
