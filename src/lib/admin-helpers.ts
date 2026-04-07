import { v4 as uuidv4 } from "uuid";
import { auditLogQueries, settingsQueries, userQueries } from "./db";

export interface SignupAllowlist {
  domains: string[];
  emails: string[];
}

export const SIGNUP_ALLOWLIST_KEY = "signup.allowlist";

/**
 * Returns the merged allowlist: env var ALLOWED_EMAIL_DOMAINS (comma-separated)
 * unioned with the admin-editable app_settings entry.
 */
export async function getSignupAllowlist(): Promise<SignupAllowlist> {
  const stored = await getSetting<SignupAllowlist>(SIGNUP_ALLOWLIST_KEY, {
    domains: [],
    emails: [],
  });
  const envDomains = (process.env.ALLOWED_EMAIL_DOMAINS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return {
    domains: Array.from(new Set([...envDomains, ...(stored.domains ?? []).map((d) => d.toLowerCase())])),
    emails: (stored.emails ?? []).map((e) => e.toLowerCase()),
  };
}

/**
 * Checks whether an email is allowed to sign up. Returns true when:
 * - the allowlist is empty (no restriction), OR
 * - the email's domain is in the allowed_domains list, OR
 * - the email itself is in the allowed_emails list, OR
 * - the email is in ADMIN_EMAILS (bootstrap admins always allowed)
 */
export async function isEmailAllowed(email: string): Promise<boolean> {
  if (!email) return false;
  const lower = email.toLowerCase();
  const adminList = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (adminList.includes(lower)) return true;

  const list = await getSignupAllowlist();
  if (list.domains.length === 0 && list.emails.length === 0) {
    return true; // no restriction configured
  }
  if (list.emails.includes(lower)) return true;
  const domain = lower.split("@")[1];
  if (domain && list.domains.includes(domain)) return true;
  return false;
}

/**
 * Fetch a setting with a typed default. Swallows DB errors and returns the
 * fallback so runtime config never blocks a feature entirely.
 */
export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  try {
    const value = await settingsQueries.get<T>(key);
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

export async function setSetting(
  key: string,
  value: unknown,
  updatedBy: string | null
): Promise<void> {
  await settingsQueries.set(key, value, updatedBy);
}

/**
 * Record an audit log entry. Best-effort: never throws so callers don't have
 * to wrap in try/catch.
 */
export async function recordAudit(entry: {
  userId: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    let email: string | null = null;
    if (entry.userId) {
      const u = await userQueries.getById(entry.userId);
      email = u?.email ?? null;
    }
    await auditLogQueries.record({
      id: uuidv4(),
      user_id: entry.userId,
      user_email: email,
      action: entry.action,
      target_type: entry.targetType ?? null,
      target_id: entry.targetId ?? null,
      metadata: entry.metadata ?? null,
    });
  } catch (err) {
    console.warn("recordAudit failed:", (err as Error).message);
  }
}
