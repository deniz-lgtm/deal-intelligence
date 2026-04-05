import { NextRequest, NextResponse } from "next/server";
import { checklistQueries } from "@/lib/db";
import { requireAuth, requireDealAccess, syncCurrentUser } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  await syncCurrentUser(userId);

  try {
    const { searchParams } = new URL(req.url);
    const dealId = searchParams.get("deal_id");

    if (!dealId) {
      return NextResponse.json({ error: "deal_id is required" }, { status: 400 });
    }

    const { errorResponse: accessError } = await requireDealAccess(dealId, userId);
    if (accessError) return accessError;

    const items = await checklistQueries.getByDealId(dealId);
    return NextResponse.json({ data: items });
  } catch (error) {
    console.error("GET /api/checklist error:", error);
    return NextResponse.json({ error: "Failed to fetch checklist" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  await syncCurrentUser(userId);

  try {
    const body = await req.json();
    const { id, status, notes } = body;

    if (!id || !status) {
      return NextResponse.json(
        { error: "id and status are required" },
        { status: 400 }
      );
    }

    // Look up the checklist item to verify deal access
    const item = await checklistQueries.getById(id) as { deal_id: string } | null;
    if (!item) {
      return NextResponse.json({ error: "Checklist item not found" }, { status: 404 });
    }

    const { errorResponse: accessError } = await requireDealAccess(item.deal_id, userId);
    if (accessError) return accessError;

    await checklistQueries.updateStatus(id, status, notes || null);
    return NextResponse.json({ data: { success: true } });
  } catch (error) {
    console.error("PATCH /api/checklist error:", error);
    return NextResponse.json({ error: "Failed to update checklist item" }, { status: 500 });
  }
}
