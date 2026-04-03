import { put, del } from "@vercel/blob";

/**
 * Upload a file to Vercel Blob storage.
 * Returns the public URL of the uploaded blob.
 *
 * Falls back to local filesystem if BLOB_READ_WRITE_TOKEN is not configured,
 * enabling local development without Vercel Blob.
 */
export async function uploadBlob(
  pathname: string,
  buffer: Buffer,
  contentType: string
): Promise<string> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    // Fallback: save to local disk (dev mode)
    const path = await import("path");
    const fs = await import("fs/promises");
    const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");
    const filePath = path.join(UPLOAD_DIR, pathname);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, buffer);
    return `local://${filePath}`;
  }

  const blob = await put(pathname, buffer, {
    access: "public",
    contentType,
    addRandomSuffix: false,
  });

  return blob.url;
}

/**
 * Delete a blob by URL.
 * No-ops gracefully for local:// paths or missing tokens.
 */
export async function deleteBlob(url: string): Promise<void> {
  if (!url || url.startsWith("local://")) {
    // Local file — try to delete from disk
    if (url.startsWith("local://")) {
      const filePath = url.replace("local://", "");
      try {
        const fs = await import("fs/promises");
        await fs.unlink(filePath);
      } catch {}
    }
    return;
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) return;

  try {
    await del(url);
  } catch (err) {
    console.warn("Failed to delete blob:", err);
  }
}

/**
 * Check if a file_path is a blob URL (vs local path).
 */
export function isBlobUrl(filePath: string): boolean {
  return filePath.startsWith("http://") || filePath.startsWith("https://");
}

/**
 * Read a file — either fetch from blob URL or read from local disk.
 * Returns the buffer content.
 */
export async function readFile(filePath: string): Promise<Buffer | null> {
  if (isBlobUrl(filePath)) {
    try {
      const response = await fetch(filePath);
      if (!response.ok) return null;
      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch {
      return null;
    }
  }

  // Local file (dev or legacy)
  const actualPath = filePath.startsWith("local://")
    ? filePath.replace("local://", "")
    : filePath;

  try {
    const fs = await import("fs");
    const path = await import("path");
    const resolved = path.isAbsolute(actualPath)
      ? actualPath
      : path.join(process.cwd(), actualPath);
    if (!fs.existsSync(resolved)) return null;
    return fs.readFileSync(resolved);
  } catch {
    return null;
  }
}
