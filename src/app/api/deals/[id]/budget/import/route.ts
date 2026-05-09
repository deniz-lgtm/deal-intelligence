import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { hardCostQueries, budgetVersionQueries } from "@/lib/db";
import { requireAuth, requireDealEditAccess } from "@/lib/auth";
import type { BudgetCostClass } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Two import paths:
//   1. JSON body { rows: [...], version_id?, replace? } — used by the paste-import
//      dialog (already-parsed TSV rows from the client) and the seed flow.
//   2. multipart/form-data with `file` (xlsx/csv) — server-side parse via SheetJS.
//
// Both converge on the same insertion path so de-duplication and version
// scoping live in one place.

interface RawRow {
  cost_class?: string;
  category?: string;
  description?: string;
  csi_code?: string | null;
  unit?: string | null;
  amount?: number | string | null;
  retainage_pct?: number | string | null;
  notes?: string | null;
}

const VALID_CLASSES: BudgetCostClass[] = ["hard", "soft", "contingency"];

function normalizeRow(raw: RawRow): {
  cost_class: BudgetCostClass;
  category: string;
  description: string;
  csi_code: string | null;
  unit: string | null;
  amount: number;
  retainage_pct: number;
  notes: string | null;
} | null {
  const description = (raw.description || "").trim();
  if (!description) return null;
  const inputClass = String(raw.cost_class || "hard").toLowerCase().trim();
  const cost_class = (VALID_CLASSES.includes(inputClass as BudgetCostClass) ? inputClass : "hard") as BudgetCostClass;
  const category = (raw.category || (cost_class === "hard" ? "Hard Cost" : cost_class === "soft" ? "Soft Cost" : "Contingency")).toString().trim();
  const amount = raw.amount === undefined || raw.amount === null || raw.amount === "" ? 0 : Number(String(raw.amount).replace(/[$,\s]/g, ""));
  const retainage_pct = raw.retainage_pct === undefined || raw.retainage_pct === null || raw.retainage_pct === ""
    ? 0
    : Number(String(raw.retainage_pct).replace(/%\s*/g, ""));
  return {
    cost_class,
    category,
    description,
    csi_code: raw.csi_code ? String(raw.csi_code).trim() : null,
    unit: raw.unit ? String(raw.unit).trim() : null,
    amount: Number.isFinite(amount) ? amount : 0,
    retainage_pct: Number.isFinite(retainage_pct) ? retainage_pct : 0,
    notes: raw.notes ? String(raw.notes).trim() : null,
  };
}

async function ensureVersion(dealId: string, versionId: string | null, userId: string) {
  if (versionId) return versionId;
  const active = await budgetVersionQueries.getActive(dealId);
  if (active) return active.id as string;
  const created = await budgetVersionQueries.create({
    id: uuidv4(),
    deal_id: dealId,
    label: "V1 - Initial",
    created_by: userId,
  });
  await budgetVersionQueries.setActive(dealId, created.id as string);
  return created.id as string;
}

async function parseSpreadsheet(file: File): Promise<RawRow[]> {
  const buf = Buffer.from(await file.arrayBuffer());
  // Lazy-load xlsx. The package is heavy and only needed in this path.
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buf, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return [];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false });
  return rows.map((r) => {
    // Heuristic header normalization: lowercase + strip non-alphanumerics.
    const norm: Record<string, string> = {};
    for (const k of Object.keys(r)) {
      const key = k.toLowerCase().replace(/[^a-z0-9]/g, "");
      norm[key] = String(r[k] ?? "");
    }
    const pick = (...keys: string[]) => keys.map((k) => norm[k]).find((v) => v && v.trim()) ?? "";
    return {
      cost_class: pick("costclass", "class", "type") || (pick("category").toLowerCase().includes("soft") ? "soft" : pick("category").toLowerCase().includes("contingency") ? "contingency" : "hard"),
      category: pick("category", "section", "group"),
      description: pick("description", "item", "scope", "lineitem"),
      csi_code: pick("csi", "csicode", "code", "div", "division") || null,
      unit: pick("unit") || null,
      amount: pick("originalscheduledvalue", "scheduledvalue", "budget", "amount", "originalbudget", "originalamount", "value") || 0,
      retainage_pct: pick("retainagepct", "retainage", "retain") || 0,
      notes: pick("notes", "note", "comment") || null,
    } as RawRow;
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const { errorResponse: accessError } = await requireDealEditAccess(params.id, userId);
  if (accessError) return accessError;

  const contentType = req.headers.get("content-type") || "";
  let rawRows: RawRow[] = [];
  let versionId: string | null = null;
  let replace = false;

  if (contentType.includes("multipart/form-data")) {
    const formData = await req.formData();
    const file = formData.get("file");
    versionId = (formData.get("version_id") as string | null) || null;
    replace = formData.get("replace") === "true";
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }
    try {
      rawRows = await parseSpreadsheet(file);
    } catch (err) {
      console.error("budget import parse failed:", err);
      return NextResponse.json({ error: "Could not parse spreadsheet. Use XLSX or CSV with headers like Description, Cost Class, Amount." }, { status: 400 });
    }
  } else {
    const body = await req.json();
    rawRows = body.rows || [];
    versionId = body.version_id || null;
    replace = body.replace === true;
  }

  const cleaned = rawRows.map(normalizeRow).filter((r): r is NonNullable<ReturnType<typeof normalizeRow>> => r !== null);
  if (cleaned.length === 0) {
    return NextResponse.json({ error: "No valid rows found in input." }, { status: 400 });
  }

  const targetVersion = await ensureVersion(params.id, versionId, userId);

  // Optional replace-mode: wipes existing lines for the version before insert.
  // Used by the "Seed Standard SOV" button so re-clicking doesn't pile up rows.
  if (replace) {
    const existing = await hardCostQueries.getByDealId(params.id, targetVersion);
    for (const e of existing) {
      await hardCostQueries.delete(e.id as string);
    }
  }

  const items = cleaned.map((r, i) => ({
    id: uuidv4(),
    deal_id: params.id,
    category: r.category,
    description: r.description,
    amount: r.amount,
    cost_class: r.cost_class,
    csi_code: r.csi_code,
    unit: r.unit,
    retainage_pct: r.retainage_pct,
    notes: r.notes,
    sort_order: i,
    budget_version_id: targetVersion,
  }));
  await hardCostQueries.bulkCreate(items);

  return NextResponse.json({ data: { inserted: items.length, version_id: targetVersion } });
}
