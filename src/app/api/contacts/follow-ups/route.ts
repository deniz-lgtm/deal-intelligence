import { NextResponse } from "next/server";
import { contactQueries } from "@/lib/db";
import { requirePermission } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Contacts that owe a follow-up today or earlier. Powers the "owed a
 * reply" widget on the home page and the CRM kanban's overdue rail.
 */
export async function GET() {
  const { errorResponse } = await requirePermission("contacts.access");
  if (errorResponse) return errorResponse;

  try {
    const rows = await contactQueries.followUps(50);
    return NextResponse.json({ data: rows });
  } catch (error) {
    console.error("GET /api/contacts/follow-ups error:", error);
    return NextResponse.json({ error: "Failed to load follow-ups" }, { status: 500 });
  }
}
