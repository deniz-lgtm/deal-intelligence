import { NextRequest, NextResponse } from "next/server";
import { dropboxQueries } from "@/lib/db";
import { listFolder, refreshAccessToken, isSupportedFile } from "@/lib/dropbox";

// Opt out of static analysis at `next build`. Reads auth / headers() / DB.
// Without this flag Next.js evaluates the handler during static-page
// generation and throws Dynamic-server / DATABASE_URL errors.
export const dynamic = "force-dynamic";

async function getValidAccessToken(): Promise<string> {
  const account = await dropboxQueries.get();
  if (!account) throw new Error("Not connected");

  // Try current token; if it fails we'll refresh
  return account.access_token;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const folderPath = searchParams.get("path") ?? "/";

  try {
    const account = await dropboxQueries.get();
    if (!account) {
      return NextResponse.json({ error: "Not connected to Dropbox" }, { status: 401 });
    }

    let accessToken = account.access_token;

    let entries;
    try {
      entries = await listFolder(accessToken, folderPath);
    } catch {
      // Token may be expired — try refreshing
      if (account.refresh_token) {
        const refreshed = await refreshAccessToken(account.refresh_token);
        accessToken = refreshed.access_token;
        await dropboxQueries.updateToken(accessToken);
        entries = await listFolder(accessToken, folderPath);
      } else {
        throw new Error("Access token expired and no refresh token available. Please reconnect.");
      }
    }

    // Annotate files with whether they're importable
    const result = entries.map((e) => ({
      ...e,
      supported: e[".tag"] === "file" ? isSupportedFile(e.name) : true,
    }));

    // Folders first, then files
    result.sort((a, b) => {
      if (a[".tag"] !== b[".tag"]) return a[".tag"] === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return NextResponse.json({ data: result });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to browse Dropbox";
    console.error("GET /api/dropbox/browse error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
