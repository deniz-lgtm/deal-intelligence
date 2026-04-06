import { NextResponse } from "next/server";
import { requireAuth, getEffectivePermissions } from "@/lib/auth";

export async function GET() {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const { role, permissions } = await getEffectivePermissions(userId);
  return NextResponse.json({ data: { id: userId, role, permissions } });
}
