import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

// Opt out of static analysis / prerendering at `next build`. Without this
// Next.js evaluates the route handler during build-time route collection,
// hits getPool(), and throws when DATABASE_URL isn't in the build env
// (Railway's build step doesn't inherit runtime env vars by default).
export const dynamic = "force-dynamic";

export async function GET() {
  // Build-phase short-circuit. If DATABASE_URL isn't injected (Railway's
  // build env), return a benign 503 immediately so the build log stays
  // clean and Next.js doesn't fail the static-page-generation phase.
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ ok: false, error: "Database not configured" }, { status: 503 });
  }
  try {
    const pool = getPool();

    // Check if table exists and get column info
    const cols = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'business_plans'
      ORDER BY ordinal_position
    `);

    // Try a simple count
    const count = await pool.query("SELECT COUNT(*) as count FROM business_plans");

    return NextResponse.json({
      ok: true,
      table_exists: cols.rows.length > 0,
      columns: cols.rows.map((r: Record<string, string>) => r.column_name),
      column_details: cols.rows,
      row_count: parseInt(count.rows[0].count, 10),
    });
  } catch (error) {
    console.error("Business plans health check error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
