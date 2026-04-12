import { NextRequest, NextResponse } from "next/server";
import { vendorQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; vendorId: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const body = await req.json();
    const vendor = await vendorQueries.update(params.vendorId, body);
    if (!vendor) {
      return NextResponse.json({ error: "Vendor not found or no updates" }, { status: 404 });
    }
    return NextResponse.json({ data: vendor });
  } catch (error) {
    console.error("PATCH vendor error:", error);
    return NextResponse.json({ error: "Failed to update vendor" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; vendorId: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    await vendorQueries.delete(params.vendorId);
    return NextResponse.json({ data: { success: true } });
  } catch (error) {
    console.error("DELETE vendor error:", error);
    return NextResponse.json({ error: "Failed to delete vendor" }, { status: 500 });
  }
}
