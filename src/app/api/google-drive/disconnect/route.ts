import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export async function POST() {
  try {
    const pool = getPool();
    await pool.query("DELETE FROM google_drive_accounts WHERE id = 'default'");
    return NextResponse.json({ data: { disconnected: true } });
  } catch {
    return NextResponse.json({ error: "Failed to disconnect" }, { status: 500 });
  }
}
