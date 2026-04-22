import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { generateProse } from "@/lib/ic-package-prose";
import type { DealContext } from "@/app/deals/[id]/ic-package/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
  if (accessError) return accessError;

  try {
    const body = await req.json();
    const context = body.context as DealContext | undefined;
    if (!context || !context.dealName) {
      return NextResponse.json({ error: "Missing deal context" }, { status: 400 });
    }

    const prose = await generateProse(context);
    return NextResponse.json({ prose });
  } catch (error) {
    console.error("POST /api/deals/[id]/ic-package/generate error:", error);
    const message = error instanceof Error ? error.message : "Generation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
