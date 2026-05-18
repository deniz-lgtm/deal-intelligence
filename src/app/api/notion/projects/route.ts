import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireDealAccess, requireDealEditAccess } from "@/lib/auth";
import {
  createPipelineProject,
  linkDealToNotionProject,
  normalizeNotionId,
} from "@/lib/notion";
import { dealQueries, notionSyncQueries } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const dealId = req.nextUrl.searchParams.get("deal_id");
    if (!dealId) {
      return NextResponse.json({ error: "deal_id is required" }, { status: 400 });
    }

    const { errorResponse: accessError } = await requireDealAccess(dealId, userId);
    if (accessError) return accessError;

    const link = await notionSyncQueries.getDealProjectLink(dealId);
    return NextResponse.json({
      data: link
        ? {
            linked: true,
            notion_project_id: link.notion_page_id,
            notion_url: link.notion_url,
          }
        : {
            linked: false,
            notion_project_id: null,
            notion_url: null,
          },
    });
  } catch (error) {
    console.error("GET /api/notion/projects error:", error);
    return NextResponse.json({ error: "Failed to fetch Notion project link" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const body = await req.json().catch(() => ({}));
    const dealId = String(body.deal_id ?? body.dealId ?? "");
    if (!dealId) {
      return NextResponse.json({ error: "deal_id is required" }, { status: 400 });
    }

    const { deal, errorResponse: accessError } = await requireDealEditAccess(dealId, userId);
    if (accessError) return accessError;

    const providedProject = body.notion_project_id ?? body.notion_project_url;
    if (providedProject) {
      const link = await linkDealToNotionProject(dealId, String(providedProject));
      return NextResponse.json({
        data: {
          notion_project_id: normalizeNotionId(String(providedProject)),
          notion_url: link.notion_url,
          linked: true,
          created: false,
        },
      });
    }

    const freshDeal = (await dealQueries.getById(dealId)) ?? deal;
    const result = await createPipelineProject({
      deal: freshDeal,
      notes: body.notes,
    });
    await linkDealToNotionProject(dealId, result.pageId, result.url);

    return NextResponse.json({
      data: {
        notion_project_id: result.pageId,
        notion_url: result.url,
        linked: true,
        created: true,
      },
    });
  } catch (error) {
    console.error("POST /api/notion/projects error:", error);
    return NextResponse.json({ error: "Failed to create or link Notion project" }, { status: 500 });
  }
}
