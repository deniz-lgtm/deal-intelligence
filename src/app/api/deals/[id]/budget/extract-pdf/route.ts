import { NextRequest, NextResponse } from "next/server";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";
import { hardCostQueries, budgetVersionQueries } from "@/lib/db";
import { requireAuth, requireDealEditAccess } from "@/lib/auth";
import { getActiveModel } from "@/lib/claude";
import { v4 as uuidv4 } from "uuid";
import type { BudgetCostClass } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// AI extraction of a contractor's Schedule of Values from a PDF. Pdf-parse pulls
// the text; Claude structures it into budget rows that mirror our schema.
//
// This is a separate path from the spreadsheet importer — contractor SOVs
// rarely arrive as clean XLSX. Most are PDFs exported from Procore, Sage, or
// the GC's accounting system, with line numbers, division headers, and notes
// the user wants to keep.

const MAX_BYTES = 25 * 1024 * 1024;

interface ExtractedRow {
  cost_class: BudgetCostClass;
  category: string;
  description: string;
  csi_code: string | null;
  unit: string | null;
  amount: number;
}

interface ExtractedPayload {
  rows: ExtractedRow[];
  notes: string | null;
}

async function extractPdfText(buf: Buffer): Promise<string> {
  try {
    const pdfParse = (await import("pdf-parse")).default;
    const data = await pdfParse(buf);
    return data.text || "";
  } catch (err) {
    console.warn("pdf-parse failed for SOV upload:", err);
    return "";
  }
}

const SYSTEM_PROMPT = `You extract a Schedule of Values from a contractor's PDF into a structured JSON budget.

Rules:
- One row per line item the contractor lists. Sum-up rows and division headers are NOT line items — skip them.
- cost_class is "hard" for construction trades, "soft" for fees/permits/loan/insurance/architect/engineering/marketing, "contingency" for any contingency line. When in doubt, default to "hard".
- category: keep it simple: "Hard Cost" / "Soft Cost" / "Contingency". The user can re-categorize later.
- description: the line item name as it appears on the SOV (e.g., "Foundation", "GC OH & Fee", "Architect").
- csi_code: only if a CSI division code is shown (e.g., "03", "23"). Otherwise null.
- unit: only if a unit of measure is shown (e.g., "LS", "EA", "SF"). Otherwise null.
- amount: the original/scheduled value in dollars. Strip $ and commas. If the number is a percent (e.g. for retainage), set amount to 0 (not relevant for the budget seed).
- Skip retainage-summary lines, totals, subtotals.

Output: a single JSON object, no fences, no prose:
{ "rows": [...], "notes": "<short note about anything ambiguous, or null>" }`;

async function aiExtract(text: string): Promise<ExtractedPayload | null> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await client.messages.create({
    model: await getActiveModel(),
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Extract the Schedule of Values from this PDF text. Truncated to first 20k chars if very long.\n\n${text.slice(0, 20000)}`,
      },
    ],
  });
  const out = response.content[0].type === "text" ? response.content[0].text : "";
  const cleaned = out.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  try {
    return JSON.parse(cleaned) as ExtractedPayload;
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) {
      try { return JSON.parse(m[0]) as ExtractedPayload; } catch { /* fall through */ }
    }
    return null;
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const { errorResponse: accessError } = await requireDealEditAccess(params.id, userId);
  if (accessError) return accessError;

  const fd = await req.formData();
  const file = fd.get("file");
  if (!file || !(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `File exceeds ${(MAX_BYTES / 1024 / 1024) | 0} MB cap.` }, { status: 413 });
  }
  const versionId = (fd.get("version_id") as string | null) || null;
  const replace = fd.get("replace") === "true";

  const ext = path.extname(file.name).toLowerCase();
  if (ext !== ".pdf") {
    return NextResponse.json({ error: "PDF expected. For XLSX/CSV, use the spreadsheet importer." }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const text = await extractPdfText(buf);
  if (!text || text.length < 100) {
    return NextResponse.json({ error: "Could not extract text from PDF. Try the spreadsheet importer instead." }, { status: 400 });
  }

  const parsed = await aiExtract(text);
  if (!parsed || !Array.isArray(parsed.rows) || parsed.rows.length === 0) {
    return NextResponse.json({ error: "AI couldn't structure the SOV. Try the spreadsheet importer instead." }, { status: 502 });
  }

  // Resolve the target version: explicit param, else active, else create V1.
  let targetVersion = versionId;
  if (!targetVersion) {
    const active = await budgetVersionQueries.getActive(params.id);
    if (active) {
      targetVersion = active.id as string;
    } else {
      const created = await budgetVersionQueries.create({
        id: uuidv4(),
        deal_id: params.id,
        label: "V1 - Initial",
        created_by: userId,
      });
      await budgetVersionQueries.setActive(params.id, created.id as string);
      targetVersion = created.id as string;
    }
  }

  if (replace) {
    const existing = await hardCostQueries.getByDealId(params.id, targetVersion);
    for (const e of existing) {
      await hardCostQueries.delete(e.id as string);
    }
  }

  const items = parsed.rows
    .filter((r) => r.description && r.description.trim() !== "")
    .map((r, i) => ({
      id: uuidv4(),
      deal_id: params.id,
      category: r.category || (r.cost_class === "hard" ? "Hard Cost" : r.cost_class === "soft" ? "Soft Cost" : "Contingency"),
      description: r.description,
      cost_class: r.cost_class || "hard",
      csi_code: r.csi_code || null,
      unit: r.unit || null,
      amount: Number(r.amount) || 0,
      sort_order: i,
      budget_version_id: targetVersion,
    }));
  await hardCostQueries.bulkCreate(items);

  return NextResponse.json({
    data: { inserted: items.length, version_id: targetVersion, notes: parsed.notes ?? null },
  });
}
