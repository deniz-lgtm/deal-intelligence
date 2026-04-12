import { NextResponse } from "next/server";
import { hashInviteToken } from "@/lib/deal-room";
import {
  progressReportInviteQueries,
  progressReportQueries,
} from "@/lib/db";

// ── GET — return invite info + draft/submitted reports ───────────────────

export async function GET(
  _req: Request,
  { params }: { params: { token: string } }
) {
  try {
    const hash = hashInviteToken(params.token);
    const invite = await progressReportInviteQueries.findByTokenHash(hash);

    if (!invite) {
      return NextResponse.json(
        { error: "This link is invalid or has expired." },
        { status: 404 }
      );
    }

    const allReports = await progressReportQueries.getByDealId(invite.deal_id);
    const reports = allReports.filter(
      (r: Record<string, unknown>) =>
        r.status === "draft" || r.status === "submitted"
    );

    return NextResponse.json({
      invite: {
        email: invite.email,
        name: invite.name,
        deal_name: invite.deal_name,
        deal_address: invite.deal_address,
        deal_city: invite.deal_city,
        deal_state: invite.deal_state,
      },
      reports,
    });
  } catch (err) {
    console.error("Error in GET /api/report-submit/[token]:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ── POST — submit / update a progress report ────────────────────────────

export async function POST(
  req: Request,
  { params }: { params: { token: string } }
) {
  try {
    const hash = hashInviteToken(params.token);
    const invite = await progressReportInviteQueries.findByTokenHash(hash);

    if (!invite) {
      return NextResponse.json(
        { error: "This link is invalid or has expired." },
        { status: 404 }
      );
    }

    const body = await req.json();
    const {
      report_id,
      summary,
      work_completed,
      work_planned,
      issues,
      weather_delays,
      pct_complete,
    } = body;

    if (!report_id) {
      return NextResponse.json(
        { error: "report_id required" },
        { status: 400 }
      );
    }

    const updated = await progressReportQueries.update(report_id, {
      summary,
      work_completed,
      work_planned,
      issues,
      weather_delays,
      pct_complete,
      status: "submitted",
      submitted_by_email: invite.email,
      submitted_at: new Date().toISOString(),
    });

    if (!updated) {
      return NextResponse.json(
        { error: "Report not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ data: updated });
  } catch (err) {
    console.error("Error in POST /api/report-submit/[token]:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
