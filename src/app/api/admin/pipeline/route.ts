import { NextRequest, NextResponse } from "next/server";
import { pipelineStageQueries } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { recordAudit } from "@/lib/admin-helpers";
import { DEAL_PIPELINE, DEAL_STAGE_LABELS } from "@/lib/types";

export async function GET() {
  const { errorResponse } = await requireAdmin();
  if (errorResponse) return errorResponse;

  let stages = await pipelineStageQueries.listAll();
  if (stages.length === 0) {
    // Seed defaults so admin has something to edit
    for (let i = 0; i < DEAL_PIPELINE.length; i++) {
      const id = DEAL_PIPELINE[i];
      await pipelineStageQueries.upsert({
        id,
        label: DEAL_STAGE_LABELS[id] ?? id,
        sort_order: i,
        color: null,
        is_terminal: id === "closed",
        created_at: "",
      });
    }
    stages = await pipelineStageQueries.listAll();
  }
  return NextResponse.json({ data: stages });
}

export async function PUT(req: NextRequest) {
  const { userId: adminId, errorResponse } = await requireAdmin();
  if (errorResponse) return errorResponse;

  let body: { stages?: Array<{ id: string; label: string; sort_order: number; color?: string | null; is_terminal?: boolean }> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!Array.isArray(body.stages)) {
    return NextResponse.json({ error: "stages must be an array" }, { status: 400 });
  }

  try {
    for (const s of body.stages) {
      await pipelineStageQueries.upsert({
        id: s.id,
        label: s.label,
        sort_order: s.sort_order,
        color: s.color ?? null,
        is_terminal: s.is_terminal ?? false,
        created_at: "",
      });
    }
    await recordAudit({
      userId: adminId,
      action: "pipeline.updated",
      metadata: { count: body.stages.length },
    });
    const stages = await pipelineStageQueries.listAll();
    return NextResponse.json({ data: stages });
  } catch (error) {
    console.error("PUT /api/admin/pipeline error:", error);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
}
