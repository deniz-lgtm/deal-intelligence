import { NextRequest, NextResponse } from "next/server";
import { contactQueries } from "@/lib/db";
import { requirePermission } from "@/lib/auth";

// Opt out of static analysis at `next build`. Reads auth / headers() / DB.
// Without this flag Next.js evaluates the handler during static-page
// generation and throws Dynamic-server / DATABASE_URL errors.
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { contactId: string } }
) {
  const { errorResponse } = await requirePermission("contacts.access");
  if (errorResponse) return errorResponse;

  try {
    const contact = await contactQueries.getByIdWithDeals(params.contactId);
    if (!contact) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }
    return NextResponse.json({ data: contact });
  } catch (error) {
    console.error("GET /api/contacts/[contactId] error:", error);
    return NextResponse.json({ error: "Failed to fetch contact" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { contactId: string } }
) {
  const { errorResponse } = await requirePermission("contacts.access");
  if (errorResponse) return errorResponse;

  try {
    const body = await req.json();
    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) updates.name = String(body.name).trim();
    if (body.email !== undefined) updates.email = body.email ? String(body.email).trim() : null;
    if (body.phone !== undefined) updates.phone = body.phone ? String(body.phone).trim() : null;
    if (body.role !== undefined) updates.role = body.role;
    if (body.company !== undefined) updates.company = body.company ? String(body.company).trim() : null;
    if (body.title !== undefined) updates.title = body.title ? String(body.title).trim() : null;
    if (body.notes !== undefined) updates.notes = body.notes ? String(body.notes).trim() : null;
    if (body.tags !== undefined) updates.tags = Array.isArray(body.tags) ? body.tags : [];

    const row = await contactQueries.update(params.contactId, updates);
    if (!row) {
      return NextResponse.json({ error: "Contact not found or no updates" }, { status: 404 });
    }
    return NextResponse.json({ data: row });
  } catch (error) {
    console.error("PATCH /api/contacts/[contactId] error:", error);
    return NextResponse.json({ error: "Failed to update contact" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { contactId: string } }
) {
  const { errorResponse } = await requirePermission("contacts.access");
  if (errorResponse) return errorResponse;

  try {
    await contactQueries.delete(params.contactId);
    return NextResponse.json({ data: { success: true } });
  } catch (error) {
    console.error("DELETE /api/contacts/[contactId] error:", error);
    return NextResponse.json({ error: "Failed to delete contact" }, { status: 500 });
  }
}
