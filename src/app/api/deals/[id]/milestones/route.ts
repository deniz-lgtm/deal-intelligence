import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { milestoneQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const milestones = await milestoneQueries.getByDealId(params.id);
    return NextResponse.json({ data: milestones });
  } catch (error) {
    console.error("GET /api/deals/[id]/milestones error:", error);
    return NextResponse.json({ error: "Failed to fetch milestones" }, { status: 500 });
  }
}

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
    const { title, stage, target_date, sort_order } = body;

    if (!title?.trim()) {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }

    const milestone = await milestoneQueries.create({
      id: uuidv4(),
      deal_id: params.id,
      title: title.trim(),
      stage: stage || null,
      target_date: target_date || null,
      sort_order: sort_order ?? 0,
    });

    return NextResponse.json({ data: milestone });
  } catch (error) {
    console.error("POST /api/deals/[id]/milestones error:", error);
    return NextResponse.json({ error: "Failed to create milestone" }, { status: 500 });
  }
}
