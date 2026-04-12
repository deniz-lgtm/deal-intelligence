import { NextRequest, NextResponse } from "next/server";
import { permitQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; permitId: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const body = await req.json();
    const permit = await permitQueries.update(params.permitId, body);
    if (!permit) {
      return NextResponse.json({ error: "Permit not found or no updates" }, { status: 404 });
    }
    return NextResponse.json({ data: permit });
  } catch (error) {
    console.error("PATCH permit error:", error);
    return NextResponse.json({ error: "Failed to update permit" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; permitId: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    await permitQueries.delete(params.permitId);
    return NextResponse.json({ data: { success: true } });
  } catch (error) {
    console.error("DELETE permit error:", error);
    return NextResponse.json({ error: "Failed to delete permit" }, { status: 500 });
  }
}
