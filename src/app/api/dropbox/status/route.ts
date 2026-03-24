import { NextResponse } from "next/server";
import { dropboxQueries } from "@/lib/db";

export async function GET() {
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
