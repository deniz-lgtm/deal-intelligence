import { NextRequest, NextResponse } from "next/server";
import { dropboxQueries, dealQueries } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/inbox/settings
 *
 * Returns the Dropbox connection state + watched folder path + a count
 * of pending inbox items. Used by the /inbox page's settings panel and
 * the AppShell badge.
 */
export async function GET() {
  const { errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  try {
    const [account, pending] = await Promise.all([
      dropboxQueries.get(),
      dealQueries.countPendingInbox(),
    ]);

    return NextResponse.json({
      data: {
        connected: !!account,
        display_name: account?.display_name ?? null,
        email: account?.email ?? null,
        watched_folder_path: account?.watched_folder_path ?? null,
        last_polled_at: account?.last_polled_at ?? null,
        pending_count: pending,
      },
    });
  } catch (error) {
    console.error("GET /api/inbox/settings error:", error);
    return NextResponse.json(
      { error: "Failed to load inbox settings" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/inbox/settings
 * Body: { watched_folder_path: string | null }
 *
 * Sets the Dropbox folder path to poll. A null value stops the watcher.
 */
export async function PUT(req: NextRequest) {
  try {
    const { errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const body = await req.json();
    const raw = body.watched_folder_path;
    const folderPath: string | null =
      typeof raw === "string" && raw.trim() ? raw.trim() : null;

    const account = await dropboxQueries.get();
    if (!account) {
      return NextResponse.json(
        { error: "Connect Dropbox before configuring the inbox folder" },
        { status: 400 }
      );
    }

    await dropboxQueries.setWatchedFolder(folderPath);
    const updated = await dropboxQueries.get();
    return NextResponse.json({
      data: {
        connected: true,
        watched_folder_path: updated?.watched_folder_path ?? null,
        last_polled_at: updated?.last_polled_at ?? null,
      },
    });
  } catch (error) {
    console.error("PUT /api/inbox/settings error:", error);
    return NextResponse.json(
      { error: "Failed to save inbox settings" },
      { status: 500 }
    );
  }
}
