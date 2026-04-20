import { NextResponse } from "next/server";
import { loiQueries, dealQueries, dealNoteQueries } from "@/lib/db";
import { v4 as uuidv4 } from "uuid";
import { requireAuth, requireDealAccess, syncCurrentUser } from "@/lib/auth";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

function fc(v: unknown): string {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? `$${Math.round(n).toLocaleString()}` : "—";
}

function summarizeLoiTerms(data: Record<string, unknown> | null | undefined): string {
  if (!data) return "";
  const parts: string[] = [];
  if (data.purchase_price) parts.push(`Purchase ${fc(data.purchase_price)}`);
  if (data.earnest_money) {
    const hardDays = data.earnest_money_hard_days;
    parts.push(
      `Earnest ${fc(data.earnest_money)}${hardDays ? ` (hard after ${hardDays}d)` : ""}`
    );
  }
  if (data.due_diligence_days) parts.push(`DD ${data.due_diligence_days}d`);
  if (data.closing_days) parts.push(`Close ${data.closing_days}d`);
  return parts.join(" · ");
}

export async function GET(req: Request) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  await syncCurrentUser(userId);

  try {
    const { searchParams } = new URL(req.url);
    const dealId = searchParams.get("deal_id");
    if (!dealId) {
      return NextResponse.json({ error: "deal_id is required" }, { status: 400 });
    }

    const { errorResponse: accessError } = await requireDealAccess(dealId, userId);
    if (accessError) return accessError;

    const loi = await loiQueries.getByDealId(dealId);
    return NextResponse.json({ data: loi || null });
  } catch (err) {
    console.error("Error fetching LOI:", err);
    return NextResponse.json({ error: "Failed to fetch LOI" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  await syncCurrentUser(userId);

  try {
    const body = await req.json();
    const { deal_id, data, executed } = body;
    if (!deal_id) {
      return NextResponse.json({ error: "deal_id is required" }, { status: 400 });
    }

    const { errorResponse: accessError } = await requireDealAccess(deal_id, userId);
    if (accessError) return accessError;

    const existing = (await loiQueries.getByDealId(deal_id)) as { id: string } | undefined;
    const id = existing?.id || uuidv4();
    const result = await loiQueries.upsert(deal_id, id, JSON.stringify(data), !!executed);

    // If marking as executed, update deal flag and post a note so Chat,
    // Investment Package, and other downstream features can see the
    // executed terms.
    if (executed) {
      await dealQueries.update(deal_id, { loi_executed: true });

      const summary = summarizeLoiTerms(data);
      if (summary) {
        try {
          await dealNoteQueries.create({
            id: uuidv4(),
            deal_id,
            text: `[LOI Executed ${new Date().toLocaleDateString()}] ${summary}`,
            category: "context",
            source: "loi",
          });
        } catch (noteErr) {
          console.error("Failed to log LOI execution note:", noteErr);
        }
      }
    }

    return NextResponse.json({ data: result });
  } catch (err) {
    console.error("Error saving LOI:", err);
    return NextResponse.json({ error: "Failed to save LOI" }, { status: 500 });
  }
}
