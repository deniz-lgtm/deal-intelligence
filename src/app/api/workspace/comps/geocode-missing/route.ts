import { NextResponse } from "next/server";
import { compQueries, getPool } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { geocodeAddress, buildCompAddress } from "@/lib/geocode";

export const dynamic = "force-dynamic";

/**
 * POST /api/workspace/comps/geocode-missing
 *
 * Finds comps visible to the signed-in user that don't yet have lat/lng
 * and runs each through the Census.gov geocoder. Returns a summary of
 * how many were processed, geocoded successfully, and how many failed.
 *
 * Caps at 50 rows per call to avoid hammering Census and to keep the
 * request under typical serverless timeouts. Call repeatedly until
 * remaining_missing === 0 if you have a big backlog.
 */
const BATCH_CAP = 50;

export async function POST() {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  const pool = getPool();

  try {
    // Fetch missing-coord comps the user can see, capped at BATCH_CAP.
    const res = await pool.query(
      `SELECT c.id, c.address, c.city, c.state
       FROM comps c
       LEFT JOIN deals d_attached ON d_attached.id = c.deal_id
       LEFT JOIN deals d_source   ON d_source.id   = c.source_deal_id
       LEFT JOIN deal_shares s_attached ON s_attached.deal_id = d_attached.id AND s_attached.user_id = $1
       LEFT JOIN deal_shares s_source   ON s_source.deal_id   = d_source.id   AND s_source.user_id   = $1
       WHERE (c.lat IS NULL OR c.lng IS NULL)
         AND (
           c.deal_id IS NULL
           OR d_attached.owner_id IS NULL
           OR d_attached.owner_id = $1
           OR s_attached.deal_id IS NOT NULL
           OR d_source.owner_id IS NULL
           OR d_source.owner_id = $1
           OR s_source.deal_id IS NOT NULL
         )
       ORDER BY c.created_at DESC
       LIMIT $2`,
      [userId, BATCH_CAP + 1] // +1 so we can tell if there's more
    );

    const rows = res.rows.slice(0, BATCH_CAP);
    const more = res.rows.length > BATCH_CAP;

    let geocoded = 0;
    let failed = 0;
    let skipped = 0;

    // Sequential with a small politeness delay built into the geocoder caller
    for (const row of rows as Array<{
      id: string;
      address: string | null;
      city: string | null;
      state: string | null;
    }>) {
      const addr = buildCompAddress(row);
      if (!addr) {
        skipped++;
        continue;
      }
      const result = await geocodeAddress(addr);
      if (result) {
        await compQueries.update(row.id, {
          lat: result.lat,
          lng: result.lng,
        });
        geocoded++;
      } else {
        failed++;
      }
      // Census politeness
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return NextResponse.json({
      data: {
        processed: rows.length,
        geocoded,
        failed,
        skipped,
        more,
      },
    });
  } catch (error) {
    console.error("POST /api/workspace/comps/geocode-missing error:", error);
    return NextResponse.json(
      { error: "Failed to geocode comps" },
      { status: 500 }
    );
  }
}
