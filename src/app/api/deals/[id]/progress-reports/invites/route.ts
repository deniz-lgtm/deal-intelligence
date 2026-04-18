import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { progressReportInviteQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { generateInviteToken, hashInviteToken } from "@/lib/deal-room";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const invites = await progressReportInviteQueries.getByDealId(params.id);
    return NextResponse.json({ data: invites });
  } catch (error) {
    console.error("GET /api/deals/[id]/progress-reports/invites error:", error);
    return NextResponse.json({ error: "Failed to fetch invites" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const body = await req.json();
    const email: string = body.email?.trim();
    if (!email) {
      return NextResponse.json({ error: "email is required" }, { status: 400 });
    }

    const token = generateInviteToken();
    const token_hash = hashInviteToken(token);

    const invite = await progressReportInviteQueries.create({
      id: uuidv4(),
      deal_id: params.id,
      email,
      name: body.name?.trim() || null,
      token_hash,
      expires_at: body.expires_at ?? null,
    });

    return NextResponse.json({ data: { ...invite, token } });
  } catch (error) {
    console.error("POST /api/deals/[id]/progress-reports/invites error:", error);
    return NextResponse.json({ error: "Failed to create invite" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const body = await req.json();
    if (!body.inviteId) {
      return NextResponse.json({ error: "inviteId is required" }, { status: 400 });
    }

    await progressReportInviteQueries.revoke(body.inviteId);
    return NextResponse.json({ data: { revoked: true } });
  } catch (error) {
    console.error("DELETE /api/deals/[id]/progress-reports/invites error:", error);
    return NextResponse.json({ error: "Failed to revoke invite" }, { status: 500 });
  }
}
