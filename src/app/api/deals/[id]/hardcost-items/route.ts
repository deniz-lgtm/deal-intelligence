import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { hardCostQueries, budgetVersionQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const url = new URL(req.url);
    const versionId = url.searchParams.get("version_id");
    const costClass = url.searchParams.get("cost_class");
    const items = await hardCostQueries.getByDealId(params.id, versionId, costClass);
    return NextResponse.json({ data: items });
  } catch (error) {
    console.error("GET /api/deals/[id]/hardcost-items error:", error);
    return NextResponse.json({ error: "Failed to fetch budget items" }, { status: 500 });
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
    const {
      category, description, vendor, amount, status, incurred_date, notes, etc, forecast_note,
      cost_class, csi_code, unit, change_order_amount, retainage_pct, budget_version_id,
    } = body;

    if (!category?.trim() || !description?.trim()) {
      return NextResponse.json({ error: "category and description are required" }, { status: 400 });
    }

    // Default to the active version when caller doesn't specify one — keeps
    // the legacy "just add a line" UX working without making clients aware
    // of versioning.
    let versionId = budget_version_id || null;
    if (!versionId) {
      const active = await budgetVersionQueries.getActive(params.id);
      versionId = active?.id ?? null;
    }

    const payload = {
      id: uuidv4(),
      deal_id: params.id,
      category: category.trim(),
      description: description.trim(),
      vendor: vendor || null,
      amount: amount ?? 0,
      status: status || "estimated",
      incurred_date: incurred_date || null,
      notes: notes || null,
      etc: etc === undefined || etc === null || etc === "" ? null : Number(etc),
      forecast_note: forecast_note || null,
      cost_class: cost_class || "hard",
      csi_code: csi_code || null,
      unit: unit || null,
      change_order_amount: change_order_amount ?? 0,
      retainage_pct: retainage_pct ?? 0,
      budget_version_id: versionId,
    };

    const item = await hardCostQueries.create(payload);
    return NextResponse.json({ data: item });
  } catch (error) {
    console.error("POST /api/deals/[id]/hardcost-items error:", error);
    return NextResponse.json({ error: "Failed to create budget item" }, { status: 500 });
  }
}
