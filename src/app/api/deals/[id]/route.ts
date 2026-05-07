import { NextRequest, NextResponse } from "next/server";
import { dealQueries, documentQueries, photoQueries } from "@/lib/db";
import { requireAuth, requireDealAccess, requireDealEditAccess, requirePermission } from "@/lib/auth";
import { geocodeAddress, buildCompAddress } from "@/lib/geocode";
import { deleteBlob } from "@/lib/blob-storage";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

// Allowlist of columns a user with deal edit access may write through
// PATCH /api/deals/[id]. Server-only fields (owner_id, timestamps,
// ingestion flags, AI-extracted JSONB blobs, per-feature settings set
// via dedicated routes) are excluded. Anything else returns 400.
//
// Internal API routes that legitimately write server-only columns call
// dealQueries.update() directly with their own controlled column list,
// so they bypass this allowlist.
const EDITABLE_DEAL_FIELDS = new Set<string>([
  // Identity / address
  "name", "address", "city", "state", "zip",
  // Classification + status
  "property_type", "status", "starred", "current_phase",
  "investment_strategy", "deal_scope", "business_plan_id",
  // Sizing / metrics
  "asking_price", "square_footage", "units", "bedrooms", "year_built", "land_acres",
  // Geocoded coords (auto-geocode block writes these too via internal call)
  "lat", "lng",
  // Notes
  "notes", "context_notes",
  // Per-deal phase visibility
  "show_in_development", "show_in_construction",
  // Execution flow (set by /project handoff)
  "execution_phase", "execution_started_at",
  // Document-execution flags
  "loi_executed", "psa_executed",
]);

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  try {
    const { deal, errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;
    return NextResponse.json({ data: deal });
  } catch (error) {
    console.error("GET /api/deals/[id] error:", error);
    return NextResponse.json({ error: "Failed to fetch deal" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  try {
    const { errorResponse: accessError } = await requireDealEditAccess(params.id, userId);
    if (accessError) return accessError;

    const body = await req.json();

    // Reject any keys that aren't on the allowlist. Without this, the
    // unscoped column-update SQL in dealQueries.update lets an editor
    // write to owner_id (deal hijack), timestamps, ingestion flags,
    // and the AI-extracted JSONB blobs.
    if (body && typeof body === "object" && !Array.isArray(body)) {
      const unknownKeys = Object.keys(body).filter((k) => !EDITABLE_DEAL_FIELDS.has(k));
      if (unknownKeys.length > 0) {
        return NextResponse.json(
          { error: `Unknown or non-editable field(s): ${unknownKeys.join(", ")}` },
          { status: 400 }
        );
      }
    } else {
      return NextResponse.json({ error: "Body must be a JSON object" }, { status: 400 });
    }

    // The per-deal Dev / Construction access flags drive home-triptych
    // visibility and must be booleans. `current_phase` is retained for
    // backward compatibility but accepts the legacy enum set.
    for (const key of ["show_in_development", "show_in_construction"] as const) {
      if (key in body && typeof body[key] !== "boolean") {
        return NextResponse.json(
          { error: `${key} must be a boolean` },
          { status: 400 }
        );
      }
    }
    if ("current_phase" in body) {
      const valid = [null, "acquisition", "development", "construction", "multi"];
      if (!valid.includes(body.current_phase)) {
        return NextResponse.json(
          { error: `Invalid current_phase: ${body.current_phase}` },
          { status: 400 }
        );
      }
    }

    const deal = await dealQueries.update(params.id, body);

    // Re-geocode if the address changed and coordinates weren't explicitly
    // set in the patch body. Non-fatal — ignore failures.
    const addressChanged = body.address != null || body.city != null || body.state != null;
    const coordsExplicitlySet = body.lat != null || body.lng != null;
    if (addressChanged && !coordsExplicitlySet) {
      try {
        const address = buildCompAddress({
          address: deal.address,
          city: deal.city,
          state: deal.state,
        });
        if (address) {
          const result = await geocodeAddress(address);
          if (result) {
            const updated = await dealQueries.update(params.id, { lat: result.lat, lng: result.lng });
            return NextResponse.json({ data: updated });
          }
        }
      } catch (err) {
        console.warn("Auto re-geocode failed for deal", params.id, err);
      }
    }

    return NextResponse.json({ data: deal });
  } catch (error) {
    console.error("PATCH /api/deals/[id] error:", error);
    const msg = error instanceof Error ? error.message : "Failed to update deal";
    return NextResponse.json({ error: `Failed to update deal: ${msg}` }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { userId, errorResponse } = await requirePermission("deals.delete");
  if (errorResponse) return errorResponse;

  try {
    // Only the owner can delete a deal
    const deal = await dealQueries.getByIdWithAccess(params.id, userId);
    if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    if (deal.owner_id !== userId) {
      return NextResponse.json({ error: "Only the deal owner can delete it" }, { status: 403 });
    }

    // Collect every blob tied to the deal BEFORE the DB cascade deletes
    // the rows that point to them. Without this step the Postgres ON
    // DELETE CASCADE cleans up the metadata but leaves every file
    // sitting in R2 forever — silently accumulating storage cost.
    // Failures here are non-fatal (best-effort cleanup); the deal is
    // still deleted so the user isn't blocked on storage hiccups.
    try {
      const [docs, pics] = await Promise.all([
        documentQueries.getByDealId(params.id).catch(() => []),
        photoQueries.getByDealId(params.id).catch(() => []),
      ]);
      const paths = [
        ...docs.map((d: any) => d.file_path).filter(Boolean),
        ...pics.map((p: any) => p.file_path).filter(Boolean),
      ];
      await Promise.allSettled(paths.map((p) => deleteBlob(p)));
    } catch (err) {
      console.warn("Blob cleanup failed for deal", params.id, err);
    }

    await dealQueries.delete(params.id);
    return NextResponse.json({ data: { success: true } });
  } catch (error) {
    console.error("DELETE /api/deals/[id] error:", error);
    return NextResponse.json({ error: "Failed to delete deal" }, { status: 500 });
  }
}
