import { NextResponse } from "next/server";
import { dropboxQueries } from "@/lib/db";

// Opt out of static analysis / prerendering at `next build`. Without this
// Next.js evaluates the route handler during build-time route collection,
// hits getPool(), and throws when DATABASE_URL isn't in the build env
// (Railway's build step doesn't inherit runtime env vars by default).
export const dynamic = "force-dynamic";

export async function GET() {
  // Build-phase short-circuit. If DATABASE_URL isn't injected (Railway's
  // build env), return "not connected" immediately so the build log stays
  // clean and Next.js doesn't fail static-page generation.
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ data: { connected: false } });
  }
  try {
    const account = await dropboxQueries.get();
    if (!account) {
      return NextResponse.json({ data: { connected: false } });
    }
    return NextResponse.json({
      data: {
        connected: true,
        display_name: account.display_name,
        email: account.email,
      },
    });
  } catch (error) {
    console.error("GET /api/dropbox/status error:", error);
    return NextResponse.json({ error: "Failed to check status" }, { status: 500 });
  }
}
