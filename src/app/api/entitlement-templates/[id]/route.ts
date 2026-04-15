import { NextRequest, NextResponse } from "next/server";
import { entitlementTemplateQueries } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

/**
 * PATCH — rename and/or replace tasks on one of the current user's
 * templates. Body: { name?, tasks? }.
 * DELETE — remove a template.
 *
 * Both enforce user-ownership in the query (user_id = $). A PATCH on a
 * template that belongs to someone else returns 404 rather than 403, to
 * avoid leaking existence.
 */

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const body = await req.json();
    const updates: { name?: string; tasks?: unknown } = {};
    if (typeof body.name === "string") {
      const name = body.name.trim();
      if (!name) {
        return NextResponse.json({ error: "name must be non-empty" }, { status: 400 });
      }
      updates.name = name;
    }
    if (Array.isArray(body.tasks)) {
      updates.tasks = body.tasks;
    }
    if (!updates.name && !updates.tasks) {
      return NextResponse.json({ error: "nothing to update" }, { status: 400 });
    }
    const row = await entitlementTemplateQueries.update(params.id, userId, updates);
    if (!row) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }
    return NextResponse.json({ data: row });
  } catch (error) {
    console.error("PATCH /api/entitlement-templates/[id] error:", error);
    return NextResponse.json({ error: "Failed to update template" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    await entitlementTemplateQueries.delete(params.id, userId);
    return NextResponse.json({ data: { success: true } });
  } catch (error) {
    console.error("DELETE /api/entitlement-templates/[id] error:", error);
    return NextResponse.json({ error: "Failed to delete template" }, { status: 500 });
  }
}
