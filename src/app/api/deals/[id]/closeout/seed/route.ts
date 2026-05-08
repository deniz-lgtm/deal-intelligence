import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { checklistQueries } from "@/lib/db";
import { requireAuth, requireDealEditAccess } from "@/lib/auth";
import { CLOSEOUT_CHECKLIST_TEMPLATE } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const { errorResponse: accessError } = await requireDealEditAccess(params.id, userId);
  if (accessError) return accessError;

  const inserted = await checklistQueries.seedCloseout(
    params.id,
    CLOSEOUT_CHECKLIST_TEMPLATE,
    () => uuidv4(),
  );
  return NextResponse.json({ data: { inserted } });
}
