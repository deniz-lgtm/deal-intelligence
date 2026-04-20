import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForTokens } from "@/lib/dropbox";
import { dropboxQueries } from "@/lib/db";

// Opt out of static analysis at `next build`. Reads auth / headers() / DB.
// Without this flag Next.js evaluates the handler during static-page
// generation and throws Dynamic-server / DATABASE_URL errors.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state") ?? "";
  const error = searchParams.get("error");

  // Use DROPBOX_REDIRECT_URI env var when set (required to match what was sent in auth step).
  // Derive the app's public base URL from it so final redirects go to the right place.
  const redirectUri = process.env.DROPBOX_REDIRECT_URI ?? `${origin}/api/dropbox/callback`;
  const appOrigin = process.env.DROPBOX_REDIRECT_URI
    ? process.env.DROPBOX_REDIRECT_URI.replace(/\/api\/dropbox\/callback$/, "")
    : origin;

  if (error) {
    return NextResponse.redirect(`${appOrigin}/?dropbox=denied`);
  }

  if (!code) {
    return NextResponse.redirect(`${appOrigin}/?dropbox=error`);
  }

  // Extract deal_id OR return:xxx from state so we can redirect back
  // to the right page after the OAuth round-trip.
  const dealId = state.startsWith("deal_id:") ? state.slice(8) : "";
  const returnTo = state.startsWith("return:") ? state.slice(7) : "";

  try {
    const tokens = await exchangeCodeForTokens(code, redirectUri);

    // Fetch account info for display
    let displayName: string | undefined;
    let email: string | undefined;
    try {
      const acctRes = await fetch("https://api.dropboxapi.com/2/users/get_current_account", {
        method: "POST",
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (acctRes.ok) {
        const acct = await acctRes.json();
        displayName = acct.name?.display_name;
        email = acct.email;
      }
    } catch {
      // non-fatal
    }

    await dropboxQueries.upsert({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      account_id: tokens.account_id,
      display_name: displayName,
      email,
    });

    // Route the user back to wherever they initiated the connect from.
    let redirect: string;
    if (returnTo === "inbox") {
      redirect = `${appOrigin}/inbox?dropbox=connected`;
    } else if (dealId) {
      redirect = `${appOrigin}/deals/${dealId}/documents?dropbox=connected`;
    } else {
      redirect = `${appOrigin}/?dropbox=connected`;
    }

    return NextResponse.redirect(redirect);
  } catch (err) {
    console.error("Dropbox callback error:", err);
    return NextResponse.redirect(`${appOrigin}/?dropbox=error`);
  }
}
