import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { entitlementTemplateQueries } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

/**
 * GET — list the current user's saved entitlement templates.
 * POST — create a new template. Body: { name, tasks[] }.
 *
 * Templates are plain authoring blueprints — { label, duration_days,
 * category?, owner? }. They're applied under any deal's entitlements
 * phase, not tied to a specific deal.
 */

export async function GET() {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    // Returns both the user's own templates and any shared by teammates
    // — each row carries an `is_owner` flag so the UI gates edit/delete.
    const rows = await entitlementTemplateQueries.getVisibleToUser(userId);
    return NextResponse.json({ data: rows });
  } catch (error) {
    console.error("GET /api/entitlement-templates error:", error);
    return NextResponse.json({ error: "Failed to fetch templates" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const body = await req.json();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const tasks = Array.isArray(body.tasks) ? body.tasks : [];
    const shared = body.shared === true;
    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    const row = await entitlementTemplateQueries.create(
      uuidv4(),
      userId,
      name,
      tasks,
      shared
    );
    return NextResponse.json({ data: row });
  } catch (error) {
    console.error("POST /api/entitlement-templates error:", error);
    return NextResponse.json({ error: "Failed to create template" }, { status: 500 });
  }
}
