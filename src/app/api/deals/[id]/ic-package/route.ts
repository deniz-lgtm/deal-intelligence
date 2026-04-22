import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireDealAccess, requireDealEditAccess } from "@/lib/auth";
import { icPackageQueries } from "@/lib/db";
import type { DealContext, ProseSections } from "@/app/deals/[id]/ic-package/types";

export const dynamic = "force-dynamic";

/** GET /api/deals/[id]/ic-package — returns the latest saved IC package (if any). */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
  if (accessError) return accessError;

  try {
    const row = await icPackageQueries.getLatest(params.id);
    return NextResponse.json({
      prose: row?.prose ?? null,
      context: row?.context ?? null,
      version: row?.version ?? null,
      updatedAt: row?.updated_at ?? null,
    });
  } catch (err) {
    console.error("GET /api/deals/[id]/ic-package error:", err);
    return NextResponse.json({ error: "Failed to load IC package" }, { status: 500 });
  }
}

/**
 * PUT /api/deals/[id]/ic-package — save a new version of the IC package.
 * Body: { prose: ProseSections, context: DealContext }
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  const { errorResponse: accessError } = await requireDealEditAccess(params.id, userId);
  if (accessError) return accessError;

  try {
    const body = await req.json();
    const prose = body.prose as ProseSections | undefined;
    const context = body.context as DealContext | undefined;
    if (!prose) {
      return NextResponse.json({ error: "Missing prose" }, { status: 400 });
    }
    const row = await icPackageQueries.saveLatest(params.id, prose, context ?? null, userId);
    return NextResponse.json({
      prose: row.prose,
      context: row.context,
      version: row.version,
      updatedAt: row.updated_at,
    });
  } catch (err) {
    console.error("PUT /api/deals/[id]/ic-package error:", err);
    return NextResponse.json({ error: "Failed to save IC package" }, { status: 500 });
  }
}
