import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { getProjectContext, normalizeNotionId } from "@/lib/notion";
import { notionSyncQueries } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const dealId = req.nextUrl.searchParams.get("deal_id");
    if (dealId) {
      const { errorResponse: accessError } = await requireDealAccess(dealId, userId);
      if (accessError) return accessError;

      const link = await notionSyncQueries.getDealProjectLink(dealId);
      if (!link?.notion_page_id) {
        return NextResponse.json(
          {
            error: "Link/Create Notion Project first.",
            code: "NOTION_PROJECT_REQUIRED",
          },
          { status: 409 }
        );
      }

      const context = await getProjectContext(link.notion_page_id, { mode: "active" });
      return NextResponse.json({ data: context });
    }

    const context = await getProjectContext(normalizeNotionId(params.id), { mode: "active" });
    return NextResponse.json({ data: context });
  } catch (error) {
    console.error("GET /api/notion/projects/[id]/context error:", error);
    return NextResponse.json({ error: "Failed to fetch Notion project context" }, { status: 500 });
  }
}
