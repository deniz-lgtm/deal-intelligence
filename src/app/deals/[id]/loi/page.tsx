"use client";

import { useState, useEffect } from "react";
import {
  Save,
  Loader2,
  CheckCircle,
  AlertTriangle,
  FileSignature,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import ContactPicker from "@/components/ContactPicker";
import { formatCurrency } from "@/lib/utils";
import { toast } from "sonner";
import type { LOIData, Deal, Contact, StakeholderType, Document } from "@/lib/types";
import { DocCoverageChip } from "@/components/ai";
import GenerateToLibraryButton from "@/components/GenerateToLibraryButton";

const DEFAULT_LOI: LOIData = {
  buyer_entity: "",
  buyer_contact: "",
  buyer_contact_id: null,
  buyer_address: "",
  seller_name: "",
  seller_contact_id: null,
  seller_address: "",
  purchase_price: null,
  earnest_money: null,
  earnest_money_hard_days: 30,
  due_diligence_days: 30,
  financing_contingency_days: 21,
  closing_days: 30,
  has_financing_contingency: true,
  lender_name: "",
  lender_contact_id: null,
  as_is: true,
  broker_name: "",
  broker_contact_id: null,
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
  const [autofilling, setAutofilling] = useState(false);
  const [documents, setDocuments] = useState<Document[]>([]);

  const autofillLOI = async () => {
    setAutofilling(true);
    try {
      const res = await fetch(`/api/deals/${params.id}/loi-autofill`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) { toast.error(json.error || "Autofill failed"); return; }
      const d = json.data;
      setData((prev) => ({
        ...prev,
        purchase_price: d.purchase_price ?? prev.purchase_price,
        earnest_money: d.earnest_money ?? prev.earnest_money,
        earnest_money_hard_days: d.earnest_money_hard_days ?? prev.earnest_money_hard_days,
        due_diligence_days: d.due_diligence_days ?? prev.due_diligence_days,
        financing_contingency_days: d.financing_contingency_days ?? prev.financing_contingency_days,
        closing_days: d.closing_days ?? prev.closing_days,
        has_financing_contingency: d.has_financing_contingency ?? prev.has_financing_contingency,
        as_is: d.as_is ?? prev.as_is,
        additional_terms: d.additional_terms || prev.additional_terms,
        loi_date: d.loi_date || prev.loi_date,
      }));
      toast.success("LOI auto-filled from underwriting data");
    } catch { toast.error("Autofill failed"); }
    finally { setAutofilling(false); }
  };

  useEffect(() => {
    // Documents power the coverage chip; load independently so the LOI
    // data fetch path stays untouched.
    fetch(`/api/deals/${params.id}/documents`)
      .then((r) => r.json())
      .then((j) => setDocuments(j.data || []))
      .catch(() => {});
  }, [params.id]);

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

  /**
   * When a contact is picked for a party (buyer/seller/lender/broker),
   * write both the legacy display string (e.g. "Jane Doe, CBRE") and the
   * new *_contact_id FK. When cleared, drop the FK but leave the string
   * so existing rendering keeps working.
   */
  const setContactParty = (
    nameKey: "buyer_contact" | "seller_name" | "lender_name" | "broker_name",
    idKey: "buyer_contact_id" | "seller_contact_id" | "lender_contact_id" | "broker_contact_id",
    contact: Contact | null
  ) => {
    setData((prev) => ({
      ...prev,
      [idKey]: contact?.id ?? null,
      ...(contact
        ? { [nameKey]: contact.company ? `${contact.name}, ${contact.company}` : contact.name }
        : {}),
    }));
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
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={autofillLOI} disabled={autofilling}>
              {autofilling ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
              AI Autofill
            </Button>
            <DocCoverageChip documents={documents} section="loi" />
          </div>
          <GenerateToLibraryButton
            dealId={params.id}
            kind="loi"
            getPayload={() => ({ data })}
            variant="outline"
          />
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

      {/* Two-column layout: inputs left, live preview right */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 items-start">
        <div className="space-y-5 min-w-0">
      {/* Parties */}
      <Section title="Parties">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Buyer Entity / Name">
            <input className={inputCls} value={data.buyer_entity} onChange={(e) => set("buyer_entity", e.target.value)} placeholder="XYZ Capital LLC" />
          </Field>
          <Field label="Buyer Contact">
            <ContactPicker
              value={data.buyer_contact_id}
              displayLabel={data.buyer_contact && !data.buyer_contact_id ? data.buyer_contact : undefined}
              onChange={(c) => setContactParty("buyer_contact", "buyer_contact_id", c)}
              defaultRole={"buyer" as StakeholderType}
              placeholder="Search contacts..."
            />
            {!data.buyer_contact_id && (
              <input
                className={`${inputCls} mt-1.5`}
                value={data.buyer_contact}
                onChange={(e) => set("buyer_contact", e.target.value)}
                placeholder="...or type a name"
              />
            )}
          </Field>
          <Field label="Buyer Address" className="md:col-span-2">
            <input className={inputCls} value={data.buyer_address} onChange={(e) => set("buyer_address", e.target.value)} placeholder="123 Main St, City, State 00000" />
          </Field>
          <Field label="Seller Name / Entity">
            <ContactPicker
              value={data.seller_contact_id}
              displayLabel={data.seller_name && !data.seller_contact_id ? data.seller_name : undefined}
              onChange={(c) => setContactParty("seller_name", "seller_contact_id", c)}
              defaultRole={"seller" as StakeholderType}
              placeholder="Search contacts..."
            />
            {!data.seller_contact_id && (
              <input
                className={`${inputCls} mt-1.5`}
                value={data.seller_name}
                onChange={(e) => set("seller_name", e.target.value)}
                placeholder="...or type an entity"
              />
            )}
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
            <ContactPicker
              value={data.lender_contact_id}
              displayLabel={data.lender_name && !data.lender_contact_id ? data.lender_name : undefined}
              onChange={(c) => setContactParty("lender_name", "lender_contact_id", c)}
              defaultRole={"lender" as StakeholderType}
              placeholder="Search contacts..."
            />
            {!data.lender_contact_id && (
              <input
                className={`${inputCls} mt-1.5`}
                value={data.lender_name}
                onChange={(e) => set("lender_name", e.target.value)}
                placeholder="...or type a lender"
              />
            )}
          </Field>
        )}
      </Section>

      {/* Broker */}
      <Section title="Broker (if applicable)">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Broker Name">
            <ContactPicker
              value={data.broker_contact_id}
              displayLabel={data.broker_name && !data.broker_contact_id ? data.broker_name : undefined}
              onChange={(c) => setContactParty("broker_name", "broker_contact_id", c)}
              defaultRole={"broker" as StakeholderType}
              placeholder="Search contacts..."
            />
            {!data.broker_contact_id && (
              <input
                className={`${inputCls} mt-1.5`}
                value={data.broker_name}
                onChange={(e) => set("broker_name", e.target.value)}
                placeholder="...or type a name"
              />
            )}
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

        </div>

        {/* Preview column (sticky on xl+) */}
        <div className="xl:sticky xl:top-4 min-w-0">
          <div className="border rounded-xl bg-card p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <FileSignature className="h-4 w-4 text-muted-foreground" />
                <h3 className="font-semibold text-sm">LOI Preview</h3>
              </div>
              <GenerateToLibraryButton
                dealId={params.id}
                kind="loi"
                getPayload={() => ({ data })}
                size="sm"
                variant="outline"
              />
            </div>
            <div className="bg-white text-black rounded-lg p-6 text-sm leading-relaxed shadow-inner border font-serif max-h-[calc(100vh-10rem)] overflow-y-auto" style={{ fontFamily: "Georgia, serif" }}>
              <LOIPreview data={data} address={address} dealName={deal?.name || ""} />
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-3">
        <GenerateToLibraryButton
          dealId={params.id}
          kind="loi"
          getPayload={() => ({ data })}
          variant="outline"
        />
        <Button onClick={() => save(false)} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
          Save LOI
        </Button>
      </div>
    </div>
  );
}

function LOIPreview({ data, address, dealName }: { data: LOIData; address: string; dealName: string }) {
  const fmt = (n: number | null) => (n ? formatCurrency(n) : "[$ AMOUNT]");
  const fmtDays = (n: number | null) => (n ? `${n} days` : "[# DAYS]");
  const dateStr = data.loi_date
    ? new Date(data.loi_date + "T00:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    : "[DATE]";

  const paymentTerms = data.as_is ? "All cash to Seller" : "[PAYMENT TERMS]";
  const financingLine = data.has_financing_contingency
    ? `${fmtDays(data.financing_contingency_days)} financing contingency${data.lender_name ? ` (anticipated lender: ${data.lender_name})` : ""}`
    : "None — Buyer obtaining loan without contingency";

  return (
    <div className="space-y-4">
      {/* Header placeholder — real logo/branding rendered in printed/exported version */}
      <div className="border-b-2 border-black pb-3 mb-4 flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-16 h-16 border-2 border-dashed border-gray-400 flex items-center justify-center text-[9px] text-gray-400 text-center leading-tight shrink-0">
            LOGO
          </div>
          <div className="text-xs leading-snug">
            <div className="font-bold text-sm">[ENTITY NAME]</div>
            <div>[ENTITY ADDRESS LINE 1]</div>
            <div>[CITY, STATE ZIP]</div>
            <div>[PHONE]  |  [EMAIL]</div>
          </div>
        </div>
      </div>

      <p><strong>Date:</strong> {dateStr}</p>

      <div>
        <p><strong>TO:</strong> {data.seller_name || "[SELLER / SELLER'S REP NAME]"}</p>
        <p>[Company / Brokerage Name]</p>
        <p>{data.seller_address || "[Address]"}</p>
        <p>[Email]</p>
      </div>

      <p><strong>Re:</strong> Letter of Intent for the purchase of <strong>{address || dealName || "[PROPERTY ADDRESS], [CITY, STATE]"}</strong> (the &ldquo;Property&rdquo;)</p>

      <p>For your consideration, please find the following Letter of Intent for the above-referenced Property at the terms outlined below.</p>

      <p>This letter sets forth the general terms and conditions for the proposed acquisition of the Property, but shall remain non-binding:</p>

      <p className="font-bold mt-4">Proposed Terms</p>
      <ol className="list-decimal ml-6 space-y-1">
        <li><strong>Purchase Price:</strong> {fmt(data.purchase_price)}</li>
        <li><strong>Terms:</strong> {paymentTerms}</li>
        <li><strong>Earnest Money:</strong> {fmt(data.earnest_money)}{data.earnest_money_hard_days ? ` (non-refundable after ${data.earnest_money_hard_days} days)` : ""}</li>
        <li><strong>Form of PSA:</strong> [PSA TERMS]</li>
        <li><strong>Inspection Contingency:</strong> {fmtDays(data.due_diligence_days)}</li>
        <li><strong>Financing Contingency:</strong> {financingLine}</li>
        <li><strong>Title &amp; Escrow:</strong> [TITLE/ESCROW TERMS]</li>
        <li><strong>Buyer&rsquo;s Broker:</strong> {data.broker_name || "[BROKER NAME / ENTITY]"}{data.broker_commission ? ` — ${data.broker_commission}` : ""}</li>
        <li><strong>Closing Timeline:</strong> {data.closing_days ? `${data.closing_days} days from removal of inspection contingencies` : "[CLOSING TERMS]"}</li>
      </ol>

      <p className="font-bold mt-4">Additional Terms (Optional)</p>
      <ol start={10} className="list-decimal ml-6 space-y-1">
        <li><strong>Seller Representations:</strong> [REPS &amp; WARRANTIES TERMS]</li>
        <li><strong>Assignment:</strong> [ASSIGNMENT RIGHTS]</li>
        <li><strong>Seller&rsquo;s Deliverables:</strong> [DUE DILIGENCE ITEMS]</li>
        <li><strong>Conditions Precedent:</strong> [CONDITIONS]</li>
        {data.additional_terms && (
          <li className="whitespace-pre-wrap">{data.additional_terms}</li>
        )}
      </ol>

      <p className="mt-4">This sets out the key parameters. Please respond by <strong>[RESPONSE DEADLINE DATE]</strong>.</p>

      <p className="text-xs text-gray-600 border-t pt-3 mt-4">
        Please understand that this is not a binding commitment. This letter is not an offer, solicitation of an offer, or an acceptance, and creates no contractual, good faith, or other obligations. Such obligations can be created only by a formal Purchase and Sale Agreement, executed by all parties thereto. The undersigned reserves the right to discontinue discussion at any time, for any reason or for no reason, prior to the mutual execution of a formal Purchase and Sale Agreement. Seller will not have any obligations to Buyer, and Buyer will not acquire any rights or causes of action against Seller, unless Seller and Buyer both execute and deliver the Purchase and Sale Agreement.
      </p>

      <p className="font-bold mt-6">Signatures</p>
      <div className="grid grid-cols-2 gap-8 mt-2 text-sm">
        <div>
          <p className="font-bold">BUYER:</p>
          <div className="border-b border-black mt-8 mb-1" />
          <p className="text-xs">Signature</p>
          <div className="border-b border-black mt-4 mb-1" />
          <p className="text-xs">Printed Name / Title</p>
          <div className="border-b border-black mt-4 mb-1" />
          <p className="text-xs">Date</p>
        </div>
        <div>
          <p className="font-bold">SELLER (ACCEPTANCE):</p>
          <div className="border-b border-black mt-8 mb-1" />
          <p className="text-xs">Signature</p>
          <div className="border-b border-black mt-4 mb-1" />
          <p className="text-xs">Printed Name / Title</p>
          <div className="border-b border-black mt-4 mb-1" />
          <p className="text-xs">Date</p>
        </div>
      </div>
    </div>
  );
}

