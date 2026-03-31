import { NextRequest, NextResponse } from "next/server";
import { dealQueries, documentQueries } from "@/lib/db";
import { extractDealFields } from "@/lib/claude";
import type { Document } from "@/lib/types";
import { requireAuth, requireDealAccess } from "@/lib/auth";

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const deal = await dealQueries.getById(params.id);
    const documents = (await documentQueries.getByDealId(params.id)) as Document[];
    if (documents.length === 0) {
      return NextResponse.json({ error: "No documents uploaded yet" }, { status: 400 });
    }

    const extracted = await extractDealFields(documents);

    if (Object.keys(extracted).length === 0) {
      return NextResponse.json({ data: deal, filled_count: 0 });
    }

    // Only fill fields that are currently empty — never override human inputs
    const dealRecord = deal as Record<string, unknown>;
    const safeToFill = Object.fromEntries(
      Object.entries(extracted).filter(([key, value]) => {
        const existing = dealRecord[key];
        return existing === null || existing === undefined || existing === "" || existing === 0;
      })
    );

    if (Object.keys(safeToFill).length === 0) {
      return NextResponse.json({ data: deal, filled_count: 0 });
    }

    const updated = await dealQueries.update(params.id, safeToFill as Record<string, unknown>);
    return NextResponse.json({ data: updated, filled_count: Object.keys(safeToFill).length });
  } catch (error) {
    console.error("POST /api/deals/[id]/autofill error:", error);
    return NextResponse.json({ error: "Failed to auto-fill deal fields" }, { status: 500 });
  }
}
