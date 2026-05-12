import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { dealQueries, getPool, documentQueries } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

type Decision = "send_to_loi" | "park" | "kill";

const STATUS_BY_DECISION: Record<Decision, string | null> = {
  send_to_loi: "loi",
  park: null, // keep current status, just mark reviewed
  kill: "dead",
};

/**
 * POST /api/inbox/items/[id]/screen
 * Body: { decision: "send_to_loi" | "park" | "kill", thesis?: string }
 *
 * Persists a screening verdict to `screen_decisions`, marks the deal
 * inbox-reviewed, and (for send_to_loi / kill) updates the deal's
 * pipeline status. Replaces the simple dismiss/review flow with a
 * thesis-carrying triage step.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const body = await req.json().catch(() => ({}));
    const decision = body.decision as Decision | undefined;
    const thesis = typeof body.thesis === "string" ? body.thesis.trim().slice(0, 1000) : null;

    if (!decision || !(decision in STATUS_BY_DECISION)) {
      return NextResponse.json({ error: "Invalid decision" }, { status: 400 });
    }

    const deal = await dealQueries.getById(params.id);
    if (!deal) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }
    if (!deal.auto_ingested) {
      return NextResponse.json(
        { error: "Not an auto-ingested deal" },
        { status: 400 }
      );
    }

    const pool = getPool();
    await pool.query(
      `INSERT INTO screen_decisions (id, deal_id, thesis, decision, decided_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [uuidv4(), params.id, thesis, decision, userId ?? null]
    );

    await dealQueries.markInboxReviewed(params.id);
    const nextStatus = STATUS_BY_DECISION[decision];
    if (nextStatus) {
      await dealQueries.update(params.id, { status: nextStatus });
    }

    const updated = await dealQueries.getById(params.id);
    return NextResponse.json({ data: updated });
  } catch (error) {
    console.error("POST /api/inbox/items/[id]/screen error:", error);
    return NextResponse.json(
      { error: "Failed to record screening decision" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/inbox/items/[id]/screen
 * Returns the OM document id for this inbox item so the UI can render
 * a viewer inline. Convenience endpoint — saves the client an extra
 * documents list call.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const docs = await documentQueries.getByDealId(params.id);
    const omDoc =
      docs.find((d: Record<string, unknown>) => d.category === "om") ?? docs[0] ?? null;
    return NextResponse.json({ data: { om_document_id: (omDoc as { id?: string })?.id ?? null } });
  } catch (error) {
    console.error("GET /api/inbox/items/[id]/screen error:", error);
    return NextResponse.json({ error: "Failed to load OM document" }, { status: 500 });
  }
}
