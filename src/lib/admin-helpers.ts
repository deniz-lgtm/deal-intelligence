import { v4 as uuidv4 } from "uuid";
import { auditLogQueries, settingsQueries, userQueries } from "./db";

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
