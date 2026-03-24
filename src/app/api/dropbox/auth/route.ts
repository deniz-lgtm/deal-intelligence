import { NextRequest, NextResponse } from "next/server";
import { buildAuthUrl } from "@/lib/dropbox";

export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url);
  const dealId = searchParams.get("deal_id") ?? "";

  const redirectUri = process.env.DROPBOX_REDIRECT_URI ?? `${origin}/api/dropbox/callback`;
  const state = `deal_id:${dealId}`;
  const authUrl = buildAuthUrl(redirectUri, state);

  return NextResponse.redirect(authUrl);
}
