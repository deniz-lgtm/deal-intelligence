import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { STAGE_MILESTONE_TEMPLATES } from "@/lib/types";
import type { DealStatus } from "@/lib/types";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const body = await req.json();
    const stage = body.stage as DealStatus;

    const suggestions = STAGE_MILESTONE_TEMPLATES[stage] ?? [];
    return NextResponse.json({ data: suggestions });
  } catch (error) {
    console.error("POST /api/deals/[id]/milestones/suggest error:", error);
    return NextResponse.json({ error: "Failed to get suggestions" }, { status: 500 });
  }
}
