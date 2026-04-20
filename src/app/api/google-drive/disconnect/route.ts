import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

// Opt out of static analysis at `next build`. Reads auth / headers() / DB.
// Without this flag Next.js evaluates the handler during static-page
// generation and throws Dynamic-server / DATABASE_URL errors.
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const pool = getPool();
    await pool.query("DELETE FROM google_drive_accounts WHERE id = 'default'");
    return NextResponse.json({ data: { disconnected: true } });
  } catch {
    return NextResponse.json({ error: "Failed to disconnect" }, { status: 500 });
  }
}
