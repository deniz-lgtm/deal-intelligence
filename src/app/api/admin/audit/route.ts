import { NextRequest, NextResponse } from "next/server";
import { auditLogQueries } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

// Opt out of static analysis at `next build`. Reads auth / headers() / DB.
// Without this flag Next.js evaluates the handler during static-page
// generation and throws Dynamic-server / DATABASE_URL errors.
export const dynamic = "force-dynamic";

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
