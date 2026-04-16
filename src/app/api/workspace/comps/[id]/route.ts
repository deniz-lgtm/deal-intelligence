import { NextRequest, NextResponse } from "next/server";
import { compQueries, getPool } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

/**
 * Workspace-level comp operations. These work on any comp in the comps
 * table regardless of whether it's attached to a specific deal or lives
 * at the workspace level (deal_id is null). Access is checked via the
 * accessible-deals subquery: you can operate on a comp if it's attached
 * to a deal you can see, OR it's a workspace-only comp whose source_deal
 * you can see, OR it's a pure workspace comp with no source deal.
 */

async function userCanAccessComp(compId: string, userId: string): Promise<{ ok: boolean; comp?: Record<string, unknown> }> {
  const pool = getPool();
  const res = await pool.query(
    `SELECT c.*
     FROM comps c
     LEFT JOIN deals d_attached ON d_attached.id = c.deal_id
     LEFT JOIN deals d_source   ON d_source.id   = c.source_deal_id
     LEFT JOIN deal_shares s_attached ON s_attached.deal_id = d_attached.id AND s_attached.user_id = $2
     LEFT JOIN deal_shares s_source   ON s_source.deal_id   = d_source.id   AND s_source.user_id   = $2
     WHERE c.id = $1
       AND (
         c.deal_id IS NULL
         OR d_attached.owner_id = $2
         OR s_attached.deal_id IS NOT NULL
         OR d_source.owner_id = $2
         OR s_source.deal_id IS NOT NULL
       )`,
    [compId, userId]
  );
  if (res.rows.length === 0) return { ok: false };
  return { ok: true, comp: res.rows[0] };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const { ok } = await userCanAccessComp(params.id, userId);
    if (!ok) {
      return NextResponse.json({ error: "Comp not found" }, { status: 404 });
    }

    const body = await req.json();
    const row = await compQueries.update(params.id, body);
    return NextResponse.json({ data: row });
  } catch (error) {
    console.error("PATCH /api/workspace/comps/[id] error:", error);
    return NextResponse.json(
      { error: "Failed to update comp" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const { ok } = await userCanAccessComp(params.id, userId);
    if (!ok) {
      return NextResponse.json({ error: "Comp not found" }, { status: 404 });
    }

    await compQueries.delete(params.id);
    return NextResponse.json({ data: { success: true } });
  } catch (error) {
    console.error("DELETE /api/workspace/comps/[id] error:", error);
    return NextResponse.json(
      { error: "Failed to delete comp" },
      { status: 500 }
    );
  }
}
