import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { dealShareQueries, userQueries } from "@/lib/db";
import { requireAuth, requireDealAccess, requirePermission } from "@/lib/auth";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

/**
 * GET /api/deals/:id/share
 * Returns all users this deal is shared with.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
  if (accessError) return accessError;

  try {
    const shares = await dealShareQueries.getByDealId(params.id);
    return NextResponse.json({ data: shares });
  } catch (error) {
    console.error("GET /api/deals/[id]/share error:", error);
    return NextResponse.json({ error: "Failed to fetch shares" }, { status: 500 });
  }
}

/**
 * POST /api/deals/:id/share
 * Share a deal with another user by email.
 * Body: { email: string, permission: "view" | "edit" }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { userId, errorResponse } = await requirePermission("deals.share");
  if (errorResponse) return errorResponse;

  const { deal, errorResponse: accessError } = await requireDealAccess(params.id, userId);
  if (accessError) return accessError;

  // Only the owner can share
  if (deal.owner_id !== userId) {
    return NextResponse.json({ error: "Only the deal owner can manage sharing" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { email, permission = "edit" } = body as { email: string; permission?: string };

    if (!email?.trim()) {
      return NextResponse.json({ error: "email is required" }, { status: 400 });
    }
    if (!["view", "edit"].includes(permission)) {
      return NextResponse.json({ error: "permission must be 'view' or 'edit'" }, { status: 400 });
    }

    // Look up the target user
    const targetUser = await userQueries.getByEmail(email.trim());
    if (!targetUser) {
      return NextResponse.json(
        { error: "No account found with that email. Ask them to sign in first." },
        { status: 404 }
      );
    }

    if (targetUser.id === userId) {
      return NextResponse.json({ error: "You cannot share a deal with yourself" }, { status: 400 });
    }

    const share = await dealShareQueries.create({
      id: uuidv4(),
      deal_id: params.id,
      user_id: targetUser.id,
      permission,
      shared_by: userId,
    });

    return NextResponse.json({ data: share }, { status: 201 });
  } catch (error) {
    console.error("POST /api/deals/[id]/share error:", error);
    return NextResponse.json({ error: "Failed to share deal" }, { status: 500 });
  }
}

/**
 * DELETE /api/deals/:id/share?userId=xxx
 * Remove a user's access to a deal.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  const { deal, errorResponse: accessError } = await requireDealAccess(params.id, userId);
  if (accessError) return accessError;

  const targetUserId = new URL(req.url).searchParams.get("userId");
  if (!targetUserId) {
    return NextResponse.json({ error: "userId query param is required" }, { status: 400 });
  }

  // Owner can remove anyone; users can remove themselves
  if (deal.owner_id !== userId && targetUserId !== userId) {
    return NextResponse.json({ error: "Only the deal owner can remove other users" }, { status: 403 });
  }

  try {
    await dealShareQueries.delete(params.id, targetUserId);
    return NextResponse.json({ data: { success: true } });
  } catch (error) {
    console.error("DELETE /api/deals/[id]/share error:", error);
    return NextResponse.json({ error: "Failed to remove share" }, { status: 500 });
  }
}
