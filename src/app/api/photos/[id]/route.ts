import { NextResponse } from "next/server";
import { photoQueries } from "@/lib/db";
import { isBlobUrl, readFile, deleteBlob } from "@/lib/blob-storage";
import type { Photo } from "@/lib/types";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const photo = (await photoQueries.getById(params.id)) as Photo | undefined;
    if (!photo) {
      return NextResponse.json({ error: "Photo not found" }, { status: 404 });
    }

    // If file_path is a blob URL, redirect to it
    if (isBlobUrl(photo.file_path)) {
      return NextResponse.redirect(photo.file_path);
    }

    // Local file fallback
    const buffer = await readFile(photo.file_path);
    if (!buffer) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": photo.mime_type,
        "Content-Disposition": `inline; filename="${encodeURIComponent(photo.original_name)}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (err) {
    console.error("Error serving photo:", err);
    return NextResponse.json({ error: "Failed to serve photo" }, { status: 500 });
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json();
    await photoQueries.update(params.id, { caption: body.caption });
    return NextResponse.json({ data: await photoQueries.getById(params.id) });
  } catch (err) {
    console.error("Error updating photo:", err);
    return NextResponse.json({ error: "Failed to update photo" }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const photo = (await photoQueries.delete(params.id)) as { file_path: string } | undefined;
    if (photo?.file_path) {
      await deleteBlob(photo.file_path);
    }
    return NextResponse.json({ data: { deleted: true } });
  } catch (err) {
    console.error("Error deleting photo:", err);
    return NextResponse.json({ error: "Failed to delete photo" }, { status: 500 });
  }
}
