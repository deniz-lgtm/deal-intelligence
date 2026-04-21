import { NextRequest, NextResponse } from "next/server";
import { dealQueries, getUnderwritingForMassing } from "@/lib/db";
import { analyzeWhatIf } from "@/lib/claude";
import { requireAuth, requireDealAccess } from "@/lib/auth";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

/**
 * POST /api/deals/[id]/copilot/whatif
 * Body: { question: string, metrics?: Record<string, unknown> }
 *
 * Takes a free-text scenario question and returns a structured analysis
 * + proposed field patch + key impact comparison. No database writes —
 * the client applies the patch locally and the user saves as usual.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const body = await req.json();
    const question: string = body.question ?? "";
    const metrics: Record<string, unknown> | null = body.metrics ?? null;
    const massingId: string | undefined = body.massing_id;

    if (!question.trim()) {
      return NextResponse.json(
        { error: "question is required" },
        { status: 400 }
      );
    }

    const [deal, uwRow] = await Promise.all([
      dealQueries.getById(params.id),
      getUnderwritingForMassing(params.id, massingId),
    ]);

    if (!uwRow?.data) {
      return NextResponse.json(
        { error: "No underwriting data to analyze yet. Fill in the model first." },
        { status: 400 }
      );
    }

    const uw =
      typeof uwRow.data === "string" ? JSON.parse(uwRow.data) : uwRow.data;

    const result = await analyzeWhatIf(uw, question, { deal, metrics });
    if (!result) {
      return NextResponse.json(
        { error: "Couldn't analyze the scenario — try rephrasing." },
        { status: 422 }
      );
    }

    return NextResponse.json({ data: result });
  } catch (error) {
    console.error("POST /api/deals/[id]/copilot/whatif error:", error);
    return NextResponse.json(
      { error: "Failed to analyze scenario" },
      { status: 500 }
    );
  }
}
