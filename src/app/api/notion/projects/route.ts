import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireDealEditAccess } from "@/lib/auth";
import {
  createPipelineProject,
  linkDealToNotionProject,
  normalizeNotionId,
} from "@/lib/notion";
import { dealQueries } from "@/lib/db";

export const dynamic = "force-dynamic";

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
