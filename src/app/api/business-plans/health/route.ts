import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export async function GET() {
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
