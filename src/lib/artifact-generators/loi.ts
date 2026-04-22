import { v4 as uuidv4 } from "uuid";
import { dealQueries, getBrandingForDeal, loiQueries } from "@/lib/db";
import { uploadBlob } from "@/lib/blob-storage";
import { htmlToPdf } from "@/lib/html-to-pdf";
import { computeArtifactHash } from "@/lib/artifact-hash";
import { generateLOIHtml, type BrandingData } from "@/lib/loi-html";
import type { LOIData } from "@/lib/types";
import type { ArtifactGenerator } from "./types";

interface LoiPayload {
  /** Optional override: if the page already has edits in-memory that
   *  haven't saved yet, it can pass the LOIData here. Otherwise we
   *  read the latest saved row. */
  data?: LOIData;
}

/**
 * LOI generator. Reads the saved LOIData + branding and runs the shared
 * LOI HTML composer through htmlToPdf. Migrates the old
 * `window.print()` flow into a first-class artifact with versioning
 * + staleness detection.
 */
const loiGenerator: ArtifactGenerator = async (opts) => {
  let data: LOIData | null = null;
  const payload = (opts.payload ?? {}) as LoiPayload;

  if (payload.data) {
    data = payload.data;
  } else {
    // loiQueries stores the most recent row per deal with the JSON blob
    // under `data`. Fall back to an empty shell so the PDF still
    // renders with placeholder fields (matches the page preview).
    try {
      const row = await loiQueries.getByDealId(opts.dealId);
      if (row?.data) {
        data = typeof row.data === "string" ? JSON.parse(row.data) : (row.data as LOIData);
      }
    } catch {
      /* fall through */
    }
  }

  const deal = await dealQueries.getById(opts.dealId);
  if (!deal) throw new Error("Deal not found");

  const address = [deal.address, deal.city, deal.state, deal.zip]
    .filter(Boolean)
    .join(", ");

  // Pull branding directly from the business plan if present — mirrors
  // the page's popup-print flow so downloads look identical.
  let branding: BrandingData | null = null;
  try {
    const rawBranding = await getBrandingForDeal(opts.dealId).catch(() => null);
    if (rawBranding) {
      branding = rawBranding as BrandingData;
    }
  } catch {
    /* defaults */
  }

  // Empty placeholder if nothing saved — keeps behavior consistent with
  // the page's print flow which also rendered placeholders.
  const loiData: LOIData = data ?? ({
    buyer_entity: "",
    buyer_contact: "",
    buyer_address: "",
    seller_name: "",
    seller_address: "",
    purchase_price: null,
    earnest_money: null,
    earnest_money_hard_days: null,
    due_diligence_days: null,
    financing_contingency_days: null,
    closing_days: null,
    has_financing_contingency: false,
    lender_name: "",
    as_is: false,
    broker_name: "",
    broker_commission: "",
    additional_terms: "",
    loi_date: "",
  } as LOIData);

  const html = generateLOIHtml(loiData, address, branding);
  const pdf = await htmlToPdf(html, { format: "Letter", margin: "0.5in" });

  const safeName = (deal.name || "LOI")
    .replace(/[^a-z0-9\-_ ]/gi, "")
    .trim()
    .replace(/\s+/g, "-");
  const filename = `LOI-${safeName}.pdf`;
  const dateStamp = new Date().toISOString().slice(0, 10);
  const blobPath = `deals/${opts.dealId}/reports/${dateStamp}-${uuidv4()}-${filename}`;
  const fileUrl = await uploadBlob(blobPath, pdf, "application/pdf");

  const { snapshot, hash } = computeArtifactHash({
    deal: { id: deal.id, updated_at: deal.updated_at },
    extras: {
      loiDate: loiData.loi_date,
      purchasePrice: loiData.purchase_price,
      earnestMoney: loiData.earnest_money,
      hasFinancingContingency: loiData.has_financing_contingency,
    },
  });

  return {
    title: `LOI — ${deal.name || "Deal"}`,
    filename,
    filePath: fileUrl,
    fileSize: pdf.length,
    mimeType: "application/pdf",
    summary: `Letter of Intent · ${new Date().toLocaleDateString()}`,
    tags: [
      "loi",
      "ai-generated",
      "pdf",
      ...(opts.massingId ? [`massing:${opts.massingId}`] : []),
    ],
    inputSnapshot: snapshot,
    inputHash: hash,
    contentText: null,
  };
};

export default loiGenerator;
