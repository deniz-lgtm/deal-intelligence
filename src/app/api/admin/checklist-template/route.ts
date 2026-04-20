import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { checklistTemplateQueries } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { recordAudit } from "@/lib/admin-helpers";
import { DILIGENCE_CHECKLIST_TEMPLATE } from "@/lib/types";

// Opt out of static analysis at `next build`. Reads auth / headers() / DB.
// Without this flag Next.js evaluates the handler during static-page
// generation and throws Dynamic-server / DATABASE_URL errors.
export const dynamic = "force-dynamic";

async function ensureSeeded() {
  const count = await checklistTemplateQueries.count();
  if (count > 0) return;
  let order = 0;
  for (const section of DILIGENCE_CHECKLIST_TEMPLATE) {
    for (const item of section.items) {
      await checklistTemplateQueries.create({
        id: uuidv4(),
        category: section.category,
        item,
        sort_order: order++,
      });
    }
  }
}

export async function GET() {
  const { errorResponse } = await requireAdmin();
  if (errorResponse) return errorResponse;
  await ensureSeeded();
  const items = await checklistTemplateQueries.listAll();
  return NextResponse.json({ data: items });
}

export async function POST(req: NextRequest) {
  const { userId: adminId, errorResponse } = await requireAdmin();
  if (errorResponse) return errorResponse;
  await ensureSeeded();
  let body: { category?: string; item?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.category?.trim() || !body.item?.trim()) {
    return NextResponse.json({ error: "category and item are required" }, { status: 400 });
  }
  const id = uuidv4();
  const all = await checklistTemplateQueries.listAll();
  const sort_order = (all[all.length - 1]?.sort_order ?? 0) + 1;
  await checklistTemplateQueries.create({
    id,
    category: body.category.trim(),
    item: body.item.trim(),
    sort_order,
  });
  await recordAudit({
    userId: adminId,
    action: "checklist_template.item_added",
    targetType: "checklist_template_item",
    targetId: id,
    metadata: { category: body.category, item: body.item },
  });
  const items = await checklistTemplateQueries.listAll();
  return NextResponse.json({ data: items }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const { userId: adminId, errorResponse } = await requireAdmin();
  if (errorResponse) return errorResponse;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  await checklistTemplateQueries.delete(id);
  await recordAudit({
    userId: adminId,
    action: "checklist_template.item_removed",
    targetType: "checklist_template_item",
    targetId: id,
  });
  const items = await checklistTemplateQueries.listAll();
  return NextResponse.json({ data: items });
}
