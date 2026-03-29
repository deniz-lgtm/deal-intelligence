import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { dealNoteQueries, dealQueries } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const deal = await dealQueries.getById(params.id);
    if (!deal) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }
    const notes = await dealNoteQueries.getByDealId(params.id);
    return NextResponse.json({ data: notes });
  } catch (error) {
    console.error("GET /api/deals/[id]/notes error:", error);
    return NextResponse.json({ error: "Failed to fetch notes" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json();
    const { text, category, source } = body;

    if (!text?.trim()) {
      return NextResponse.json({ error: "text is required" }, { status: 400 });
    }

    const note = await dealNoteQueries.create({
      id: uuidv4(),
      deal_id: params.id,
      text: text.trim(),
      category: category || "context",
      source: source || "manual",
    });

    return NextResponse.json({ data: note });
  } catch (error) {
    console.error("POST /api/deals/[id]/notes error:", error);
    return NextResponse.json({ error: "Failed to create note" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
) {
  try {
    const { searchParams } = new URL(req.url);
    const noteId = searchParams.get("noteId");

    if (!noteId) {
      return NextResponse.json({ error: "noteId is required" }, { status: 400 });
    }

    const note = await dealNoteQueries.delete(noteId);
    return NextResponse.json({ data: note });
  } catch (error) {
    console.error("DELETE /api/deals/[id]/notes error:", error);
    return NextResponse.json({ error: "Failed to delete note" }, { status: 500 });
  }
}
