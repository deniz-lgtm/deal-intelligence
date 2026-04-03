import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";

/**
 * Cloudflare R2 storage via S3-compatible API.
 *
 * Required env vars for production:
 *   R2_ACCOUNT_ID        — Cloudflare account ID
 *   R2_ACCESS_KEY_ID     — R2 API token access key
 *   R2_SECRET_ACCESS_KEY — R2 API token secret key
 *   R2_BUCKET_NAME       — R2 bucket name
 *   R2_PUBLIC_URL        — Public URL prefix (e.g., https://files.yourdomain.com)
 *
 * Falls back to local filesystem when R2_ACCOUNT_ID is not set (local dev).
 */

let _client: S3Client | null = null;

function getR2Client(): S3Client {
  if (_client) return _client;
  _client = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
  return _client;
}

function getBucket(): string {
  return process.env.R2_BUCKET_NAME || "deal-intelligence";
}

function isR2Configured(): boolean {
  return !!(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY);
}

/**
 * Upload a file to R2.
 * Returns the public URL of the uploaded object.
 */
export async function uploadBlob(
  pathname: string,
  buffer: Buffer,
  contentType: string
): Promise<string> {
  if (!isR2Configured()) {
    // Fallback: save to local disk (dev mode)
    const path = await import("path");
    const fs = await import("fs/promises");
    const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");
    const filePath = path.join(UPLOAD_DIR, pathname);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, buffer);
    return `local://${filePath}`;
  }

  const client = getR2Client();
  await client.send(new PutObjectCommand({
    Bucket: getBucket(),
    Key: pathname,
    Body: buffer,
    ContentType: contentType,
  }));

  // Return public URL
  const publicBase = process.env.R2_PUBLIC_URL || `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${getBucket()}`;
  return `${publicBase}/${pathname}`;
}

/**
 * Delete an object by URL or key.
 * No-ops gracefully for local:// paths or missing config.
 */
export async function deleteBlob(url: string): Promise<void> {
  if (!url || url.startsWith("local://")) {
    if (url?.startsWith("local://")) {
      const filePath = url.replace("local://", "");
      try {
        const fs = await import("fs/promises");
        await fs.unlink(filePath);
      } catch {}
    }
    return;
  }

  if (!isR2Configured()) return;

  try {
    // Extract key from URL
    const publicBase = process.env.R2_PUBLIC_URL || `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${getBucket()}`;
    const key = url.startsWith(publicBase) ? url.slice(publicBase.length + 1) : url;

    const client = getR2Client();
    await client.send(new DeleteObjectCommand({
      Bucket: getBucket(),
      Key: key,
    }));
  } catch (err) {
    console.warn("Failed to delete from R2:", err);
  }
}

/**
 * Check if a file_path is a remote URL (vs local path).
 */
export function isBlobUrl(filePath: string): boolean {
  return filePath.startsWith("http://") || filePath.startsWith("https://");
}

/**
 * Read a file — either fetch from R2 URL or read from local disk.
 * Returns the buffer content.
 */
export async function readFile(filePath: string): Promise<Buffer | null> {
  if (isBlobUrl(filePath)) {
    // Try public URL fetch first (fastest)
    try {
      const response = await fetch(filePath);
      if (response.ok) {
        const arrayBuffer = await response.arrayBuffer();
        return Buffer.from(arrayBuffer);
      }
    } catch {}

    // Fallback: use S3 GetObject if public fetch fails
    if (isR2Configured()) {
      try {
        const publicBase = process.env.R2_PUBLIC_URL || `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${getBucket()}`;
        const key = filePath.startsWith(publicBase) ? filePath.slice(publicBase.length + 1) : filePath;

        const client = getR2Client();
        const result = await client.send(new GetObjectCommand({
          Bucket: getBucket(),
          Key: key,
        }));
        if (result.Body) {
          const bytes = await result.Body.transformToByteArray();
          return Buffer.from(bytes);
        }
      } catch {}
    }

    return null;
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
