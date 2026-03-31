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
    // Check if we already have this user to avoid the Clerk API call on hot paths
    const existing = await userQueries.getById(userId);
    if (existing) return;

    // First time we've seen this user — fetch from Clerk and persist
    const user = await currentUser();
    if (!user) return;

    const email = user.emailAddresses[0]?.emailAddress ?? "";
    const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || null;

    await userQueries.upsert({ id: userId, email, name: name ?? undefined });
  } catch (err) {
    // Non-fatal: log but don't block the request
    console.warn("syncCurrentUser failed:", (err as Error).message);
  }
}
