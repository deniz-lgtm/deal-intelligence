import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { changeOrderQueries, constructionRfiQueries } from "@/lib/db";
import { requireAuth, requireDealEditAccess } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Convert an RFI into a draft Change Order. The RFI keeps its `resolved_co_id`
// pointing at the new CO; the CO carries `source_rfi_id` back. From there the
// user opens the CO, fills in cost/schedule impact (or accepts the AI's pre-fill),
// and approves — which rolls into the budget through the line-item link.

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; rfiId: string } }
) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const { errorResponse: accessError } = await requireDealEditAccess(params.id, userId);
  if (accessError) return accessError;

  const rfi = await constructionRfiQueries.getById(params.rfiId);
  if (!rfi || rfi.deal_id !== params.id) {
    return NextResponse.json({ error: "RFI not found" }, { status: 404 });
  }

  // If the RFI has already been converted, return the existing CO instead of
  // creating a duplicate. This makes the button idempotent.
  if (rfi.resolved_co_id) {
    const existing = await changeOrderQueries.getById(rfi.resolved_co_id as string);
    if (existing) {
      return NextResponse.json({ data: existing });
    }
  }

  const body = await req.json().catch(() => ({}));
  const overrides = body || {};

  // Auto-assign co_number.
  const existingCos = await changeOrderQueries.getByDealId(params.id);
  const coNumber = existingCos.length > 0
    ? Math.max(...existingCos.map((c: { co_number: number }) => c.co_number)) + 1
    : 1;

  const co = await changeOrderQueries.create({
    id: uuidv4(),
    deal_id: params.id,
    co_number: coNumber,
    title: overrides.title || `RFI ${rfi.rfi_number ?? ""} — ${rfi.subject}`.trim(),
    description: overrides.description || rfi.response_summary || rfi.notes || "",
    submitted_by: overrides.submitted_by || rfi.submitted_by || null,
    cost_impact: overrides.cost_impact ?? rfi.cost_impact ?? 0,
    schedule_impact_days: overrides.schedule_impact_days ?? rfi.schedule_impact_days ?? 0,
    status: "draft",
    submitted_date: overrides.submitted_date || null,
    decided_date: null,
    hardcost_category: overrides.hardcost_category || null,
    hardcost_item_id: overrides.hardcost_item_id || null,
    source_rfi_id: rfi.id,
    notes: null,
  });

  await constructionRfiQueries.update(params.rfiId, { resolved_co_id: co.id, status: "answered" });

  return NextResponse.json({ data: co });
}
