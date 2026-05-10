"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, FileQuestion, Save, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NewConstructionRfiPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const dealId = params.id;
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({
    rfi_number: "",
    subject: "",
    submitted_by: "",
    submitted_date: "",
    response_required_by: "",
    discipline: "",
    notes: "",
  });
  const [uploading, setUploading] = useState(false);

  const submit = async () => {
    setUploading(true);
    try {
      const file = fileRef.current?.files?.[0];
      if (file) {
        const fd = new FormData();
        fd.append("file", file);
        for (const [k, v] of Object.entries(form)) {
          if (v) fd.append(k, v);
        }
        if (!form.subject) fd.append("subject", file.name.replace(/\.pdf$/i, ""));
        await fetch(`/api/deals/${dealId}/construction-rfis`, { method: "POST", body: fd });
      } else {
        if (!form.subject.trim()) {
          alert("Subject is required when no file is uploaded.");
          setUploading(false);
          return;
        }
        await fetch(`/api/deals/${dealId}/construction-rfis`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...form,
            subject: form.subject.trim(),
            rfi_number: form.rfi_number || null,
            submitted_by: form.submitted_by || null,
            submitted_date: form.submitted_date || null,
            response_required_by: form.response_required_by || null,
            discipline: form.discipline || null,
            notes: form.notes || null,
          }),
        });
      }
      router.push(`/deals/${dealId}/construction/rfis`);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-5">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href={`/deals/${dealId}/construction/rfis`}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <FileQuestion className="h-5 w-5 text-primary" />
          <h1 className="font-display text-2xl">Upload Construction RFI</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/deals/${dealId}/construction/rfis`}>
            <Button variant="ghost" size="sm" disabled={uploading}>
              <X className="h-3.5 w-3.5 mr-1" /> Cancel
            </Button>
          </Link>
          <Button size="sm" onClick={submit} disabled={uploading}>
            {uploading ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Uploading…</> : <><Save className="h-3.5 w-3.5 mr-1" /> Save RFI</>}
          </Button>
        </div>
      </header>

      <p className="text-xs text-muted-foreground max-w-2xl">
        Upload the contractor's RFI PDF. AI extracts RFI #, subject, submission date, response deadline, and
        discipline automatically. Override any field below if needed.
      </p>

      <div className="rounded-xl border border-border/40 bg-card/40 p-5 max-w-3xl space-y-4">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">RFI PDF</label>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.txt"
            className="w-full text-xs file:mr-2 file:py-1 file:px-3 file:rounded-md file:border-0 file:text-xs file:bg-primary/15 file:text-primary file:cursor-pointer"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">RFI Number</label>
            <input
              className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
              value={form.rfi_number}
              onChange={(e) => setForm({ ...form, rfi_number: e.target.value })}
              placeholder="auto-extracted from PDF"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Discipline</label>
            <select
              className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
              value={form.discipline}
              onChange={(e) => setForm({ ...form, discipline: e.target.value })}
            >
              <option value="">— auto —</option>
              <option value="architectural">Architectural</option>
              <option value="structural">Structural</option>
              <option value="mep">MEP</option>
              <option value="civil">Civil</option>
              <option value="electrical">Electrical</option>
              <option value="plumbing">Plumbing</option>
              <option value="hvac">HVAC</option>
              <option value="fire_life_safety">Fire / Life Safety</option>
              <option value="other">Other</option>
            </select>
          </div>
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Subject (override)</label>
          <input
            className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
            value={form.subject}
            onChange={(e) => setForm({ ...form, subject: e.target.value })}
            placeholder="auto-extracted from PDF"
          />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Submitted By</label>
            <input
              className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
              value={form.submitted_by}
              onChange={(e) => setForm({ ...form, submitted_by: e.target.value })}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Submitted Date</label>
            <input
              type="date"
              className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
              value={form.submitted_date}
              onChange={(e) => setForm({ ...form, submitted_date: e.target.value })}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Response Due</label>
            <input
              type="date"
              className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
              value={form.response_required_by}
              onChange={(e) => setForm({ ...form, response_required_by: e.target.value })}
            />
          </div>
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Internal Notes</label>
          <textarea
            rows={3}
            className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm resize-none"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </div>
      </div>
    </div>
  );
}
