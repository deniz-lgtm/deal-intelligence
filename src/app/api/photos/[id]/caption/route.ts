import { NextResponse } from "next/server";
import { photoQueries, dealQueries } from "@/lib/db";
import type { Photo, Deal } from "@/lib/types";
import fs from "fs/promises";
import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-sonnet-4-5";

export async function POST(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const photo = (await photoQueries.getById(params.id)) as Photo | null;
    if (!photo) {
      return NextResponse.json({ error: "Photo not found" }, { status: 404 });
    }

    // Read the image file from disk
    let buffer: Buffer;
    try {
      buffer = await fs.readFile(photo.file_path);
    } catch {
      return NextResponse.json(
        { error: "Photo file not found on disk" },
        { status: 404 }
      );
    }

    const base64 = buffer.toString("base64");
    const mediaType = photo.mime_type as
      | "image/jpeg"
      | "image/png"
      | "image/gif"
      | "image/webp";

    // Fetch the deal for context
    const deal = (await dealQueries.getById(photo.deal_id)) as Deal | null;

    const contextParts: string[] = [];
    if (deal) {
      if (deal.property_type) contextParts.push(`Property type: ${deal.property_type}`);
      if (deal.address) contextParts.push(`Address: ${deal.address}, ${deal.city}, ${deal.state}`);
    }
    const contextString =
      contextParts.length > 0
        ? `\nContext about this property:\n${contextParts.join("\n")}\n`
        : "";

    const client = new Anthropic();

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 256,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType,
                data: base64,
              },
            },
            {
              type: "text",
              text: `Generate a short, professional caption for this commercial real estate property photo. The caption should describe what is shown (e.g. "Exterior - Main entrance with covered parking" or "Unit Interior - Renovated kitchen with granite counters"). Keep the caption under 10 words.${contextString}\nRespond with ONLY the caption text, nothing else.`,
            },
          ],
        },
      ],
    });

    const captionBlock = response.content.find((block) => block.type === "text");
    const caption = captionBlock && "text" in captionBlock ? captionBlock.text.trim() : "Untitled photo";

    // Save caption to the photo record
    const updatedPhoto = await photoQueries.update(photo.id, { caption });

    return NextResponse.json({ data: updatedPhoto });
  } catch (err) {
    console.error("Error generating photo caption:", err);
    return NextResponse.json(
      { error: "Failed to generate caption" },
      { status: 500 }
    );
  }
}
