import { NextResponse } from "next/server";
import { requireAuth, syncCurrentUser } from "@/lib/auth";
import { pollDropboxInbox } from "@/lib/inbox";

export const dynamic = "force-dynamic";
// Inbox ingest can take a while on large folders (each file runs a Claude
// stage-1 extraction). Raise the max duration for serverless hosts that
// honor it.
export const maxDuration = 300;

/**
 * POST /api/inbox/poll
 *
 * Runs one polling pass over the configured Dropbox folder and ingests
 * any new files as draft deals in the sourcing stage. Idempotent — runs
 * are deduped by Dropbox path against deals.ingested_from_path.
 */
export async function POST() {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  await syncCurrentUser(userId);

  try {
    const result = await pollDropboxInbox();

    // Helper type guard — PollError has a `kind` string field
    if ("kind" in result) {
      const status =
        result.kind === "not_connected" || result.kind === "list_failed"
          ? 401
          : 400;
      return NextResponse.json({ error: result.message, kind: result.kind }, { status });
    }

    return NextResponse.json({ data: result });
  } catch (error) {
    console.error("POST /api/inbox/poll error:", error);
    return NextResponse.json(
      { error: "Failed to poll inbox" },
      { status: 500 }
    );
  }
}
