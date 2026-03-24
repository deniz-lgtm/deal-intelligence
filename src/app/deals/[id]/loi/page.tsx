"use client";

import { useState, useEffect } from "react";
import {
  Save,
  Loader2,
  Printer,
  CheckCircle,
  AlertTriangle,
  FileSignature,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";
import { toast } from "sonner";
import type { LOIData, Deal } from "@/lib/types";

const DEFAULT_LOI: LOIData = {
  buyer_entity: "",
  buyer_contact: "",
  buyer_address: "",
  seller_name: "",
  seller_address: "",
  purchase_price: null,
  earnest_money: null,
  earnest_money_hard_days: 30,
  due_diligence_days: 30,
  financing_contingency_days: 21,
  closing_days: 30,
  has_financing_contingency: true,
  lender_name: "",
  as_is: true,
  broker_name: "",
  broker_commission: "",
  additional_terms: "",
  loi_date: new Date().toISOString().slice(0, 10),
};

function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="block text-xs font-medium text-muted-foreground mb-1">{label}</label>
      {children}
    </div>
  );
}

const inputCls = "w-full px-3 py-1.5 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border rounded-xl bg-card p-5 space-y-4">
      <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">{title}</h3>
      {children}
    </div>
  );
}

export default function LOIPage({ params }: { params: { id: string } }) {
  const [data, setData] = useState<LOIData>(DEFAULT_LOI);
  const [deal, setDeal] = useState<Deal | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [executed, setExecuted] = useState(false);
  const [markingExecuted, setMarkingExecuted] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch(`/api/deals/${params.id}`).then((r) => r.json()),
      fetch(`/api/loi?deal_id=${params.id}`).then((r) => r.json()),
    ]).then(([dealRes, loiRes]) => {
      const d = dealRes.data as Deal;
      setDeal(d);
      if (loiRes.data?.data) {
        try {
          setData({ ...DEFAULT_LOI, ...JSON.parse(loiRes.data.data) });
          setExecuted(!!loiRes.data.executed);
        } catch { /* use defaults */ }
      } else if (d) {
        // Pre-fill from deal
        setData((prev) => ({
          ...prev,
          purchase_price: d.asking_price,
          loi_date: new Date().toISOString().slice(0, 10),
        }));
      }
      setLoading(false);
    });
  }, [params.id]);

  const set = <K extends keyof LOIData>(key: K, value: LOIData[K]) => {
    setData((prev) => ({ ...prev, [key]: value }));
  };

  const save = async (markExec = false) => {
    setSaving(true);
    try {
      const res = await fetch("/api/loi", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deal_id: params.id, data, executed: markExec || executed }),
      });
      if (res.ok) {
        if (markExec) {
          setExecuted(true);
          // Also update deal loi_executed flag
          await fetch(`/api/deals/${params.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ loi_executed: 1 }),
          });
          setDeal((prev) => prev ? { ...prev, loi_executed: true } : prev);
          toast.success("LOI marked as executed — deal can advance to Under Contract");
        } else {
          toast.success("LOI saved");
        }
      } else {
        toast.error("Failed to save");
      }
    } catch {
      toast.error("Failed to save");
    } finally {
      setSaving(false);
      setMarkingExecuted(false);
    }
  };

  const printLOI = () => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    const address = deal ? [deal.address, deal.city, deal.state, deal.zip].filter(Boolean).join(", ") : "";
    const loiHtml = generateLOIHtml(data, address);
    printWindow.document.write(loiHtml);
    printWindow.document.close();
    printWindow.print();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const address = deal ? [deal.address, deal.city, deal.state, deal.zip].filter(Boolean).join(", ") : "";

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Letter of Intent</h2>
          <p className="text-sm text-muted-foreground">
            Build, save, and export your LOI
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={printLOI}>
            <Printer className="h-4 w-4 mr-2" />
            Export / Print
          </Button>
          <Button onClick={() => save(false)} disabled={saving}>
            {saving && !markingExecuted ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Save
          </Button>
        </div>
      </div>

      {/* Execution status */}
      <div className={`border rounded-xl p-4 flex items-center justify-between gap-4 ${executed ? "bg-green-50 border-green-200" : "bg-card"}`}>
        <div className="flex items-center gap-3">
          {executed ? (
            <CheckCircle className="h-5 w-5 text-green-600 shrink-0" />
          ) : (
            <AlertTriangle className="h-5 w-5 text-yellow-500 shrink-0" />
          )}
          <div>
            <p className="font-medium text-sm">
              {executed ? "LOI Executed" : "LOI Not Yet Executed"}
            </p>
            <p className="text-xs text-muted-foreground">
              {executed
                ? "This deal can be advanced to Under Contract"
                : "Mark as executed once both parties have signed"}
            </p>
          </div>
        </div>
        {!executed && (
          <Button
            size="sm"
            onClick={() => { setMarkingExecuted(true); save(true); }}
            disabled={saving}
          >
            {saving && markingExecuted ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <CheckCircle className="h-4 w-4 mr-2" />
            )}
            Mark as Executed
          </Button>
        )}
      </div>

      {/* Parties */}
      <Section title="Parties">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Buyer Entity / Name">
            <input className={inputCls} value={data.buyer_entity} onChange={(e) => set("buyer_entity", e.target.value)} placeholder="XYZ Capital LLC" />
          </Field>
          <Field label="Buyer Contact">
            <input className={inputCls} value={data.buyer_contact} onChange={(e) => set("buyer_contact", e.target.value)} placeholder="John Smith" />
          </Field>
          <Field label="Buyer Address" className="md:col-span-2">
            <input className={inputCls} value={data.buyer_address} onChange={(e) => set("buyer_address", e.target.value)} placeholder="123 Main St, City, State 00000" />
          </Field>
          <Field label="Seller Name / Entity">
            <input className={inputCls} value={data.seller_name} onChange={(e) => set("seller_name", e.target.value)} placeholder="ABC Properties LLC" />
          </Field>
          <Field label="Seller Address">
            <input className={inputCls} value={data.seller_address} onChange={(e) => set("seller_address", e.target.value)} placeholder="456 Oak Ave, City, State 00000" />
          </Field>
        </div>
      </Section>

      {/* Property */}
      <Section title="Property">
        <div className="border rounded-lg p-3 bg-muted/50">
          <p className="text-sm font-medium">{deal?.name}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{address || "No address on file"}</p>
        </div>
      </Section>

      {/* Financial Terms */}
      <Section title="Financial Terms">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <Field label="Purchase Price">
            <div className="flex items-center border rounded-md bg-background overflow-hidden">
              <span className="px-2 text-sm text-muted-foreground bg-muted border-r">$</span>
              <input
                type="number"
                className="flex-1 px-2 py-1.5 text-sm outline-none bg-transparent"
                value={data.purchase_price || ""}
                onChange={(e) => set("purchase_price", Number(e.target.value) || null)}
                placeholder="0"
              />
            </div>
          </Field>
          <Field label="Earnest Money Deposit">
            <div className="flex items-center border rounded-md bg-background overflow-hidden">
              <span className="px-2 text-sm text-muted-foreground bg-muted border-r">$</span>
              <input
                type="number"
                className="flex-1 px-2 py-1.5 text-sm outline-none bg-transparent"
                value={data.earnest_money || ""}
                onChange={(e) => set("earnest_money", Number(e.target.value) || null)}
                placeholder="0"
              />
            </div>
          </Field>
          <Field label="Days Until EMD Goes Hard">
            <input type="number" className={inputCls} value={data.earnest_money_hard_days || ""} onChange={(e) => set("earnest_money_hard_days", Number(e.target.value) || null)} placeholder="30" />
          </Field>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={data.as_is} onChange={(e) => set("as_is", e.target.checked)} className="rounded" />
            Purchase is "As-Is, Where-Is"
          </label>
        </div>
      </Section>

      {/* Timeline */}
      <Section title="Timeline (Days from Acceptance)">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <Field label="Due Diligence Period">
            <div className="flex items-center border rounded-md bg-background overflow-hidden">
              <input type="number" className="flex-1 px-2 py-1.5 text-sm outline-none bg-transparent" value={data.due_diligence_days || ""} onChange={(e) => set("due_diligence_days", Number(e.target.value) || null)} placeholder="30" />
              <span className="px-2 text-sm text-muted-foreground bg-muted border-l">days</span>
            </div>
          </Field>
          <Field label="Financing Contingency">
            <div className="flex items-center border rounded-md bg-background overflow-hidden">
              <input type="number" className="flex-1 px-2 py-1.5 text-sm outline-none bg-transparent" value={data.financing_contingency_days || ""} onChange={(e) => set("financing_contingency_days", Number(e.target.value) || null)} placeholder="21" />
              <span className="px-2 text-sm text-muted-foreground bg-muted border-l">days</span>
            </div>
          </Field>
          <Field label="Closing">
            <div className="flex items-center border rounded-md bg-background overflow-hidden">
              <input type="number" className="flex-1 px-2 py-1.5 text-sm outline-none bg-transparent" value={data.closing_days || ""} onChange={(e) => set("closing_days", Number(e.target.value) || null)} placeholder="30" />
              <span className="px-2 text-sm text-muted-foreground bg-muted border-l">days</span>
            </div>
          </Field>
        </div>
      </Section>

      {/* Financing */}
      <Section title="Financing">
        <label className="flex items-center gap-2 cursor-pointer text-sm font-medium">
          <input type="checkbox" checked={data.has_financing_contingency} onChange={(e) => set("has_financing_contingency", e.target.checked)} className="rounded" />
          Subject to financing contingency
        </label>
        {data.has_financing_contingency && (
          <Field label="Lender Name (if known)">
            <input className={inputCls} value={data.lender_name} onChange={(e) => set("lender_name", e.target.value)} placeholder="First National Bank" />
          </Field>
        )}
      </Section>

      {/* Broker */}
      <Section title="Broker (if applicable)">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Broker Name">
            <input className={inputCls} value={data.broker_name} onChange={(e) => set("broker_name", e.target.value)} placeholder="Jane Doe, ABC Realty" />
          </Field>
          <Field label="Commission">
            <input className={inputCls} value={data.broker_commission} onChange={(e) => set("broker_commission", e.target.value)} placeholder="3% of purchase price" />
          </Field>
        </div>
      </Section>

      {/* Additional Terms */}
      <Section title="Additional Terms & Conditions">
        <textarea
          className="w-full px-3 py-2 text-sm border rounded-md bg-background resize-none focus:outline-none focus:ring-2 focus:ring-ring"
          rows={5}
          value={data.additional_terms}
          onChange={(e) => set("additional_terms", e.target.value)}
          placeholder="Seller to provide rent rolls within 3 business days of acceptance. Buyer reserves right to assign this agreement..."
        />
      </Section>

      {/* LOI Date */}
      <Section title="LOI Date">
        <Field label="Date">
          <input type="date" className={inputCls} value={data.loi_date} onChange={(e) => set("loi_date", e.target.value)} />
        </Field>
      </Section>

      {/* Preview */}
      <div className="border rounded-xl bg-card p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <FileSignature className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-semibold text-sm">LOI Preview</h3>
          </div>
          <Button variant="outline" size="sm" onClick={printLOI}>
            <Printer className="h-3 w-3 mr-1" /> Export / Print
          </Button>
        </div>
        <div className="bg-white text-black rounded-lg p-6 text-sm leading-relaxed shadow-inner border font-serif" style={{ fontFamily: "Georgia, serif" }}>
          <LOIPreview data={data} address={address} dealName={deal?.name || ""} />
        </div>
      </div>

      <div className="flex justify-end gap-3">
        <Button variant="outline" onClick={printLOI}>
          <Printer className="h-4 w-4 mr-2" /> Export / Print
        </Button>
        <Button onClick={() => save(false)} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
          Save LOI
        </Button>
      </div>
    </div>
  );
}

function LOIPreview({ data, address, dealName }: { data: LOIData; address: string; dealName: string }) {
  const fmt = (n: number | null) => (n ? formatCurrency(n) : "_____________");
  const fmtDays = (n: number | null) => (n ? `${n}` : "___");

  return (
    <div className="space-y-4">
      <div className="text-center border-b pb-4 mb-4">
        <p className="text-xs text-gray-500 uppercase tracking-widest mb-1">Letter of Intent</p>
        <p className="font-bold text-base">NON-BINDING LETTER OF INTENT TO PURCHASE</p>
        <p className="text-xs text-gray-500 mt-1">{data.loi_date ? new Date(data.loi_date + "T00:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "_______________"}</p>
      </div>

      <p><strong>{data.seller_name || "________________________"}</strong>{data.seller_address ? `, ${data.seller_address}` : ""} ("Seller")</p>
      <p>RE: Letter of Intent — {dealName || address || "___________________"}</p>

      <p>
        This letter sets forth the non-binding terms under which <strong>{data.buyer_entity || "________________________"}</strong> ("Buyer")
        proposes to acquire the property located at <strong>{address || "________________________"}</strong> (the "Property") from Seller.
      </p>

      <div>
        <p><strong>1. Purchase Price:</strong> {fmt(data.purchase_price)}</p>
        <p><strong>2. Earnest Money:</strong> {fmt(data.earnest_money)}, deposited within 3 business days of PSA execution.
          {data.earnest_money_hard_days ? ` Earnest money becomes non-refundable after the end of the due diligence period (${fmtDays(data.earnest_money_hard_days)} days).` : ""}
        </p>
        {data.as_is && <p><strong>3. Condition:</strong> Property to be purchased "As-Is, Where-Is" with no representations or warranties from Seller regarding condition.</p>}
      </div>

      <div>
        <p><strong>{data.as_is ? "4" : "3"}. Due Diligence:</strong> Buyer shall have <strong>{fmtDays(data.due_diligence_days)} days</strong> from PSA execution to complete all inspections and investigations.</p>
        {data.has_financing_contingency && (
          <p><strong>{data.as_is ? "5" : "4"}. Financing Contingency:</strong> This offer is subject to Buyer obtaining financing. Financing contingency expires <strong>{fmtDays(data.financing_contingency_days)} days</strong> from PSA execution.{data.lender_name ? ` Anticipated lender: ${data.lender_name}.` : ""}</p>
        )}
        <p><strong>{data.as_is ? (data.has_financing_contingency ? "6" : "5") : (data.has_financing_contingency ? "5" : "4")}. Closing:</strong> Target closing within <strong>{fmtDays(data.closing_days)} days</strong> of PSA execution (or end of due diligence, whichever is later).</p>
      </div>

      {data.additional_terms && (
        <div>
          <p><strong>Additional Terms:</strong></p>
          <p className="whitespace-pre-wrap text-sm">{data.additional_terms}</p>
        </div>
      )}

      {data.broker_name && (
        <p><strong>Broker:</strong> {data.broker_name}{data.broker_commission ? ` — Commission: ${data.broker_commission}` : ""}</p>
      )}

      <p className="text-xs text-gray-500 border-t pt-3 mt-4">
        This letter is non-binding and is intended solely as a basis for negotiation. Neither party shall be legally bound until a definitive Purchase and Sale Agreement is fully executed.
      </p>

      <div className="grid grid-cols-2 gap-8 mt-8 text-sm">
        <div>
          <p className="font-bold">{data.buyer_entity || "BUYER"}</p>
          <div className="border-b border-black mt-8 mb-1" />
          <p>Signature</p>
          <div className="border-b border-black mt-4 mb-1" />
          <p>Print Name / Title</p>
          <div className="border-b border-black mt-4 mb-1" />
          <p>Date</p>
        </div>
        <div>
          <p className="font-bold">{data.seller_name || "SELLER"}</p>
          <div className="border-b border-black mt-8 mb-1" />
          <p>Signature</p>
          <div className="border-b border-black mt-4 mb-1" />
          <p>Print Name / Title</p>
          <div className="border-b border-black mt-4 mb-1" />
          <p>Date</p>
        </div>
      </div>
    </div>
  );
}

function generateLOIHtml(data: LOIData, address: string): string {
  const fmt = (n: number | null) => (n ? `$${n.toLocaleString()}` : "_____________");
  const fmtDays = (n: number | null) => (n ? `${n}` : "___");
  const dateStr = data.loi_date
    ? new Date(data.loi_date + "T00:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    : "_______________";

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>Letter of Intent</title>
<style>
  body { font-family: Georgia, serif; font-size: 12pt; line-height: 1.7; color: #000; max-width: 750px; margin: 40px auto; padding: 0 40px; }
  h1 { text-align: center; font-size: 14pt; letter-spacing: 1px; margin-bottom: 4px; }
  .subtitle { text-align: center; font-size: 9pt; color: #666; letter-spacing: 2px; text-transform: uppercase; }
  .date { text-align: center; font-size: 10pt; color: #666; margin-bottom: 24px; }
  p { margin: 8px 0; }
  .sig-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 48px; margin-top: 48px; }
  .sig-block { }
  .sig-line { border-bottom: 1px solid black; margin-top: 32px; margin-bottom: 4px; }
  .sig-label { font-size: 10pt; color: #333; }
  .footer { font-size: 9pt; color: #666; border-top: 1px solid #ddd; padding-top: 12px; margin-top: 24px; }
  @media print { body { margin: 0; padding: 20px; } }
</style>
</head>
<body>
<p class="subtitle">Letter of Intent</p>
<h1>NON-BINDING LETTER OF INTENT TO PURCHASE</h1>
<p class="date">${dateStr}</p>

<p><strong>${data.seller_name || "________________________"}</strong>${data.seller_address ? `, ${data.seller_address}` : ""} ("Seller")</p>
<p><strong>RE: Letter of Intent — ${address || "________________________"}</strong></p>

<p>This letter sets forth the non-binding terms under which <strong>${data.buyer_entity || "________________________"}</strong> ("Buyer") proposes to acquire the property located at <strong>${address || "________________________"}</strong> (the "Property") from Seller.</p>

<p><strong>1. Purchase Price:</strong> ${fmt(data.purchase_price)}</p>
<p><strong>2. Earnest Money:</strong> ${fmt(data.earnest_money)}, deposited within 3 business days of PSA execution.${data.earnest_money_hard_days ? ` Earnest money becomes non-refundable after ${fmtDays(data.earnest_money_hard_days)} days.` : ""}</p>
${data.as_is ? `<p><strong>3. Condition:</strong> Property to be purchased "As-Is, Where-Is" with no representations or warranties from Seller.</p>` : ""}
<p><strong>${data.as_is ? "4" : "3"}. Due Diligence:</strong> Buyer shall have <strong>${fmtDays(data.due_diligence_days)} days</strong> from PSA execution to complete all inspections.</p>
${data.has_financing_contingency ? `<p><strong>${data.as_is ? "5" : "4"}. Financing Contingency:</strong> Subject to Buyer obtaining financing within <strong>${fmtDays(data.financing_contingency_days)} days</strong>.${data.lender_name ? ` Anticipated lender: ${data.lender_name}.` : ""}</p>` : ""}
<p><strong>${data.as_is ? (data.has_financing_contingency ? "6" : "5") : (data.has_financing_contingency ? "5" : "4")}. Closing:</strong> Target closing within <strong>${fmtDays(data.closing_days)} days</strong> of PSA execution.</p>
${data.additional_terms ? `<p><strong>Additional Terms:</strong><br/>${data.additional_terms.replace(/\n/g, "<br/>")}</p>` : ""}
${data.broker_name ? `<p><strong>Broker:</strong> ${data.broker_name}${data.broker_commission ? ` — Commission: ${data.broker_commission}` : ""}</p>` : ""}

<p class="footer">This letter is non-binding and is intended solely as a basis for negotiation. Neither party shall be legally bound until a definitive Purchase and Sale Agreement is fully executed.</p>

<div class="sig-grid">
  <div class="sig-block">
    <strong>${data.buyer_entity || "BUYER"}</strong>
    <div class="sig-line"></div><p class="sig-label">Signature</p>
    <div class="sig-line"></div><p class="sig-label">Print Name / Title</p>
    <div class="sig-line"></div><p class="sig-label">Date</p>
  </div>
  <div class="sig-block">
    <strong>${data.seller_name || "SELLER"}</strong>
    <div class="sig-line"></div><p class="sig-label">Signature</p>
    <div class="sig-line"></div><p class="sig-label">Print Name / Title</p>
    <div class="sig-line"></div><p class="sig-label">Date</p>
  </div>
</div>
</body>
</html>`;
}
