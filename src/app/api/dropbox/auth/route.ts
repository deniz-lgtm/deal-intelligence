import { NextRequest, NextResponse } from "next/server";
import { buildAuthUrl } from "@/lib/dropbox";

export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url);
  const dealId = searchParams.get("deal_id") ?? "";
  const returnTo = searchParams.get("return") ?? "";

  const redirectUri = process.env.DROPBOX_REDIRECT_URI ?? `${origin}/api/dropbox/callback`;
  // State encodes where to send the user after the OAuth round-trip:
  // - `return:inbox` → /inbox (AI Deal Sourcing)
  // - `deal_id:xxx`  → /deals/xxx/documents (existing flow)
  const state = returnTo ? `return:${returnTo}` : `deal_id:${dealId}`;
  const authUrl = buildAuthUrl(redirectUri, state);

  return NextResponse.redirect(authUrl);
}
