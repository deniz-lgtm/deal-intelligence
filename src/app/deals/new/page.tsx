"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Building2, FileText, Loader2, Sparkles, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { DealStatus, PropertyType } from "@/lib/types";

const PROPERTY_TYPES: { value: PropertyType; label: string }[] = [
  { value: "multifamily", label: "Multifamily" },
  { value: "student_housing", label: "Student Housing" },
  { value: "industrial", label: "Industrial" },
  { value: "office", label: "Office" },
  { value: "retail", label: "Retail" },
  { value: "mixed_use", label: "Mixed Use" },
  { value: "land", label: "Land" },
  { value: "hospitality", label: "Hospitality" },
  { value: "other", label: "Other" },
];

const STATUSES: { value: DealStatus; label: string }[] = [
  { value: "sourcing", label: "Sourcing" },
  { value: "screening", label: "Screening" },
  { value: "loi", label: "LOI" },
  { value: "under_contract", label: "Under Contract" },
  { value: "diligence", label: "Diligence" },
  { value: "closing", label: "Closing" },
];

const EMPTY_FORM = {
  name: "",
  address: "",
  city: "",
  state: "",
  zip: "",
  property_type: "multifamily" as PropertyType,
  status: "sourcing" as DealStatus,
  asking_price: "",
  square_footage: "",
  units: "",
  bedrooms: "",
  year_built: "",
  notes: "",
};

export default function NewDealPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [omFile, setOmFile] = useState<File | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const set = (field: string, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  async function handleOmFile(file: File) {
    if (!file.name.match(/\.(pdf|docx?)$/i)) {
      setExtractError("Only PDF or DOCX files are supported");
      return;
    }
    setOmFile(file);
    setExtracting(true);
    setExtractError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/om-extract", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Extraction failed");

      const d = json.data;
      setForm((prev) => ({
        ...prev,
        name: d.name || prev.name,
        address: d.address || prev.address,
        city: d.city || prev.city,
        state: d.state || prev.state,
        zip: d.zip || prev.zip,
        property_type: d.property_type || prev.property_type,
        year_built: d.year_built ? String(d.year_built) : prev.year_built,
        square_footage: d.square_footage ? String(d.square_footage) : prev.square_footage,
        units: d.units ? String(d.units) : prev.units,
        asking_price: d.asking_price ? String(d.asking_price) : prev.asking_price,
      }));
      toast.success("OM data extracted — review and edit below");
    } catch (err) {
      setExtractError(err instanceof Error ? err.message : "Extraction failed");
    } finally {
      setExtracting(false);
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error("Deal name is required");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/deals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          asking_price: form.asking_price ? Number(form.asking_price) : null,
          square_footage: form.square_footage ? Number(form.square_footage) : null,
          units: form.units ? Number(form.units) : null,
          bedrooms: form.bedrooms ? Number(form.bedrooms) : null,
          year_built: form.year_built ? Number(form.year_built) : null,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.data) {
        toast.error(json.error || "Failed to create deal");
        setSaving(false);
        return;
      }

      const dealId = json.data.id;

      if (omFile) {
        const fd = new FormData();
        fd.append("file", omFile);
        await fetch(`/api/deals/${dealId}/om-init`, { method: "POST", body: fd });
        router.push(`/deals/${dealId}/om-analysis`);
      } else {
        toast.success("Deal created with diligence checklist");
        router.push(`/deals/${dealId}`);
      }
    } catch {
      toast.error("Something went wrong");
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card sticky top-0 z-10 shadow-card">
        <div className="max-w-3xl mx-auto px-6 h-14 flex items-center gap-4">
          <Link href="/">
            <Button variant="ghost" size="sm" className="text-xs h-8">
              <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
              Back
            </Button>
          </Link>
          <div className="h-4 w-px bg-border" />
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-muted-foreground" />
            <h1 className="font-semibold text-sm">New Deal</h1>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8">
        <div className="mb-6">
          <h2 className="text-xl font-bold tracking-tight">Create a new deal</h2>
          <p className="text-muted-foreground text-sm mt-1">
            A diligence checklist with 65+ items will be automatically created.
          </p>
        </div>

        {/* OM Upload Zone */}
        <div className="mb-8">
          {omFile ? (
            <div
              className={cn(
                "border rounded-xl p-4 flex items-center gap-3 transition-colors",
                extracting
                  ? "bg-primary/5 border-primary/20"
                  : "bg-emerald-50/50 border-emerald-200"
              )}
            >
              <div
                className={cn(
                  "w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0",
                  extracting ? "bg-primary/10" : "bg-emerald-100"
                )}
              >
                {extracting ? (
                  <Loader2 className="h-4 w-4 text-primary animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4 text-emerald-600" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{omFile.name}</p>
                <p className="text-2xs text-muted-foreground">
                  {extracting
                    ? "Extracting deal details from OM..."
                    : "Fields auto-filled from OM — review below"}
                </p>
              </div>
              {!extracting && (
                <button
                  type="button"
                  onClick={() => {
                    setOmFile(null);
                    setExtractError(null);
                    setForm(EMPTY_FORM);
                  }}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <XCircle className="h-4 w-4" />
                </button>
              )}
            </div>
          ) : (
            <div
              className={cn(
                "border-2 border-dashed rounded-xl p-8 flex flex-col items-center gap-3 cursor-pointer transition-all duration-200",
                dragging
                  ? "border-primary bg-primary/5 shadow-glow-primary"
                  : "border-border hover:border-primary/40 hover:bg-accent/30"
              )}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const file = e.dataTransfer.files[0];
                if (file) handleOmFile(file);
              }}
              onClick={() => inputRef.current?.click()}
            >
              <div className="w-11 h-11 rounded-xl bg-primary/8 flex items-center justify-center">
                <FileText className="h-5 w-5 text-primary" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium">
                  Upload OM to auto-fill details{" "}
                  <span className="text-muted-foreground font-normal">(optional)</span>
                </p>
                <p className="text-2xs text-muted-foreground mt-1">
                  Drag & drop or click — PDF or DOCX. AI extracts address, price, size, and more.
                </p>
              </div>
              <input
                ref={inputRef}
                type="file"
                accept=".pdf,.docx,.doc"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleOmFile(file);
                }}
              />
            </div>
          )}
          {extractError && (
            <p className="text-2xs text-rose-600 mt-2 flex items-center gap-1">
              <XCircle className="h-3 w-3" />
              {extractError}
            </p>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Basic Info */}
          <Section title="Basic Information">
            <div className="grid gap-4">
              <Field label="Deal Name *">
                <input
                  required
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  placeholder="e.g. Hawthorne Industrial, 123 Main St"
                  className="input-field"
                />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Property Type">
                  <select
                    value={form.property_type}
                    onChange={(e) => set("property_type", e.target.value)}
                    className="input-field"
                  >
                    {PROPERTY_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Status">
                  <select
                    value={form.status}
                    onChange={(e) => set("status", e.target.value)}
                    className="input-field"
                  >
                    {STATUSES.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            </div>
          </Section>

          {/* Location */}
          <Section title="Location">
            <div className="grid gap-4">
              <Field label="Street Address">
                <input
                  value={form.address}
                  onChange={(e) => set("address", e.target.value)}
                  placeholder="123 Industrial Ave"
                  className="input-field"
                />
              </Field>
              <div className="grid grid-cols-3 gap-4">
                <Field label="City" className="col-span-1">
                  <input
                    value={form.city}
                    onChange={(e) => set("city", e.target.value)}
                    placeholder="Hawthorne"
                    className="input-field"
                  />
                </Field>
                <Field label="State">
                  <input
                    value={form.state}
                    onChange={(e) => set("state", e.target.value)}
                    placeholder="CA"
                    maxLength={2}
                    className="input-field"
                  />
                </Field>
                <Field label="ZIP">
                  <input
                    value={form.zip}
                    onChange={(e) => set("zip", e.target.value)}
                    placeholder="90250"
                    className="input-field"
                  />
                </Field>
              </div>
            </div>
          </Section>

          {/* Property Details */}
          <Section title="Property Details">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Asking Price ($)">
                <input
                  type="number"
                  value={form.asking_price}
                  onChange={(e) => set("asking_price", e.target.value)}
                  placeholder="5000000"
                  className="input-field tabular-nums"
                />
              </Field>
              <Field label="Square Footage (SF)">
                <input
                  type="number"
                  value={form.square_footage}
                  onChange={(e) => set("square_footage", e.target.value)}
                  placeholder="25000"
                  className="input-field tabular-nums"
                />
              </Field>
              <Field label="Units">
                <input
                  type="number"
                  value={form.units}
                  onChange={(e) => set("units", e.target.value)}
                  placeholder="24"
                  className="input-field tabular-nums"
                />
              </Field>
              <Field label="Total Bedrooms (student housing)">
                <input
                  type="number"
                  value={form.bedrooms}
                  onChange={(e) => set("bedrooms", e.target.value)}
                  placeholder="72"
                  className="input-field tabular-nums"
                />
              </Field>
              <Field label="Year Built">
                <input
                  type="number"
                  value={form.year_built}
                  onChange={(e) => set("year_built", e.target.value)}
                  placeholder="1985"
                  className="input-field tabular-nums"
                />
              </Field>
            </div>
          </Section>

          <div className="flex justify-end gap-3 pt-2">
            <Link href="/">
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </Link>
            <Button type="submit" disabled={saving || extracting}>
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {omFile ? "Creating & analyzing..." : "Creating..."}
                </>
              ) : (
                "Create Deal"
              )}
            </Button>
          </div>
        </form>
      </main>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border rounded-xl p-5 bg-card shadow-card space-y-4">
      <h3 className="font-semibold text-xs text-muted-foreground uppercase tracking-wider">
        {title}
      </h3>
      {children}
    </div>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="block text-sm font-medium mb-1.5">{label}</label>
      {children}
    </div>
  );
}
