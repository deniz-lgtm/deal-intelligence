"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Award, Save, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NewBidPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const dealId = params.id;
  const [form, setForm] = useState({
    contractor_name: "",
    contractor_company: "",
    contractor_email: "",
    bid_date: "",
    total_amount: "",
    raw_text: "",
    notes: "",
  });
  const [bidFile, setBidFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!form.contractor_name.trim()) {
      alert("Contractor name is required.");
      return;
    }
    setSaving(true);
    try {
      if (bidFile) {
        const fd = new FormData();
        fd.append("file", bidFile);
        fd.append("contractor_name", form.contractor_name);
        if (form.contractor_company) fd.append("contractor_company", form.contractor_company);
        if (form.contractor_email) fd.append("contractor_email", form.contractor_email);
        if (form.bid_date) fd.append("bid_date", form.bid_date);
        if (form.total_amount !== "") fd.append("total_amount", String(form.total_amount));
        if (form.raw_text) fd.append("raw_text", form.raw_text);
        if (form.notes) fd.append("notes", form.notes);
        await fetch(`/api/deals/${dealId}/gc-bids/upload`, { method: "POST", body: fd });
      } else {
        const payload = {
          ...form,
          total_amount: form.total_amount === "" ? null : Number(form.total_amount),
        };
        await fetch(`/api/deals/${dealId}/gc-bids`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
      router.push(`/deals/${dealId}/pre-construction/bids`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href={`/deals/${dealId}/pre-construction/bids`}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <Award className="h-5 w-5 text-primary" />
          <h1 className="font-display text-2xl">Add Contractor Bid</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/deals/${dealId}/pre-construction/bids`}>
            <Button variant="ghost" size="sm" disabled={saving}>
              <X className="h-3.5 w-3.5 mr-1" /> Cancel
            </Button>
          </Link>
          <Button size="sm" onClick={submit} disabled={saving || !form.contractor_name.trim()}>
            {saving ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Uploading…</> : <><Save className="h-3.5 w-3.5 mr-1" /> Save Bid</>}
          </Button>
        </div>
      </header>

      <p className="text-xs text-muted-foreground max-w-2xl">
        Upload the contractor's bid PDF — text gets extracted automatically and fed to AI leveling. You can also paste raw text below
        (cover letter, schedule of values, exclusions) if the bid arrived as an email.
      </p>

      <div className="rounded-xl border border-border/40 bg-card/40 p-5 max-w-3xl space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Contractor <span className="text-red-400">*</span></label>
            <input
              autoFocus
              className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              value={form.contractor_name}
              onChange={(e) => setForm({ ...form, contractor_name: e.target.value })}
              placeholder="Project manager / lead estimator"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Company</label>
            <input
              className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              value={form.contractor_company}
              onChange={(e) => setForm({ ...form, contractor_company: e.target.value })}
              placeholder="Turner Construction"
            />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Email</label>
            <input
              type="email"
              className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              value={form.contractor_email}
              onChange={(e) => setForm({ ...form, contractor_email: e.target.value })}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Bid Date</label>
            <input
              type="date"
              className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
              value={form.bid_date}
              onChange={(e) => setForm({ ...form, bid_date: e.target.value })}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Total Amount ($)</label>
            <input
              type="number"
              min={0}
              className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
              value={form.total_amount}
              onChange={(e) => setForm({ ...form, total_amount: e.target.value })}
            />
          </div>
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">
            Bid PDF
            <span className="text-muted-foreground/60 ml-1 normal-case">— upload the contractor's bid (PDF preferred). Text gets extracted automatically.</span>
          </label>
          <input
            type="file"
            accept=".pdf,.txt"
            className="w-full text-xs file:mr-2 file:py-1 file:px-3 file:rounded-md file:border-0 file:text-xs file:bg-primary/15 file:text-primary file:cursor-pointer"
            onChange={(e) => setBidFile(e.target.files?.[0] ?? null)}
          />
          {bidFile && (
            <div className="text-2xs text-muted-foreground mt-1">
              Selected: {bidFile.name} ({(bidFile.size / 1024 / 1024).toFixed(1)} MB)
            </div>
          )}
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">
            Raw Bid Content (optional if PDF uploaded)
            <span className="text-muted-foreground/60 ml-1 normal-case">— paste cover letter / SOV / exclusions; appended to PDF text.</span>
          </label>
          <textarea
            rows={8}
            className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary font-mono"
            value={form.raw_text}
            onChange={(e) => setForm({ ...form, raw_text: e.target.value })}
            placeholder="Optional. Useful when the bid arrives as an email or you want to add scope clarifications the AI leveler should consider."
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Internal Notes</label>
          <textarea
            rows={2}
            className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary resize-none"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </div>
      </div>
    </div>
  );
}
