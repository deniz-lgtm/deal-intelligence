import { NextRequest, NextResponse } from "next/server";
import { buildAuthUrl } from "@/lib/google-drive";

export async function GET(req: NextRequest) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: "Google Drive not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET." }, { status: 400 });
  }

  // Derive redirect URI from the request if not explicitly set
  const { searchParams, origin } = new URL(req.url);
  if (!process.env.GOOGLE_REDIRECT_URI) {
    // Auto-set for this request
    process.env.GOOGLE_REDIRECT_URI = `${origin}/api/google-drive/callback`;
  }

  const dealId = searchParams.get("deal_id") ?? "";
  const returnTo = searchParams.get("return") ?? "";
  const state = returnTo ? `return:${returnTo}` : `deal_id:${dealId}`;
  return NextResponse.redirect(buildAuthUrl(state));
}
