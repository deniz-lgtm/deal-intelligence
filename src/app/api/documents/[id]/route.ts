import { NextRequest, NextResponse } from "next/server";
import { documentQueries } from "@/lib/db";
import { deleteBlob } from "@/lib/blob-storage";
import { requireAuth, requireDealAccess, syncCurrentUser } from "@/lib/auth";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  await syncCurrentUser(userId);

  try {
    const doc = await documentQueries.getById(params.id) as { deal_id: string } | null;
    if (!doc) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const { errorResponse: accessError } = await requireDealAccess(doc.deal_id, userId);
    if (accessError) return accessError;

    return NextResponse.json({ data: doc });
  } catch (error) {
    console.error("GET /api/documents/[id] error:", error);
    return NextResponse.json({ error: "Failed to fetch document" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  await syncCurrentUser(userId);

  try {
    const doc = await documentQueries.getById(params.id) as { deal_id: string } | null;
    if (!doc) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const { errorResponse: accessError } = await requireDealAccess(doc.deal_id, userId);
    if (accessError) return accessError;

    const body = await req.json();
    const updates: Record<string, unknown> = {};
    if (body.category) updates.category = body.category;
    if (body.is_key !== undefined) updates.is_key = body.is_key;
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }
    const updated = await documentQueries.update(params.id, updates);
    if (!updated) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }
    return NextResponse.json({ data: updated });
  } catch (error) {
    console.error("PATCH /api/documents/[id] error:", error);
    return NextResponse.json({ error: "Failed to update document" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  await syncCurrentUser(userId);

  try {
    const doc = await documentQueries.getById(params.id) as { deal_id: string; file_path?: string } | null;
    if (!doc) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const { errorResponse: accessError } = await requireDealAccess(doc.deal_id, userId);
    if (accessError) return accessError;

    const deleted = await documentQueries.delete(params.id) as { file_path?: string } | null;
    if (deleted?.file_path) {
      await deleteBlob(deleted.file_path);
    }
    return NextResponse.json({ data: { success: true } });
  } catch (error) {
    console.error("DELETE /api/documents/[id] error:", error);
    return NextResponse.json({ error: "Failed to delete document" }, { status: 500 });
  }
}
