import { NextRequest, NextResponse } from "next/server";
import { buildAuthUrl, getRedirectUri } from "@/lib/google-drive";

export async function GET(req: NextRequest) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: "Google Drive not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET." }, { status: 400 });
  }

  const { searchParams, origin } = new URL(req.url);
  const redirectUri = getRedirectUri(origin);

  const dealId = searchParams.get("deal_id") ?? "";
  const returnTo = searchParams.get("return") ?? "";
  const state = returnTo ? `return:${returnTo}` : `deal_id:${dealId}`;
  return NextResponse.redirect(buildAuthUrl(state, redirectUri));
}
