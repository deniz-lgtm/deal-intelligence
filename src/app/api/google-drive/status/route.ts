import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

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
  } catch {
    return NextResponse.json({ data: { configured: false, connected: false } });
  }
}
