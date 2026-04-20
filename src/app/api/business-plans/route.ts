import { NextRequest, NextResponse } from "next/server";
import { businessPlanQueries } from "@/lib/db";
import { requireAuth, requirePermission, syncCurrentUser } from "@/lib/auth";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

export async function GET() {
  const { userId, errorResponse } = await requirePermission("business_plans.access");
  if (errorResponse) return errorResponse;

  try {
    const plans = await businessPlanQueries.getAll(userId);
    return NextResponse.json({ data: plans });
  } catch (error) {
    console.error("GET /api/business-plans error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: `Failed to fetch business plans: ${message}` }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { userId, errorResponse } = await requirePermission("business_plans.access");
  if (errorResponse) return errorResponse;

  try {
    const body = await req.json();
    if (!body.name?.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    const plan = await businessPlanQueries.create({
      name: body.name.trim(),
      description: (body.description || "").trim(),
      is_default: body.is_default ?? false,
      owner_id: userId,
      investment_theses: body.investment_theses ?? [],
      target_markets: body.target_markets ?? [],
      property_types: body.property_types ?? [],
      hold_period_min: body.hold_period_min ?? null,
      hold_period_max: body.hold_period_max ?? null,
      target_irr_min: body.target_irr_min ?? null,
      target_irr_max: body.target_irr_max ?? null,
      target_equity_multiple_min: body.target_equity_multiple_min ?? null,
      target_equity_multiple_max: body.target_equity_multiple_max ?? null,
      branding_company_name: body.branding_company_name,
      branding_tagline: body.branding_tagline,
      branding_logo_url: body.branding_logo_url,
      branding_logo_width: body.branding_logo_width,
      branding_primary_color: body.branding_primary_color,
      branding_secondary_color: body.branding_secondary_color,
      branding_accent_color: body.branding_accent_color,
      branding_header_font: body.branding_header_font,
      branding_body_font: body.branding_body_font,
      branding_footer_text: body.branding_footer_text,
      branding_website: body.branding_website,
      branding_email: body.branding_email,
      branding_phone: body.branding_phone,
      branding_address: body.branding_address,
      branding_disclaimer_text: body.branding_disclaimer_text,
    });
    return NextResponse.json({ data: plan }, { status: 201 });
  } catch (error) {
    console.error("POST /api/business-plans error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: `Failed to create business plan: ${message}` }, { status: 500 });
  }
}
