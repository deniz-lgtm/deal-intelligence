import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { savedMapsQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

// GET: List all saved maps for a deal
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const rows = await savedMapsQueries.getByDealId(params.id);
    return NextResponse.json({ data: rows });
  } catch (error) {
    console.error("GET /api/deals/[id]/saved-maps error:", error);
    return NextResponse.json({ error: "Failed to fetch saved maps" }, { status: 500 });
  }
}

// POST: Save a new map configuration
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
    const { name, description, config, thumbnail_url } = body;

    if (!name || !config) {
      return NextResponse.json({ error: "name and config are required" }, { status: 400 });
    }

    const id = uuidv4();
    const row = await savedMapsQueries.create(
      id,
      params.id,
      name,
      description || null,
      config,
      thumbnail_url || null
    );

    return NextResponse.json({ data: row });
  } catch (error) {
    console.error("POST /api/deals/[id]/saved-maps error:", error);
    return NextResponse.json({ error: "Failed to save map" }, { status: 500 });
  }
}

// PUT: Update an existing saved map
export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const body = await req.json();
    const { map_id, name, description, config, thumbnail_url } = body;

    if (!map_id || !name || !config) {
      return NextResponse.json({ error: "map_id, name, and config are required" }, { status: 400 });
    }

    const row = await savedMapsQueries.update(
      map_id,
      name,
      description || null,
      config,
      thumbnail_url || null
    );

    return NextResponse.json({ data: row });
  } catch (error) {
    console.error("PUT /api/deals/[id]/saved-maps error:", error);
    return NextResponse.json({ error: "Failed to update saved map" }, { status: 500 });
  }
}

// DELETE: Remove a saved map
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const { searchParams } = new URL(req.url);
    const mapId = searchParams.get("map_id");
    if (!mapId) {
      return NextResponse.json({ error: "map_id query param required" }, { status: 400 });
    }

    await savedMapsQueries.delete(mapId);
    return NextResponse.json({ data: { deleted: true } });
  } catch (error) {
    console.error("DELETE /api/deals/[id]/saved-maps error:", error);
    return NextResponse.json({ error: "Failed to delete saved map" }, { status: 500 });
  }
}
