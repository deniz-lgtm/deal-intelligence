import { NextRequest, NextResponse } from "next/server";
import { buildAuthUrl, getRedirectUri } from "@/lib/google-drive";

export async function GET(req: NextRequest) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = getRedirectUri();
  if (!clientId || !redirectUri) {
    return NextResponse.json({ error: "Google Drive not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI." }, { status: 400 });
  }

  const { searchParams } = new URL(req.url);
  const dealId = searchParams.get("deal_id") ?? "";
  const returnTo = searchParams.get("return") ?? "";
  const state = returnTo ? `return:${returnTo}` : `deal_id:${dealId}`;
  return NextResponse.redirect(buildAuthUrl(state, redirectUri));
}
