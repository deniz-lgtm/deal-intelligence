import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForTokens, getUserInfo, getRedirectUri } from "@/lib/google-drive";
import { getPool } from "@/lib/db";

// Opt out of static analysis at `next build`. Reads auth / headers() / DB.
// Without this flag Next.js evaluates the handler during static-page
// generation and throws Dynamic-server / DATABASE_URL errors.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state") || "";

  // Derive public origin from the registered redirect URI (not from req.url which is internal on Railway)
  const redirectUri = getRedirectUri();
  const publicOrigin = redirectUri.replace(/\/api\/google-drive\/callback\/?$/, "");

  if (!code) return NextResponse.redirect(`${publicOrigin}/?error=no_code`);

  try {
    const tokens = await exchangeCodeForTokens(code, redirectUri);
    const userInfo = await getUserInfo(tokens.access_token);

    const pool = getPool();
    await pool.query(`CREATE TABLE IF NOT EXISTS google_drive_accounts (
      id TEXT PRIMARY KEY DEFAULT 'default',
      access_token TEXT NOT NULL,
      refresh_token TEXT,
      account_email TEXT,
      display_name TEXT,
      watched_folder_id TEXT,
      watched_folder_name TEXT,
      last_polled_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);

    const result = await pool.query(
      `INSERT INTO google_drive_accounts (id, access_token, refresh_token, account_email, display_name)
       VALUES ('default', $1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET access_token = $1, refresh_token = COALESCE($2, google_drive_accounts.refresh_token),
         account_email = $3, display_name = $4, updated_at = NOW()
       RETURNING id`,
      [tokens.access_token, tokens.refresh_token, userInfo.email, userInfo.name]
    );
    console.log("Google Drive account saved:", { email: userInfo.email, rows: result.rowCount });

    // Route user back to public origin
    const [key, value] = state.split(":");
    if (key === "return" && value === "inbox") {
      return NextResponse.redirect(`${publicOrigin}/inbox?gdrive=connected`);
    }
    if (key === "deal_id" && value) {
      return NextResponse.redirect(`${publicOrigin}/deals/${value}/documents?gdrive=connected`);
    }
    return NextResponse.redirect(`${publicOrigin}/?gdrive=connected`);
  } catch (error) {
    console.error("Google Drive callback error:", error);
    return NextResponse.redirect(`${publicOrigin}/?error=gdrive_auth_failed`);
  }
}
