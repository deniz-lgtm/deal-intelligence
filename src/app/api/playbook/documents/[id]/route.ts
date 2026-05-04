import { NextResponse } from "next/server";
import { playbookQueries } from "@/lib/db";
import { requirePermission } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const { errorResponse } = await requirePermission("documents.upload");
  if (errorResponse) return errorResponse;

  try {
    const deleted = await playbookQueries.deleteDocument(params.id);
    if (!deleted) {
      return NextResponse.json({ error: "Playbook document not found" }, { status: 404 });
    }
    return NextResponse.json({ data: { id: params.id } });
  } catch (error) {
    console.error("DELETE /api/playbook/documents/[id] error:", error);
    return NextResponse.json({ error: "Failed to delete playbook document" }, { status: 500 });
  }
}
