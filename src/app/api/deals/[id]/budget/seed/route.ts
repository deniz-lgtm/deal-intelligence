import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { hardCostQueries, budgetVersionQueries } from "@/lib/db";
import { requireAuth, requireDealEditAccess } from "@/lib/auth";
import { STANDARD_SOV_TEMPLATE, CSI_DIVISIONS } from "@/lib/types";

export const dynamic = "force-dynamic";

// Seed a standard SOV (lender-style hard + soft + contingency) or a CSI
// MasterFormat division skeleton into a budget version. Idempotent via the
// `replace` flag — set to true to wipe existing lines before insert.

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const { errorResponse: accessError } = await requireDealEditAccess(params.id, userId);
  if (accessError) return accessError;

  const body = await req.json();
  const template = (body.template as string) || "standard_sov";
  let versionId = (body.version_id as string | null) || null;
  const replace = body.replace === true;

  // Ensure a version exists.
  if (!versionId) {
    const active = await budgetVersionQueries.getActive(params.id);
    if (active) {
      versionId = active.id as string;
    } else {
      const created = await budgetVersionQueries.create({
        id: uuidv4(),
        deal_id: params.id,
        label: "V1 - Initial",
        created_by: userId,
      });
      await budgetVersionQueries.setActive(params.id, created.id as string);
      versionId = created.id as string;
    }
  }

  if (replace) {
    const existing = await hardCostQueries.getByDealId(params.id, versionId);
    for (const e of existing) {
      await hardCostQueries.delete(e.id as string);
    }
  }

  let items: Array<Record<string, unknown>> = [];
  if (template === "standard_sov") {
    items = STANDARD_SOV_TEMPLATE.map((row, i) => ({
      id: uuidv4(),
      deal_id: params.id,
      category: row.category,
      description: row.description,
      cost_class: row.cost_class,
      amount: 0,
      sort_order: i,
      budget_version_id: versionId,
    }));
  } else if (template === "csi") {
    items = CSI_DIVISIONS.map((div, i) => ({
      id: uuidv4(),
      deal_id: params.id,
      category: `${div.code} - ${div.name}`,
      description: div.name,
      cost_class: "hard",
      csi_code: div.code,
      amount: 0,
      sort_order: i,
      budget_version_id: versionId,
    }));
    // Append a soft-cost stub + contingency row so a CSI seed is still a
    // functional starting budget rather than just hard divisions.
    items.push(
      { id: uuidv4(), deal_id: params.id, category: "Soft Cost", description: "Architecture & Engineering", cost_class: "soft", amount: 0, sort_order: items.length, budget_version_id: versionId },
      { id: uuidv4(), deal_id: params.id, category: "Soft Cost", description: "Permits & Fees", cost_class: "soft", amount: 0, sort_order: items.length + 1, budget_version_id: versionId },
      { id: uuidv4(), deal_id: params.id, category: "Soft Cost", description: "Legal & Title", cost_class: "soft", amount: 0, sort_order: items.length + 2, budget_version_id: versionId },
      { id: uuidv4(), deal_id: params.id, category: "Soft Cost", description: "Loan Interest & Fees", cost_class: "soft", amount: 0, sort_order: items.length + 3, budget_version_id: versionId },
      { id: uuidv4(), deal_id: params.id, category: "Contingency", description: "Construction Contingency", cost_class: "contingency", amount: 0, sort_order: items.length + 4, budget_version_id: versionId },
    );
  } else {
    return NextResponse.json({ error: `Unknown template: ${template}` }, { status: 400 });
  }

  await hardCostQueries.bulkCreate(items);
  return NextResponse.json({ data: { inserted: items.length, version_id: versionId } });
}
