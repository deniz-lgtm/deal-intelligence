import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { checklistQueries, dealNoteQueries, getPool } from "@/lib/db";
import { requireAuth, requireDealAccess, requireDealEditAccess, syncCurrentUser } from "@/lib/auth";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  await syncCurrentUser(userId);

  try {
    const { searchParams } = new URL(req.url);
    const dealId = searchParams.get("deal_id");
    const phase = searchParams.get("phase") || undefined;

    if (!dealId) {
      return NextResponse.json({ error: "deal_id is required" }, { status: 400 });
    }

    const { errorResponse: accessError } = await requireDealAccess(dealId, userId);
    if (accessError) return accessError;

    const items = await checklistQueries.getByDealId(dealId, phase);
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

    const { errorResponse: accessError } = await requireDealEditAccess(item.deal_id, userId);
    if (accessError) return accessError;

    await checklistQueries.updateStatus(id, status, notes || null);

    // If this status change pushes the deal's checklist to 100% complete,
    // drop a one-time note so it shows up in Chat context, the Deal Log,
    // and any downstream feature that reads deal memory.
    let completionLogged = false;
    if (status === "complete") {
      try {
        const items = await checklistQueries.getByDealId(item.deal_id) as Array<{
          status: string;
        }>;
        const total = items.length;
        const done = items.filter((i) => i.status === "complete").length;
        if (total > 0 && done === total) {
          const existingNotes = await dealNoteQueries.getByDealId(item.deal_id) as Array<{
            source: string | null;
          }>;
          const alreadyLogged = existingNotes.some((n) => n.source === "checklist_complete");
          if (!alreadyLogged) {
            await dealNoteQueries.create({
              id: uuidv4(),
              deal_id: item.deal_id,
              text: `[Checklist Complete ${new Date().toLocaleDateString()}] All ${total} diligence items marked complete.`,
              category: "context",
              source: "checklist_complete",
            });
            completionLogged = true;
          }
        }
      } catch (err) {
        console.error("Failed to log checklist completion:", err);
      }
    }

    return NextResponse.json({ data: { success: true, completion_logged: completionLogged } });
  } catch (error) {
    console.error("PATCH /api/checklist error:", error);
    return NextResponse.json({ error: "Failed to update checklist item" }, { status: 500 });
  }
}

// Manual creation of a checklist item — used by the closeout page so users
// can add custom punch-list items per section without going through admin
// templates.
export async function POST(req: NextRequest) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  await syncCurrentUser(userId);

  try {
    const body = await req.json();
    const { deal_id, category, item, phase = "diligence", notes = null } = body;
    if (!deal_id || !category?.trim() || !item?.trim()) {
      return NextResponse.json({ error: "deal_id, category, and item are required" }, { status: 400 });
    }
    const { errorResponse: accessError } = await requireDealEditAccess(deal_id, userId);
    if (accessError) return accessError;

    const id = uuidv4();
    await checklistQueries.upsert({
      id,
      deal_id,
      category: category.trim(),
      item: item.trim(),
      status: "pending",
      notes,
      ai_filled: false,
      source_document_ids: null,
      phase,
    });
    const created = await checklistQueries.getById(id);
    return NextResponse.json({ data: created });
  } catch (error) {
    console.error("POST /api/checklist error:", error);
    return NextResponse.json({ error: "Failed to create checklist item" }, { status: 500 });
  }
}

// Edit an item's metadata (category, item label, phase) — separate from PATCH
// which only handles status/notes changes via the existing flow.
export async function PUT(req: NextRequest) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  try {
    const body = await req.json();
    const { id, category, item, phase } = body;
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
    const existing = await checklistQueries.getById(id) as { deal_id: string } | null;
    if (!existing) return NextResponse.json({ error: "checklist item not found" }, { status: 404 });
    const { errorResponse: accessError } = await requireDealEditAccess(existing.deal_id, userId);
    if (accessError) return accessError;

    const pool = getPool();
    const sets: string[] = [];
    const values: unknown[] = [];
    let idx = 1;
    if (category !== undefined) { sets.push(`category = $${idx++}`); values.push(category); }
    if (item !== undefined) { sets.push(`item = $${idx++}`); values.push(item); }
    if (phase !== undefined) { sets.push(`phase = $${idx++}`); values.push(phase); }
    if (sets.length === 0) return NextResponse.json({ error: "no editable fields provided" }, { status: 400 });
    sets.push(`updated_at = NOW()`);
    values.push(id);
    await pool.query(`UPDATE checklist_items SET ${sets.join(", ")} WHERE id = $${idx}`, values);
    const updated = await checklistQueries.getById(id);
    return NextResponse.json({ data: updated });
  } catch (error) {
    console.error("PUT /api/checklist error:", error);
    return NextResponse.json({ error: "Failed to update checklist item" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  await syncCurrentUser(userId);

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const item = await checklistQueries.getById(id) as { deal_id: string } | null;
    if (!item) {
      return NextResponse.json({ error: "Checklist item not found" }, { status: 404 });
    }

    const { errorResponse: accessError } = await requireDealEditAccess(item.deal_id, userId);
    if (accessError) return accessError;

    const pool = getPool();
    await pool.query("DELETE FROM checklist_items WHERE id = $1", [id]);
    return NextResponse.json({ data: { success: true } });
  } catch (error) {
    console.error("DELETE /api/checklist error:", error);
    return NextResponse.json({ error: "Failed to delete checklist item" }, { status: 500 });
  }
}
