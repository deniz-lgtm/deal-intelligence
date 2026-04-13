import { NextRequest, NextResponse } from "next/server";
import { buildAuthUrl, isConfigured } from "@/lib/google-drive";

export async function GET(req: NextRequest) {
  if (!isConfigured()) {
    return NextResponse.json({ error: "Google Drive not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET." }, { status: 400 });
  }
  const { searchParams } = new URL(req.url);
  const dealId = searchParams.get("deal_id") ?? "";
  const returnTo = searchParams.get("return") ?? "";
  const state = returnTo ? `return:${returnTo}` : `deal_id:${dealId}`;
  return NextResponse.redirect(buildAuthUrl(state));
}
