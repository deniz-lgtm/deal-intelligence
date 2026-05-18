import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { importPipelineProjectsFromNotion } from "@/lib/notion";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const body = await req.json().catch(() => ({}));
    const data = await importPipelineProjectsFromNotion({
      userId,
      pageSize: Number(body.page_size ?? body.pageSize ?? 50),
    });

    return NextResponse.json({ data });
  } catch (error) {
    console.error("POST /api/notion/projects/import error:", error);
    return NextResponse.json(
      { error: "Failed to import Notion Pipeline projects" },
      { status: 500 }
    );
  }
}
