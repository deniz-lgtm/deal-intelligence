import { NextResponse } from "next/server";
import { requireAuth, getEffectivePermissions } from "@/lib/auth";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

export async function GET() {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const { role, permissions } = await getEffectivePermissions(userId);
  return NextResponse.json({ data: { id: userId, role, permissions } });
}
