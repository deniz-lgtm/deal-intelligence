import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { userQueries } from "@/lib/db";

// Opt out of static analysis at `next build`. Reads auth / headers() / DB.
// Without this flag Next.js evaluates the handler during static-page
// generation and throws Dynamic-server / DATABASE_URL errors.
export const dynamic = "force-dynamic";

/**
 * GET /api/whoami
 * Diagnostic endpoint — returns enough info to debug admin bootstrap problems
 * without exposing secrets. Visit while signed in.
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ signedIn: false }, { status: 401 });
  }

  const clerkUser = await currentUser();
  const dbUser = await userQueries.getById(userId);
  const adminEmailsRaw = process.env.ADMIN_EMAILS ?? "";
  const adminEmailsList = adminEmailsRaw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  return NextResponse.json({
    signedIn: true,
    clerk: {
      userId,
      emails: clerkUser?.emailAddresses.map((e) => e.emailAddress) ?? [],
      primaryEmail: clerkUser?.primaryEmailAddress?.emailAddress ?? null,
    },
    db: {
      exists: !!dbUser,
      id: dbUser?.id ?? null,
      email: dbUser?.email ?? null,
      role: dbUser?.role ?? null,
      permissions: dbUser?.permissions ?? null,
      disabled_at: dbUser?.disabled_at ?? null,
    },
    bootstrap: {
      ADMIN_EMAILS_set: adminEmailsRaw.length > 0,
      ADMIN_EMAILS_count: adminEmailsList.length,
      // Mask middle of each email so it's safe to share
      ADMIN_EMAILS_preview: adminEmailsList.map((e) => {
        const [name, domain] = e.split("@");
        if (!domain || name.length <= 2) return `***@${domain ?? ""}`;
        return `${name[0]}***${name[name.length - 1]}@${domain}`;
      }),
      matchesAnyClerkEmail: (clerkUser?.emailAddresses ?? []).some((e) =>
        adminEmailsList.includes(e.emailAddress.toLowerCase())
      ),
    },
  });
}
