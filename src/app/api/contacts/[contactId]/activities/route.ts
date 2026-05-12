import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { contactActivityQueries } from "@/lib/db";
import { requireAuth, requirePermission } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { contactId: string } }
) {
  const { errorResponse } = await requirePermission("contacts.access");
  if (errorResponse) return errorResponse;

  try {
    const rows = await contactActivityQueries.listByContact(params.contactId);
    return NextResponse.json({ data: rows });
  } catch (error) {
    console.error("GET /api/contacts/[contactId]/activities error:", error);
    return NextResponse.json({ error: "Failed to load activities" }, { status: 500 });
  }
}

const VALID_KINDS = new Set(["call", "email", "meeting", "note", "intro", "send"]);

export async function POST(
  req: NextRequest,
  { params }: { params: { contactId: string } }
) {
  const { errorResponse: permErr } = await requirePermission("contacts.access");
  if (permErr) return permErr;
  const { userId } = await requireAuth();

  try {
    const body = await req.json();
    const kind = typeof body.kind === "string" && VALID_KINDS.has(body.kind) ? body.kind : "note";

    const row = await contactActivityQueries.create({
      id: uuidv4(),
      contact_id: params.contactId,
      deal_id: body.deal_id ?? null,
      kind,
      subject: body.subject ? String(body.subject).trim().slice(0, 200) : null,
      body: body.body ? String(body.body).trim().slice(0, 4000) : null,
      occurred_at: body.occurred_at ?? null,
      created_by: userId ?? null,
    });
    return NextResponse.json({ data: row }, { status: 201 });
  } catch (error) {
    console.error("POST /api/contacts/[contactId]/activities error:", error);
    return NextResponse.json({ error: "Failed to log activity" }, { status: 500 });
  }
}
