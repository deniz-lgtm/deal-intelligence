import { auth, currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { dealQueries, userQueries } from "./db";

/**
 * Asserts the request is authenticated and returns the userId.
 * Returns a 401 response if not authenticated.
 */
export async function requireAuth(): Promise<
  { userId: string; errorResponse: null } |
  { userId: null; errorResponse: NextResponse }
> {
  const { userId } = await auth();
  if (!userId) {
    return {
      userId: null,
      errorResponse: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  return { userId, errorResponse: null };
}

/**
 * Asserts the request is authenticated AND the user can access the given deal
 * (owner, shared with, or legacy deal with no owner).
 * Returns the deal record or a 401/404 response.
 */
export async function requireDealAccess(
  dealId: string,
  userId: string
): Promise<
  { deal: Record<string, unknown>; errorResponse: null } |
  { deal: null; errorResponse: NextResponse }
> {
  const deal = await dealQueries.getByIdWithAccess(dealId, userId);
  if (!deal) {
    return {
      deal: null,
      errorResponse: NextResponse.json({ error: "Deal not found" }, { status: 404 }),
    };
  }
  return { deal, errorResponse: null };
}

/**
 * Syncs the current Clerk user to our local users table.
 * Call this once per authenticated API request to keep user data fresh.
 * Safe to call on every request — uses ON CONFLICT DO UPDATE.
 */
export async function syncCurrentUser(userId: string): Promise<void> {
  try {
    const existing = await userQueries.getById(userId);
    if (existing) {
      // Promote bootstrap admins if email matches but role isn't yet admin
      if (existing.role !== "admin" && isBootstrapAdmin(existing.email)) {
        await userQueries.setRole(existing.id, "admin");
      }
      return;
    }

    // First time we've seen this user — fetch from Clerk and persist
    const user = await currentUser();
    if (!user) return;

    const email = user.emailAddresses[0]?.emailAddress ?? "";
    const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || null;

    await userQueries.upsert({ id: userId, email, name: name ?? undefined });
    if (isBootstrapAdmin(email)) {
      await userQueries.setRole(userId, "admin");
    }
  } catch (err) {
    console.warn("syncCurrentUser failed:", (err as Error).message);
  }
}

function isBootstrapAdmin(email: string): boolean {
  if (!email) return false;
  const list = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.toLowerCase());
}

/**
 * Asserts the request is authenticated AND the user has the given permission
 * (or is an admin, which bypasses all permission checks).
 */
export async function requirePermission(permission: string): Promise<
  { userId: string; errorResponse: null } |
  { userId: null; errorResponse: NextResponse }
> {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return { userId: null, errorResponse };
  await syncCurrentUser(userId);
  const user = await userQueries.getById(userId);
  if (!user) {
    return {
      userId: null,
      errorResponse: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }
  if (user.role === "admin" || (user.permissions ?? []).includes(permission)) {
    return { userId, errorResponse: null };
  }
  return {
    userId: null,
    errorResponse: NextResponse.json(
      { error: `Missing permission: ${permission}` },
      { status: 403 }
    ),
  };
}

/**
 * Returns the effective set of granted features for a user: admins get all,
 * regular users get whatever is in their permissions column.
 */
export async function getEffectivePermissions(userId: string): Promise<{
  role: "user" | "admin";
  permissions: string[];
}> {
  await syncCurrentUser(userId);
  const user = await userQueries.getById(userId);
  if (!user) return { role: "user", permissions: [] };
  return { role: user.role, permissions: user.permissions ?? [] };
}

/**
 * Asserts the request is authenticated AND the user has the admin role.
 * Returns { userId } or a 401/403 NextResponse.
 */
export async function requireAdmin(): Promise<
  { userId: string; errorResponse: null } |
  { userId: null; errorResponse: NextResponse }
> {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return { userId: null, errorResponse };
  await syncCurrentUser(userId);
  const user = await userQueries.getById(userId);
  if (!user || user.role !== "admin") {
    return {
      userId: null,
      errorResponse: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }
  return { userId, errorResponse: null };
}
