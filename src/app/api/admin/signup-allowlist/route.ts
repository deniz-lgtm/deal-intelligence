import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import {
  getSignupAllowlist,
  setSetting,
  recordAudit,
  SIGNUP_ALLOWLIST_KEY,
  type SignupAllowlist,
} from "@/lib/admin-helpers";

// Opt out of static analysis at `next build`. Reads auth / headers() / DB.
// Without this flag Next.js evaluates the handler during static-page
// generation and throws Dynamic-server / DATABASE_URL errors.
export const dynamic = "force-dynamic";

export async function GET() {
  const { errorResponse } = await requireAdmin();
  if (errorResponse) return errorResponse;
  const list = await getSignupAllowlist();
  return NextResponse.json({
    data: {
      ...list,
      env_domains_set: !!process.env.ALLOWED_EMAIL_DOMAINS,
    },
  });
}

export async function PUT(req: NextRequest) {
  const { userId: adminId, errorResponse } = await requireAdmin();
  if (errorResponse) return errorResponse;

  let body: { domains?: string[]; emails?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const clean = (arr: unknown): string[] =>
    Array.isArray(arr)
      ? arr
          .filter((v): v is string => typeof v === "string")
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean)
      : [];

  const next: SignupAllowlist = {
    domains: clean(body.domains),
    emails: clean(body.emails),
  };

  await setSetting(SIGNUP_ALLOWLIST_KEY, next, adminId);
  await recordAudit({
    userId: adminId,
    action: "signup.allowlist_updated",
    metadata: { domains: next.domains.length, emails: next.emails.length },
  });

  return NextResponse.json({ data: await getSignupAllowlist() });
}
