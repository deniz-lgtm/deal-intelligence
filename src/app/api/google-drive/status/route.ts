import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

// Opt out of static analysis at `next build`. Reads auth / headers() / DB.
// Without this flag Next.js evaluates the handler during static-page
// generation and throws Dynamic-server / DATABASE_URL errors.
export const dynamic = "force-dynamic";

export async function GET() {
  const configured = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  if (!configured) {
    return NextResponse.json({ data: { configured: false, connected: false } });
  }
  try {
    const pool = getPool();
    await pool.query(`CREATE TABLE IF NOT EXISTS google_drive_accounts (
      id TEXT PRIMARY KEY DEFAULT 'default', access_token TEXT NOT NULL, refresh_token TEXT,
      account_email TEXT, display_name TEXT, watched_folder_id TEXT, watched_folder_name TEXT,
      last_polled_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    const res = await pool.query("SELECT display_name, account_email FROM google_drive_accounts WHERE id = 'default'");
    if (res.rows.length === 0) return NextResponse.json({ data: { configured: true, connected: false } });
    return NextResponse.json({ data: { configured: true, connected: true, display_name: res.rows[0].display_name, email: res.rows[0].account_email } });
  } catch (err) {
    console.error("Google Drive status error:", err);
    return NextResponse.json({ data: { configured: true, connected: false } });
  }
}
