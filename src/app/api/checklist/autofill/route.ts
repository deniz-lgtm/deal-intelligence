import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { checklistQueries, documentQueries, dealQueries, dealNoteQueries } from "@/lib/db";
import { autoFillChecklist } from "@/lib/claude";
import { DILIGENCE_CHECKLIST_TEMPLATE } from "@/lib/types";
import type { Document } from "@/lib/types";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { deal_id } = body;

    if (!deal_id) {
      return NextResponse.json({ error: "deal_id is required" }, { status: 400 });
    }

    const deal = await dealQueries.getById(deal_id) as { name: string; context_notes?: string | null } | null;
    if (!deal) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }

    const documents = await documentQueries.getByDealId(deal_id) as Document[];
    if (documents.length === 0) {
      return NextResponse.json({ error: "No documents uploaded yet" }, { status: 400 });
    }

    // Get existing checklist items
    let existingItems = await checklistQueries.getByDealId(deal_id) as Array<{
      id: string;
      category: string;
      item: string;
      source_document_ids: string | null;
    }>;

    // If no items yet, seed from template
    if (existingItems.length === 0) {
      const templateItems = DILIGENCE_CHECKLIST_TEMPLATE.flatMap((section) =>
        section.items.map((item) => ({
          id: uuidv4(),
          deal_id,
          category: section.category,
          item,
          status: "pending",
          notes: null,
          ai_filled: false,
          source_document_ids: null,
        }))
      );
      await checklistQueries.bulkUpsert(templateItems);
      existingItems = await checklistQueries.getByDealId(deal_id) as Array<{
        id: string;
        category: string;
        item: string;
        source_document_ids: string | null;
      }>;
    }

    // Collect document IDs already used in previous autofill runs
    const alreadyProcessedIds = new Set<string>();
    for (const item of existingItems) {
      if (item.source_document_ids) {
        try {
          const ids: string[] = typeof item.source_document_ids === "string"
            ? JSON.parse(item.source_document_ids)
            : item.source_document_ids;
          ids.forEach((id) => alreadyProcessedIds.add(id));
        } catch {}
      }
    }

    // Only send new (not yet processed) documents to AI
    const newDocuments = documents.filter((d) => !alreadyProcessedIds.has(d.id));

    if (newDocuments.length === 0) {
      // No new docs — return existing items unchanged with 0 filled
      const updatedItems = await checklistQueries.getByDealId(deal_id);
      return NextResponse.json({
        data: {
          items: updatedItems,
          filled_count: 0,
          message: "No new documents to process. Upload new documents to run AI auto-fill again.",
        },
      });
    }

    // Get memory text from deal notes
    const memoryText = await dealNoteQueries.getMemoryText(deal_id);

    // Run AI auto-fill on new documents only
    const results = await autoFillChecklist(deal.name, newDocuments, existingItems, memoryText || null);

    // Match results back to checklist items by category + item text
    const itemMap = new Map(
      existingItems.map((i) => [`${i.category}|${i.item}`, i.id])
    );

    const updates = results
      .map((result) => {
        const key = `${result.category}|${result.item}`;
        const id = itemMap.get(key);
        if (!id) return null;

        const sourceDocIds = result.source_document_names
          .map((name) => {
            const doc = documents.find(
              (d) => d.name === name || d.original_name === name
            );
            return doc?.id;
          })
          .filter(Boolean);

        return {
          id,
          deal_id,
          category: result.category,
          item: result.item,
          status: result.status,
          notes: result.notes || null,
          ai_filled: true,
          source_document_ids: sourceDocIds.length > 0 ? sourceDocIds : null,
        };
      })
      .filter(Boolean) as Array<Record<string, unknown>>;

    if (updates.length > 0) {
      await checklistQueries.bulkUpsert(updates);
    }

    const updatedItems = await checklistQueries.getByDealId(deal_id);
    return NextResponse.json({
      data: {
        items: updatedItems,
        filled_count: updates.length,
        new_docs_processed: newDocuments.length,
        skipped_docs: alreadyProcessedIds.size,
      },
    });
  } catch (error) {
    console.error("POST /api/checklist/autofill error:", error);
    return NextResponse.json({ error: "Auto-fill failed" }, { status: 500 });
  }
}
