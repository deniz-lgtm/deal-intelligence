import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { hashInviteToken } from "@/lib/deal-room";
import { progressReportInviteQueries, progressReportPhotoQueries } from "@/lib/db";
import { uploadBlob } from "@/lib/blob-storage";

// ── POST — upload photos for a progress report ──────────────────────────

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

    const formData = await req.formData();
    const reportId = formData.get("report_id") as string;
    const category = (formData.get("category") as string) || null;
    const files = formData.getAll("files");

    if (!reportId) {
      return NextResponse.json(
        { error: "report_id is required" },
        { status: 400 }
      );
    }

    const created: Record<string, unknown>[] = [];

    for (const file of files) {
      if (!(file instanceof File)) continue;
      if (!file.type.startsWith("image/")) continue;

      const uuid = uuidv4();
      const ext = file.name.split(".").pop() || "jpg";
      const pathname = `${invite.deal_id}/progress-reports/${reportId}/photos/${uuid}.${ext}`;
      const buffer = Buffer.from(await file.arrayBuffer());
      const url = await uploadBlob(pathname, buffer, file.type);

      const photo = await progressReportPhotoQueries.create({
        id: uuid,
        report_id: reportId,
        deal_id: invite.deal_id,
        name: file.name,
        original_name: file.name,
        file_path: url,
        file_size: file.size,
        mime_type: file.type,
        caption: null,
        category,
      });

      created.push(photo);
    }

    return NextResponse.json({ data: created });
  } catch (err) {
    console.error("Error in POST /api/report-submit/[token]/photos:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
