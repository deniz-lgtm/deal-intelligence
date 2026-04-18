import { NextRequest, NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { requireAdmin } from "@/lib/auth";
import { recordAudit } from "@/lib/admin-helpers";

// Opt out of static analysis at `next build`. Reads auth / headers() / DB.
// Without this flag Next.js evaluates the handler during static-page
// generation and throws Dynamic-server / DATABASE_URL errors.
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/invitations
 * List pending and recently accepted Clerk invitations.
 */
export async function GET() {
  const { errorResponse } = await requireAdmin();
  if (errorResponse) return errorResponse;

  try {
    const client = await clerkClient();
    const list = await client.invitations.getInvitationList({ limit: 100 });
    // @clerk/nextjs v7 returns { data, totalCount } on paginated endpoints
    const items = Array.isArray(list) ? list : (list as { data: unknown[] }).data ?? [];
    return NextResponse.json({ data: items });
  } catch (error) {
    console.error("GET /api/admin/invitations error:", error);
    return NextResponse.json(
      { error: (error as Error).message || "Failed to list invitations" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/invitations
 * Body: { email: string, role?: "user"|"admin" }
 * Creates a Clerk invitation. Role is stored as public metadata on the
 * invitation and applied when the user accepts + first syncs.
 */
export async function POST(req: NextRequest) {
  const { userId: adminId, errorResponse } = await requireAdmin();
  if (errorResponse) return errorResponse;

  let body: { email?: string; role?: "user" | "admin" };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = body.email?.trim();
  if (!email) {
    return NextResponse.json({ error: "email is required" }, { status: 400 });
  }

  try {
    const client = await clerkClient();
    const invitation = await client.invitations.createInvitation({
      emailAddress: email,
      publicMetadata: body.role ? { role: body.role } : undefined,
      ignoreExisting: false,
    });
    await recordAudit({
      userId: adminId,
      action: "user.invited",
      targetType: "invitation",
      targetId: invitation.id,
      metadata: { email, role: body.role ?? "user" },
    });
    return NextResponse.json({ data: invitation }, { status: 201 });
  } catch (error) {
    console.error("POST /api/admin/invitations error:", error);
    return NextResponse.json(
      { error: (error as Error).message || "Failed to create invitation" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/invitations?id=<invitationId>
 * Revoke a pending invitation.
 */
export async function DELETE(req: NextRequest) {
  const { userId: adminId, errorResponse } = await requireAdmin();
  if (errorResponse) return errorResponse;

  const invitationId = new URL(req.url).searchParams.get("id");
  if (!invitationId) {
    return NextResponse.json({ error: "id query param is required" }, { status: 400 });
  }

  try {
    const client = await clerkClient();
    await client.invitations.revokeInvitation(invitationId);
    await recordAudit({
      userId: adminId,
      action: "invitation.revoked",
      targetType: "invitation",
      targetId: invitationId,
    });
    return NextResponse.json({ data: { success: true } });
  } catch (error) {
    console.error("DELETE /api/admin/invitations error:", error);
    return NextResponse.json(
      { error: (error as Error).message || "Failed to revoke invitation" },
      { status: 500 }
    );
  }
}
