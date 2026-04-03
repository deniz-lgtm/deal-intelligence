import { NextResponse } from "next/server";
import { photoQueries } from "@/lib/db";
import { v4 as uuidv4 } from "uuid";
import { uploadBlob } from "@/lib/blob-storage";

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const dealId = formData.get("deal_id") as string;
    const caption = formData.get("caption") as string | null;

    if (!dealId) {
      return NextResponse.json({ error: "deal_id is required" }, { status: 400 });
    }

    const files = formData.getAll("files") as File[];
    if (files.length === 0) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }

    const saved = [];
    for (const file of files) {
      if (!file.type.startsWith("image/")) {
        continue;
      }

      const id = uuidv4();
      const ext = file.name.split(".").pop() || "jpg";
      const safeName = `${id}.${ext}`;
      const blobPath = `${dealId}/photos/${safeName}`;

      const buffer = Buffer.from(await file.arrayBuffer());
      const fileUrl = await uploadBlob(blobPath, buffer, file.type);

      const photo = await photoQueries.create({
        id,
        deal_id: dealId,
        name: safeName,
        original_name: file.name,
        file_path: fileUrl,
        file_size: buffer.length,
        mime_type: file.type,
        caption: caption || null,
      });

      saved.push(photo);
    }

    return NextResponse.json({ data: saved });
  } catch (err) {
    console.error("Error uploading photos:", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
