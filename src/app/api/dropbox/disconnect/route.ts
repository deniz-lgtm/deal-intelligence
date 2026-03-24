import { NextResponse } from "next/server";
import { dropboxQueries } from "@/lib/db";

export async function POST() {
  try {
    await dropboxQueries.disconnect();
    return NextResponse.json({ data: { success: true } });
  } catch (error) {
    console.error("POST /api/dropbox/disconnect error:", error);
    return NextResponse.json({ error: "Failed to disconnect" }, { status: 500 });
  }
}
