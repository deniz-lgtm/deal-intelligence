import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { listFolder, refreshAccessToken } from "@/lib/google-drive";

export async function GET(req: NextRequest) {
  const folderId = new URL(req.url).searchParams.get("folder_id") || "root";
  try {
    const pool = getPool();
    const row = await pool.query("SELECT access_token, refresh_token FROM google_drive_accounts WHERE id = 'default'");
    if (row.rows.length === 0) return NextResponse.json({ error: "Not connected" }, { status: 401 });

    let { access_token, refresh_token } = row.rows[0];

    try {
      const files = await listFolder(access_token, folderId);
      return NextResponse.json({ data: files });
    } catch {
      // Try token refresh
      if (refresh_token) {
        const refreshed = await refreshAccessToken(refresh_token);
        access_token = refreshed.access_token;
        await pool.query("UPDATE google_drive_accounts SET access_token = $1, updated_at = NOW() WHERE id = 'default'", [access_token]);
        const files = await listFolder(access_token, folderId);
        return NextResponse.json({ data: files });
      }
      throw new Error("Token expired and no refresh token");
    }
  } catch (error) {
    console.error("Google Drive browse error:", error);
    return NextResponse.json({ error: "Failed to browse files" }, { status: 500 });
  }
}
