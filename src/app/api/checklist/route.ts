import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { checklistQueries, dealNoteQueries } from "@/lib/db";
import { requireAuth, requireDealAccess, syncCurrentUser } from "@/lib/auth";

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
