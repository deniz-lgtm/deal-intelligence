import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Per-user home dashboard layout persistence. The client falls back to
 * localStorage for first-paint and as a write-through cache; this
 * endpoint is the source of truth that follows users across devices.
 */

export async function GET() {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  try {
    const pool = getPool();
    const res = await pool.query<{ layout: unknown }>(
      `SELECT layout FROM dashboard_layouts WHERE user_id = $1`,
      [userId],
    );
    if (res.rows.length === 0) {
      return NextResponse.json({ data: null });
    }
    return NextResponse.json({ data: res.rows[0].layout });
  } catch (error) {
    console.error("GET /api/dashboard/layout error:", error);
    return NextResponse.json({ error: "Failed to load layout" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  try {
    const body = await req.json();
    if (!body || typeof body !== "object" || !Array.isArray(body.widgets) || !body.layouts) {
      return NextResponse.json({ error: "Invalid layout payload" }, { status: 400 });
    }
    const pool = getPool();
    await pool.query(
      `INSERT INTO dashboard_layouts (user_id, layout, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (user_id) DO UPDATE SET layout = EXCLUDED.layout, updated_at = NOW()`,
      [userId, JSON.stringify(body)],
    );
    return NextResponse.json({ data: { ok: true } });
  } catch (error) {
    console.error("PUT /api/dashboard/layout error:", error);
    return NextResponse.json({ error: "Failed to save layout" }, { status: 500 });
  }
}

export async function DELETE() {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  try {
    const pool = getPool();
    await pool.query(`DELETE FROM dashboard_layouts WHERE user_id = $1`, [userId]);
    return NextResponse.json({ data: { ok: true } });
  } catch (error) {
    console.error("DELETE /api/dashboard/layout error:", error);
    return NextResponse.json({ error: "Failed to reset layout" }, { status: 500 });
  }
}
