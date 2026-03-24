// ─── Dropbox OAuth & API helpers ──────────────────────────────────────────────

export function getDropboxAppKey(): string {
  return process.env.DROPBOX_APP_KEY ?? "";
}

export function getDropboxAppSecret(): string {
  return process.env.DROPBOX_APP_SECRET ?? "";
}

function basicAuth(): string {
  return Buffer.from(`${getDropboxAppKey()}:${getDropboxAppSecret()}`).toString("base64");
}

/** Build the Dropbox OAuth2 authorization URL */
export function buildAuthUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: getDropboxAppKey(),
    response_type: "code",
    redirect_uri: redirectUri,
    token_access_type: "offline", // gets refresh_token
    state,
    // Explicitly request the scopes we need (must also be enabled in App Console → Permissions)
    scope: "files.metadata.read files.content.read account_info.read",
  });
  return `https://www.dropbox.com/oauth2/authorize?${params}`;
}

/** Exchange authorization code for access + refresh tokens */
export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string
): Promise<{ access_token: string; refresh_token: string; account_id: string }> {
  const res = await fetch("https://api.dropboxapi.com/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basicAuth()}`,
    },
    body: new URLSearchParams({
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }).toString(),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${await res.text()}`);
  return res.json();
}

/** Refresh an expired access token */
export async function refreshAccessToken(
  refreshToken: string
): Promise<{ access_token: string }> {
  const res = await fetch("https://api.dropboxapi.com/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basicAuth()}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }).toString(),
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${await res.text()}`);
  return res.json();
}

/** List files and folders in a Dropbox path */
export async function listFolder(
  accessToken: string,
  folderPath: string
): Promise<DropboxEntry[]> {
  // Dropbox root must be empty string, not "/"
  const path = folderPath === "/" ? "" : folderPath.replace(/\/$/, "");

  const res = await fetch("https://api.dropboxapi.com/2/files/list_folder", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ path, recursive: false }),
  });

  if (!res.ok) throw new Error(`List folder failed: ${await res.text()}`);
  const data = await res.json();
  return data.entries as DropboxEntry[];
}

/** Download a file from Dropbox as a Buffer */
export async function downloadFile(
  accessToken: string,
  filePath: string
): Promise<{ buffer: Buffer; metadata: { name: string; size: number } }> {
  const res = await fetch("https://content.dropboxapi.com/2/files/download", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Dropbox-API-Arg": JSON.stringify({ path: filePath }),
    },
  });

  if (!res.ok) throw new Error(`Download failed: ${res.statusText}`);

  const metaHeader = res.headers.get("dropbox-api-result");
  const meta = metaHeader ? JSON.parse(metaHeader) : { name: filePath.split("/").pop(), size: 0 };

  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, metadata: { name: meta.name, size: meta.size } };
}

export interface DropboxEntry {
  ".tag": "file" | "folder";
  name: string;
  path_display: string;
  path_lower: string;
  size?: number;
  client_modified?: string;
  id: string;
}

// Supported file types that the upload pipeline can handle
const SUPPORTED_EXTENSIONS = new Set([
  ".pdf", ".doc", ".docx", ".xls", ".xlsx",
  ".txt", ".csv", ".png", ".jpg", ".jpeg", ".webp",
]);

export function isSupportedFile(name: string): boolean {
  const ext = name.toLowerCase().slice(name.lastIndexOf("."));
  return SUPPORTED_EXTENSIONS.has(ext);
}

export function guessMimeType(name: string): string {
  const ext = name.toLowerCase().slice(name.lastIndexOf("."));
  const map: Record<string, string> = {
    ".pdf": "application/pdf",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".txt": "text/plain",
    ".csv": "text/csv",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
  };
  return map[ext] ?? "application/octet-stream";
}
