import { NextRequest, NextResponse } from "next/server";
import { dealQueries, documentQueries, checklistQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { analyzeZoning } from "@/lib/claude";

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  try {
    const { deal, errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    if (!deal.address && !deal.city) {
      return NextResponse.json(
        { error: "Deal must have an address to generate a zoning report" },
        { status: 400 }
      );
    }

    // Get zoning-related documents
    const allDocs = await documentQueries.getByDealId(params.id);
    const zoningDocs = allDocs.filter(
      (d: any) => d.category === "zoning_entitlements" || d.category === "legal"
    );

    const result = await analyzeZoning(
      deal.name,
      deal.address || "",
      deal.city || "",
      deal.state || "",
      deal.property_type || "other",
      deal.investment_strategy || null,
      zoningDocs.map((d: any) => ({
        name: d.original_name || d.name,
        content_text: d.content_text,
        ai_summary: d.ai_summary,
      }))
    );

    // Auto-fill relevant checklist items that already exist
    const existingItems = await checklistQueries.getByDealId(params.id);
    const zoningCategory = "Zoning & Entitlements";
    const zoningUpdates: Record<string, { status: string; notes: string }> = {
      "Current zoning confirmed": {
        status: result.structured.zoning_designation !== "Unknown" ? "complete" : "pending",
        notes: `Zoning: ${result.structured.zoning_designation}`,
      },
      "Permitted uses verified": {
        status: result.structured.permitted_uses.length > 0 ? "complete" : "pending",
        notes: result.structured.permitted_uses.length > 0
          ? `Permitted: ${result.structured.permitted_uses.slice(0, 5).join(", ")}`
          : "No permitted uses identified",
      },
      "Development rights / FAR reviewed": {
        status: result.structured.far != null ? "complete" : "pending",
        notes: result.structured.far != null
          ? `FAR: ${result.structured.far}, Height: ${result.structured.max_height_stories ?? "N/A"} stories`
          : "FAR not determined",
      },
      "Future zoning / overlay district reviewed": {
        status: result.structured.overlays.length > 0 ? "complete" : "pending",
        notes: result.structured.overlays.length > 0
          ? `Overlays: ${result.structured.overlays.join(", ")}`
          : "No overlay districts identified",
      },
      "Parking requirements verified": {
        status: result.structured.parking_requirements !== "Unknown" ? "complete" : "pending",
        notes: result.structured.parking_requirements || "Unknown",
      },
    };

    for (const existing of existingItems) {
      if (existing.category === zoningCategory && zoningUpdates[existing.item]) {
        const update = zoningUpdates[existing.item];
        await checklistQueries.updateStatus(existing.id, update.status, update.notes);
      }
    }

    return NextResponse.json({ data: result });
  } catch (error) {
    console.error("POST /api/deals/[id]/zoning-report error:", error);
    return NextResponse.json(
      { error: "Failed to generate zoning report" },
      { status: 500 }
    );
  }
}
