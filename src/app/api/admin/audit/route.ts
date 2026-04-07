import { NextRequest, NextResponse } from "next/server";
import { auditLogQueries } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const { errorResponse } = await requireAdmin();
  if (errorResponse) return errorResponse;

  const limit = Math.min(
    parseInt(new URL(req.url).searchParams.get("limit") ?? "200", 10) || 200,
    1000
  );
  const rows = await auditLogQueries.list(limit);
  return NextResponse.json({ data: rows });
}
