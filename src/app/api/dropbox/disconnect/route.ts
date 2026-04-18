import { NextResponse } from "next/server";
import { dropboxQueries } from "@/lib/db";

// Opt out of static analysis at `next build`. Reads auth / headers() / DB.
// Without this flag Next.js evaluates the handler during static-page
// generation and throws Dynamic-server / DATABASE_URL errors.
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    await dropboxQueries.disconnect();
    return NextResponse.json({ data: { success: true } });
  } catch (error) {
    console.error("POST /api/dropbox/disconnect error:", error);
    return NextResponse.json({ error: "Failed to disconnect" }, { status: 500 });
  }
}
