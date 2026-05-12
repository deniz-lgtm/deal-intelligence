import { NextResponse } from "next/server";
import { contactQueries } from "@/lib/db";
import { requirePermission } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Sourcing rollup — which brokers/lenders bring us deals, and how
 * those deals score on average. Drives /contacts/sources.
 */
export async function GET() {
  const { errorResponse } = await requirePermission("contacts.access");
  if (errorResponse) return errorResponse;

  try {
    const rows = await contactQueries.sourceRollup();
    return NextResponse.json({ data: rows });
  } catch (error) {
    console.error("GET /api/contacts/sources error:", error);
    return NextResponse.json({ error: "Failed to load source rollup" }, { status: 500 });
  }
}
