"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Building2,
  FileText,
  Loader2,
  Sparkles,
  XCircle,
  Link2,
  MapPin,
  Check,
  Pencil,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { PropertyType } from "@/lib/types";

type IntakeMode = "om" | "url" | "address";

interface Extracted {
  name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  property_type: PropertyType | null;
  year_built: number | null;
  square_footage: number | null;
  units: number | null;
  asking_price: number | null;
  land_acres: number | null;
  notes: string | null;
  source: string | null;
}

const EMPTY: Extracted = {
  name: null,
  address: null,
  city: null,
  state: null,
  zip: null,
  property_type: null,
  year_built: null,
  square_footage: null,
  units: null,
  asking_price: null,
  land_acres: null,
  notes: null,
  source: null,
};

const PROPERTY_TYPES: PropertyType[] = [
  "multifamily",
  "sfr",
  "student_housing",
  "industrial",
  "office",
  "retail",
  "mixed_use",
  "land",
  "hospitality",
  "other",
];

export default function NewDealPage() {
  const router = useRouter();

  // Phase: "intake" → user picks a mode and provides input
  //        "review" → extracted data shown as editable chips
  const [phase, setPhase] = useState<"intake" | "review">("intake");

  const [mode, setMode] = useState<IntakeMode>("om");
  const [omFile, setOmFile] = useState<File | null>(null);
  const [listingUrl, setListingUrl] = useState("");
  const [addr, setAddr] = useState({ address: "", city: "", state: "", zip: "" });
  const [dragging, setDragging] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [data, setData] = useState<Extracted>(EMPTY);
  const [saving, setSaving] = useState(false);

  function patch(p: Partial<Extracted>) {
    setData((prev) => ({ ...prev, ...p }));
  }

  async function runOm(file: File) {
    if (!file.name.match(/\.(pdf|docx?)$/i)) {
      setError("Only PDF or DOCX files are supported");
      return;
    }
    setWorking(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/om-extract", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Extraction failed");
      setData({ ...EMPTY, ...json.data, source: `OM: ${file.name}` });
      setOmFile(file);
      setPhase("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Extraction failed");
    } finally {
      setWorking(false);
    }
  }

  async function runUrl() {
    if (!listingUrl.trim()) return;
    setWorking(true);
    setError(null);
    try {
      const res = await fetch("/api/listing-extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: listingUrl.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Extraction failed");
      setData({
        ...EMPTY,
        ...json.data,
        notes: json.data?.description ?? null,
        source: listingUrl.trim(),
      });
      setPhase("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to extract listing");
    } finally {
      setWorking(false);
    }
  }

  async function runAddress() {
    if (!addr.address || !addr.city || !addr.state) {
      setError("Need at least street, city, and state");
      return;
    }
    setWorking(true);
    setError(null);
    try {
      const res = await fetch("/api/address-enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...addr, property_type: "multifamily" }),
      });
      const json = await res.json();
      // Address enrichment can return partial / empty — that's fine.
      const d = res.ok ? json.data ?? {} : {};
      setData({
        ...EMPTY,
        ...addr,
        name: d.name ?? null,
        property_type: d.property_type ?? null,
        year_built: d.year_built ?? null,
        square_footage: d.square_footage ?? null,
        units: d.units ?? null,
        asking_price: d.asking_price ?? null,
        notes: d.description ?? null,
        source: `Address lookup: ${addr.address}`,
      });
      setPhase("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Address lookup failed");
    } finally {
      setWorking(false);
    }
  }

  async function handleSave() {
    if (!data.name && !data.address) {
      toast.error("Need a deal name or an address before saving");
      return;
    }
    setSaving(true);
    try {
      const body = {
        name: data.name || data.address || "Untitled Deal",
        address: data.address ?? "",
        city: data.city ?? "",
        state: data.state ?? "",
        zip: data.zip ?? "",
        property_type: data.property_type ?? "multifamily",
        status: "sourcing",
        asking_price: data.asking_price,
        square_footage: data.square_footage,
        units: data.units,
        year_built: data.year_built,
        land_acres: data.land_acres,
        notes: data.notes,
      };
      const res = await fetch("/api/deals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.data) {
        toast.error(json.error || "Failed to create deal");
        setSaving(false);
        return;
      }
      const dealId = json.data.id;

      // If we have an OM file, kick off the deeper analysis in the background.
      if (omFile) {
        const fd = new FormData();
        fd.append("file", omFile);
        fetch(`/api/deals/${dealId}/om-init`, { method: "POST", body: fd }).catch(() => {});
        toast.success("Deal saved — analyzing OM in background");
        router.push(`/deals/${dealId}/underwriting`);
        return;
      }

      toast.success("Deal saved");
      router.push(`/deals/${dealId}/underwriting`);
    } catch {
      toast.error("Something went wrong");
      setSaving(false);
    }
  }

  function reset() {
    setPhase("intake");
    setOmFile(null);
    setListingUrl("");
    setAddr({ address: "", city: "", state: "", zip: "" });
    setData(EMPTY);
    setError(null);
  }

  return (
    <div className="min-h-screen bg-background noise">
      <header className="border-b border-border/40 bg-card/80 backdrop-blur-xl sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-6 h-14 flex items-center gap-4">
          <Link href="/">
            <Button variant="ghost" size="sm" className="text-xs h-8">
              <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
              Back
            </Button>
          </Link>
          <div className="h-4 w-px bg-border/40" />
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-muted-foreground" />
            <h1 className="font-nameplate text-base leading-none tracking-tight">New Deal</h1>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8">
        {phase === "intake" ? (
          <IntakeScreen
            mode={mode}
            setMode={setMode}
            omFile={omFile}
            listingUrl={listingUrl}
            setListingUrl={setListingUrl}
            addr={addr}
            setAddr={setAddr}
            dragging={dragging}
            setDragging={setDragging}
            working={working}
            error={error}
            inputRef={inputRef}
            onOmFile={runOm}
            onRunUrl={runUrl}
            onRunAddress={runAddress}
          />
        ) : (
          <ReviewScreen
            data={data}
            patch={patch}
            saving={saving}
            onSave={handleSave}
            onReset={reset}
          />
        )}
      </main>
    </div>
  );
}

// ─── Intake screen ─────────────────────────────────────────────────────────

interface IntakeProps {
  mode: IntakeMode;
  setMode: (m: IntakeMode) => void;
  omFile: File | null;
  listingUrl: string;
  setListingUrl: (s: string) => void;
  addr: { address: string; city: string; state: string; zip: string };
  setAddr: (a: { address: string; city: string; state: string; zip: string }) => void;
  dragging: boolean;
  setDragging: (b: boolean) => void;
  working: boolean;
  error: string | null;
  inputRef: React.RefObject<HTMLInputElement>;
  onOmFile: (file: File) => void;
  onRunUrl: () => void;
  onRunAddress: () => void;
}

function IntakeScreen(p: IntakeProps) {
  return (
    <>
      <div className="mb-8">
        <h2 className="font-nameplate text-3xl leading-none tracking-tight">Drop in a deal</h2>
        <p className="text-muted-foreground text-sm mt-1.5">
          Upload the OM, paste a listing link, or type an address. I'll pull what I can
          and let you confirm before saving.
        </p>
      </div>

      {/* Mode tabs */}
      <div className="flex items-center gap-1 mb-5 p-1 rounded-lg bg-muted/30 border border-border/40 w-fit">
        <ModeTab active={p.mode === "om"} onClick={() => p.setMode("om")} icon={<FileText className="h-3.5 w-3.5" />} label="OM upload" />
        <ModeTab active={p.mode === "url"} onClick={() => p.setMode("url")} icon={<Link2 className="h-3.5 w-3.5" />} label="Listing URL" />
        <ModeTab active={p.mode === "address"} onClick={() => p.setMode("address")} icon={<MapPin className="h-3.5 w-3.5" />} label="Address" />
      </div>

      {p.mode === "om" && (
        <div
          className={cn(
            "border-2 border-dashed rounded-xl p-10 flex flex-col items-center gap-3 cursor-pointer transition-all duration-200",
            p.dragging
              ? "border-primary bg-primary/5"
              : "border-border/60 hover:border-primary/40 hover:bg-muted/20",
            p.working && "pointer-events-none opacity-60"
          )}
          onDragOver={(e) => {
            e.preventDefault();
            p.setDragging(true);
          }}
          onDragLeave={() => p.setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            p.setDragging(false);
            const file = e.dataTransfer.files[0];
            if (file) p.onOmFile(file);
          }}
          onClick={() => p.inputRef.current?.click()}
        >
          <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
            {p.working ? (
              <Loader2 className="h-5 w-5 text-primary animate-spin" />
            ) : (
              <FileText className="h-5 w-5 text-primary" />
            )}
          </div>
          <div className="text-center">
            <p className="text-sm font-medium">
              {p.working ? "Reading the OM..." : "Drag & drop or click to upload"}
            </p>
            <p className="text-2xs text-muted-foreground mt-1">
              PDF or DOCX. AI extracts address, price, size, units, year built.
            </p>
          </div>
          <input
            ref={p.inputRef}
            type="file"
            accept=".pdf,.docx,.doc"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) p.onOmFile(f);
            }}
          />
        </div>
      )}

      {p.mode === "url" && (
        <div className="border border-border/60 rounded-xl p-6 bg-card">
          <label className="block text-sm font-medium mb-2">Listing URL</label>
          <div className="flex items-center gap-2">
            <div
              className={cn(
                "flex-1 flex items-center gap-2 border rounded-lg px-3 py-2.5 transition-colors",
                p.working ? "bg-primary/5 border-primary/20" : "border-border/60 hover:border-primary/40"
              )}
            >
              <Link2 className={cn("h-4 w-4 flex-shrink-0", p.working ? "text-primary" : "text-muted-foreground")} />
              <input
                type="url"
                value={p.listingUrl}
                onChange={(e) => p.setListingUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    p.onRunUrl();
                  }
                }}
                placeholder="https://www.loopnet.com/listing/..."
                className="flex-1 text-sm bg-transparent outline-none placeholder:text-muted-foreground/50"
                disabled={p.working}
                autoFocus
              />
            </div>
            <Button onClick={p.onRunUrl} disabled={p.working || !p.listingUrl.trim()}>
              {p.working ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  Reading...
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                  Extract
                </>
              )}
            </Button>
          </div>
          <p className="text-2xs text-muted-foreground mt-2">
            LoopNet, Crexi, CoStar, or any property listing.
          </p>
        </div>
      )}

      {p.mode === "address" && (
        <div className="border border-border/60 rounded-xl p-6 bg-card">
          <div className="grid gap-4">
            <Field label="Street Address">
              <input
                value={p.addr.address}
                onChange={(e) => p.setAddr({ ...p.addr, address: e.target.value })}
                placeholder="123 Industrial Ave"
                className="input-field"
                autoFocus
              />
            </Field>
            <div className="grid grid-cols-3 gap-4">
              <Field label="City">
                <input
                  value={p.addr.city}
                  onChange={(e) => p.setAddr({ ...p.addr, city: e.target.value })}
                  placeholder="San Diego"
                  className="input-field"
                />
              </Field>
              <Field label="State">
                <input
                  value={p.addr.state}
                  onChange={(e) => p.setAddr({ ...p.addr, state: e.target.value.toUpperCase() })}
                  placeholder="CA"
                  maxLength={2}
                  className="input-field"
                />
              </Field>
              <Field label="ZIP">
                <input
                  value={p.addr.zip}
                  onChange={(e) => p.setAddr({ ...p.addr, zip: e.target.value })}
                  placeholder="92103"
                  className="input-field"
                />
              </Field>
            </div>
            <div className="flex items-center justify-end pt-1">
              <Button
                onClick={p.onRunAddress}
                disabled={p.working || !p.addr.address || !p.addr.city || !p.addr.state}
              >
                {p.working ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                    Looking up...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                    Look up address
                  </>
                )}
              </Button>
            </div>
            <p className="text-2xs text-muted-foreground">
              AI searches public records and listing aggregators. Skip the lookup by
              entering nothing — you can fill it in by hand on the next screen.
            </p>
            <div className="flex items-center justify-end -mt-1">
              <button
                type="button"
                onClick={p.onRunAddress}
                className="text-2xs text-muted-foreground hover:text-foreground underline"
              >
                Or skip lookup — just save these fields
              </button>
            </div>
          </div>
        </div>
      )}

      {p.error && (
        <div className="mt-4 flex items-center gap-2 text-sm text-red-400">
          <XCircle className="h-4 w-4 flex-shrink-0" />
          <span>{p.error}</span>
        </div>
      )}
    </>
  );
}

function ModeTab({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
        active
          ? "bg-card text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      {icon}
      {label}
    </button>
  );
}

// ─── Review screen ─────────────────────────────────────────────────────────

function ReviewScreen({
  data,
  patch,
  saving,
  onSave,
  onReset,
}: {
  data: Extracted;
  patch: (p: Partial<Extracted>) => void;
  saving: boolean;
  onSave: () => void;
  onReset: () => void;
}) {
  return (
    <>
      <div className="mb-6">
        <h2 className="font-nameplate text-3xl leading-none tracking-tight">Confirm the basics</h2>
        <p className="text-muted-foreground text-sm mt-1.5">
          Edit any chip that's wrong, then save to start underwriting.
          {data.source && (
            <span className="ml-2 text-2xs text-muted-foreground/70 italic">
              Source: {data.source}
            </span>
          )}
        </p>
      </div>

      <div className="border border-border/60 rounded-xl bg-card p-5 space-y-2">
        <Chip
          label="Deal name"
          value={data.name}
          onChange={(v) => patch({ name: v })}
          placeholder="e.g. North Park Site"
        />
        <Chip
          label="Address"
          value={data.address}
          onChange={(v) => patch({ address: v })}
          placeholder="123 Main St"
        />
        <div className="grid grid-cols-3 gap-2">
          <Chip label="City" value={data.city} onChange={(v) => patch({ city: v })} />
          <Chip label="State" value={data.state} onChange={(v) => patch({ state: v?.toUpperCase() ?? null })} />
          <Chip label="ZIP" value={data.zip} onChange={(v) => patch({ zip: v })} />
        </div>
        <SelectChip
          label="Property type"
          value={data.property_type}
          options={PROPERTY_TYPES.map((t) => ({ value: t, label: prettyType(t) }))}
          onChange={(v) => patch({ property_type: (v as PropertyType) ?? null })}
        />
        <div className="grid grid-cols-2 gap-2">
          <NumberChip
            label="Asking price"
            value={data.asking_price}
            onChange={(v) => patch({ asking_price: v })}
            prefix="$"
            placeholder="5,000,000"
          />
          <NumberChip
            label="Land (acres)"
            value={data.land_acres}
            onChange={(v) => patch({ land_acres: v })}
            placeholder="2.5"
            step="0.01"
          />
          <NumberChip
            label="Square footage"
            value={data.square_footage}
            onChange={(v) => patch({ square_footage: v })}
            placeholder="25,000"
          />
          <NumberChip
            label="Units"
            value={data.units}
            onChange={(v) => patch({ units: v })}
            placeholder="24"
          />
          <NumberChip
            label="Year built"
            value={data.year_built}
            onChange={(v) => patch({ year_built: v })}
            placeholder="1985"
          />
        </div>
        <Chip
          label="Notes"
          value={data.notes}
          onChange={(v) => patch({ notes: v })}
          placeholder="Anything worth remembering — entitlement angle, broker, rents..."
          multiline
        />
      </div>

      <div className="flex items-center justify-between gap-3 pt-5">
        <Button type="button" variant="ghost" onClick={onReset} disabled={saving}>
          <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
          Start over
        </Button>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={onSave} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                Saving...
              </>
            ) : (
              <>
                <Check className="h-3.5 w-3.5 mr-1.5" />
                Save & underwrite
              </>
            )}
          </Button>
        </div>
      </div>
    </>
  );
}

// ─── Inline-edit chips ─────────────────────────────────────────────────────

function Chip({
  label,
  value,
  onChange,
  placeholder,
  multiline,
}: {
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
  placeholder?: string;
  multiline?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");

  function commit() {
    onChange(draft.trim() || null);
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="flex items-start gap-2 py-2 px-3 rounded-lg bg-primary/5 border border-primary/20">
        <div className="text-2xs uppercase tracking-wider text-muted-foreground w-28 flex-shrink-0 pt-1.5">
          {label}
        </div>
        <div className="flex-1">
          {multiline ? (
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={placeholder}
              autoFocus
              rows={3}
              className="w-full text-sm bg-transparent outline-none resize-none"
              onBlur={commit}
            />
          ) : (
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={placeholder}
              autoFocus
              className="w-full text-sm bg-transparent outline-none"
              onKeyDown={(e) => {
                if (e.key === "Enter") commit();
                if (e.key === "Escape") {
                  setDraft(value ?? "");
                  setEditing(false);
                }
              }}
              onBlur={commit}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        setDraft(value ?? "");
        setEditing(true);
      }}
      className="w-full flex items-start gap-2 py-2 px-3 rounded-lg hover:bg-muted/30 transition-colors text-left group"
    >
      <div className="text-2xs uppercase tracking-wider text-muted-foreground w-28 flex-shrink-0 pt-0.5">
        {label}
      </div>
      <div className="flex-1 min-w-0">
        {value ? (
          <div className="text-sm whitespace-pre-wrap break-words">{value}</div>
        ) : (
          <div className="text-sm text-muted-foreground/60 italic">{placeholder ?? "—"}</div>
        )}
      </div>
      <Pencil className="h-3 w-3 text-muted-foreground/40 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 mt-1" />
    </button>
  );
}

function NumberChip({
  label,
  value,
  onChange,
  placeholder,
  prefix,
  step,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  placeholder?: string;
  prefix?: string;
  step?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value?.toString() ?? "");

  function commit() {
    const n = draft.trim() === "" ? null : Number(draft.replace(/,/g, ""));
    onChange(Number.isFinite(n as number) ? (n as number) : null);
    setEditing(false);
  }

  const display = value == null ? null : `${prefix ?? ""}${value.toLocaleString()}`;

  if (editing) {
    return (
      <div className="flex items-center gap-2 py-2 px-3 rounded-lg bg-primary/5 border border-primary/20">
        <div className="text-2xs uppercase tracking-wider text-muted-foreground flex-shrink-0">
          {label}
        </div>
        <input
          type="number"
          step={step}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          autoFocus
          className="flex-1 min-w-0 text-sm bg-transparent outline-none tabular-nums text-right"
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setDraft(value?.toString() ?? "");
              setEditing(false);
            }
          }}
          onBlur={commit}
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        setDraft(value?.toString() ?? "");
        setEditing(true);
      }}
      className="flex items-center justify-between gap-2 py-2 px-3 rounded-lg hover:bg-muted/30 transition-colors text-left group"
    >
      <div className="text-2xs uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="text-sm tabular-nums">
        {display ?? <span className="text-muted-foreground/60 italic">{placeholder ?? "—"}</span>}
      </div>
    </button>
  );
}

function SelectChip({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | null;
  options: { value: string; label: string }[];
  onChange: (v: string | null) => void;
}) {
  return (
    <div className="flex items-center gap-2 py-2 px-3 rounded-lg hover:bg-muted/30 transition-colors">
      <div className="text-2xs uppercase tracking-wider text-muted-foreground w-28 flex-shrink-0">
        {label}
      </div>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="flex-1 text-sm bg-transparent outline-none cursor-pointer"
      >
        <option value="">— select —</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
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

function prettyType(t: PropertyType): string {
  return t
    .split("_")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}
