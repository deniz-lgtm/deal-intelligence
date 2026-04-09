"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Loader2,
  Plus,
  Trash2,
  Sparkles,
  Save,
  MapPin,
  MapPinned,
  ChevronDown,
  ChevronRight,
  AlertCircle,
  ClipboardPaste,
  Check,
  X,
  FileSearch,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { Comp, SubmarketMetrics } from "@/lib/types";

// ── Helpers ──────────────────────────────────────────────────────────────────

const fn = (n: number | null | undefined, digits = 0) =>
  n == null ? "—" : Number(n).toLocaleString("en-US", { maximumFractionDigits: digits });
const fc = (n: number | null | undefined) =>
  n == null ? "—" : "$" + Math.round(Number(n)).toLocaleString("en-US");
const fpct = (n: number | null | undefined, digits = 1) =>
  n == null ? "—" : Number(n).toFixed(digits) + "%";

function Section({
  title,
  icon,
  children,
  action,
  defaultOpen = true,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  action?: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-border/60 rounded-xl bg-card shadow-card overflow-hidden">
      <div className="w-full flex items-center gap-3 px-5 py-3.5 bg-muted/20 text-left">
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-3 flex-1 hover:opacity-80"
        >
          {open ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground/60" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground/60" />
          )}
          <span className="flex items-center gap-2">
            {icon}
            <span className="font-semibold text-sm">{title}</span>
          </span>
        </button>
        {action}
      </div>
      {open && <div className="px-5 py-4">{children}</div>}
    </div>
  );
}

function FieldInput({
  label,
  value,
  onChange,
  suffix,
  type = "text",
}: {
  label: string;
  value: string | number | null;
  onChange: (v: string) => void;
  suffix?: string;
  type?: string;
}) {
  return (
    <div>
      <label className="block text-[10px] text-muted-foreground uppercase tracking-wide mb-1">
        {label}
      </label>
      <div className="flex items-center border border-border/40 rounded-lg bg-muted/20 overflow-hidden">
        <input
          type={type}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder="—"
          className="flex-1 px-3 py-1.5 text-sm bg-transparent outline-none"
        />
        {suffix && (
          <span className="px-2 text-xs text-muted-foreground bg-muted/30 border-l border-border/40 py-1.5">
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

interface SubjectDeal {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  lat: number | null;
  lng: number | null;
}

// Haversine distance in miles between two WGS84 coordinates.
function haversineMiles(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 3958.8; // Earth radius in miles
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export default function CompsPage({ params }: { params: { id: string } }) {
  const [loading, setLoading] = useState(true);
  const [saleComps, setSaleComps] = useState<Comp[]>([]);
  const [rentComps, setRentComps] = useState<Comp[]>([]);
  const [submarket, setSubmarket] = useState<Partial<SubmarketMetrics>>({});
  const [submarketDirty, setSubmarketDirty] = useState(false);
  const [submarketSaving, setSubmarketSaving] = useState(false);
  const [subject, setSubject] = useState<SubjectDeal | null>(null);
  const [radiusMiles, setRadiusMiles] = useState<number | null>(null);
  const [geocodingSubject, setGeocodingSubject] = useState(false);

  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteType, setPasteType] = useState<"sale" | "rent">("sale");
  const [docExtractOpen, setDocExtractOpen] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [compsRes, metricsRes, dealRes] = await Promise.all([
        fetch(`/api/deals/${params.id}/comps`).then((r) => r.json()),
        fetch(`/api/deals/${params.id}/submarket-metrics`).then((r) => r.json()),
        fetch(`/api/deals/${params.id}`).then((r) => r.json()),
      ]);
      const all: Comp[] = compsRes.data || [];
      setSaleComps(all.filter((c) => c.comp_type === "sale"));
      setRentComps(all.filter((c) => c.comp_type === "rent"));
      setSubmarket(metricsRes.data || {});
      setSubject(dealRes.data || null);
    } catch (err) {
      console.error(err);
      toast.error("Failed to load comps");
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  async function handleGeocodeSubject() {
    setGeocodingSubject(true);
    try {
      const res = await fetch(`/api/deals/${params.id}/geocode`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || "Failed to geocode subject deal");
        return;
      }
      toast.success("Subject deal geocoded");
      loadData();
    } finally {
      setGeocodingSubject(false);
    }
  }

  // Compute distance for each comp from the subject (or null if either side
  // doesn't have coordinates). We store the derived distance alongside the
  // comp so CompTable can render a column without reaching back up.
  const annotate = useCallback(
    (comps: Comp[]): Array<Comp & { _subjectDistance: number | null }> => {
      if (!subject?.lat || !subject?.lng) {
        return comps.map((c) => ({ ...c, _subjectDistance: null }));
      }
      return comps.map((c) => {
        if (c.lat == null || c.lng == null) {
          return { ...c, _subjectDistance: null };
        }
        return {
          ...c,
          _subjectDistance: haversineMiles(
            Number(subject.lat),
            Number(subject.lng),
            Number(c.lat),
            Number(c.lng)
          ),
        };
      });
    },
    [subject]
  );

  const annotatedSale = annotate(saleComps);
  const annotatedRent = annotate(rentComps);

  // Apply radius filter if set
  const inRadius = (
    list: Array<Comp & { _subjectDistance: number | null }>
  ) => {
    if (radiusMiles == null) return list;
    return list.filter(
      (c) => c._subjectDistance != null && c._subjectDistance <= radiusMiles
    );
  };
  const filteredSale = inRadius(annotatedSale);
  const filteredRent = inRadius(annotatedRent);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleDeleteComp(compId: string) {
    if (!confirm("Delete this comp?")) return;
    try {
      await fetch(`/api/deals/${params.id}/comps/${compId}`, { method: "DELETE" });
      toast.success("Deleted");
      loadData();
    } catch {
      toast.error("Delete failed");
    }
  }

  async function handleToggleSelected(comp: Comp) {
    try {
      await fetch(`/api/deals/${params.id}/comps/${comp.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selected: !comp.selected }),
      });
      loadData();
    } catch {
      toast.error("Update failed");
    }
  }

  async function handleSaveToWorkspace(comp: Comp) {
    try {
      const res = await fetch(
        `/api/deals/${params.id}/comps/${comp.id}/to-workspace`,
        { method: "POST" }
      );
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        toast.error(json.error || "Failed to save to workspace");
        return;
      }
      toast.success("Saved to Comps Library");
    } catch {
      toast.error("Failed to save to workspace");
    }
  }

  async function saveSubmarket() {
    setSubmarketSaving(true);
    try {
      const body = {
        submarket_name: submarket.submarket_name ?? null,
        msa: submarket.msa ?? null,
        market_cap_rate: submarket.market_cap_rate ?? null,
        market_rent_growth: submarket.market_rent_growth ?? null,
        market_vacancy: submarket.market_vacancy ?? null,
        absorption_units: submarket.absorption_units ?? null,
        deliveries_units: submarket.deliveries_units ?? null,
        narrative: submarket.narrative ?? null,
        sources: submarket.sources ?? [],
      };
      await fetch(`/api/deals/${params.id}/submarket-metrics`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setSubmarketDirty(false);
      toast.success("Market metrics saved");
    } catch {
      toast.error("Save failed");
    } finally {
      setSubmarketSaving(false);
    }
  }

  function openPaste(type: "sale" | "rent") {
    setPasteType(type);
    setPasteOpen(true);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-24">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-display font-semibold">Comps &amp; Market</h1>
          <p className="text-xs text-muted-foreground mt-1">
            Sale and rent comparables, plus submarket context. Add comps by pasting
            listing text or extracting from an uploaded market document.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setDocExtractOpen(true)}
        >
          <FileSearch className="h-3.5 w-3.5 mr-1.5" />
          Extract from Market Docs
        </Button>
      </div>

      {/* Legal / posture note */}
      <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20 text-amber-200/80 text-xs">
        <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
        <span>
          User-sourced only: we never auto-fetch broker sites server-side. Pull
          content from CoStar / LoopNet / Crexi / Zillow under your own session and
          paste it here, or upload market studies and appraisals to the Documents
          tab and click <em>Extract from Market Docs</em>.
        </span>
      </div>

      {/* Submarket metrics */}
      <Section
        title="Submarket Metrics"
        icon={<MapPin className="h-4 w-4 text-primary" />}
        action={
          submarketDirty ? (
            <Button
              size="sm"
              variant="default"
              onClick={saveSubmarket}
              disabled={submarketSaving}
            >
              {submarketSaving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              <span className="ml-1.5">Save</span>
            </Button>
          ) : null
        }
      >
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <FieldInput
            label="Submarket"
            value={submarket.submarket_name ?? ""}
            onChange={(v) => {
              setSubmarket({ ...submarket, submarket_name: v });
              setSubmarketDirty(true);
            }}
          />
          <FieldInput
            label="MSA"
            value={submarket.msa ?? ""}
            onChange={(v) => {
              setSubmarket({ ...submarket, msa: v });
              setSubmarketDirty(true);
            }}
          />
          <FieldInput
            label="Market Cap Rate"
            type="number"
            suffix="%"
            value={submarket.market_cap_rate ?? ""}
            onChange={(v) => {
              setSubmarket({ ...submarket, market_cap_rate: v ? Number(v) : null });
              setSubmarketDirty(true);
            }}
          />
          <FieldInput
            label="Market Vacancy"
            type="number"
            suffix="%"
            value={submarket.market_vacancy ?? ""}
            onChange={(v) => {
              setSubmarket({ ...submarket, market_vacancy: v ? Number(v) : null });
              setSubmarketDirty(true);
            }}
          />
          <FieldInput
            label="Rent Growth"
            type="number"
            suffix="%/yr"
            value={submarket.market_rent_growth ?? ""}
            onChange={(v) => {
              setSubmarket({ ...submarket, market_rent_growth: v ? Number(v) : null });
              setSubmarketDirty(true);
            }}
          />
          <FieldInput
            label="Absorption"
            type="number"
            suffix="units/yr"
            value={submarket.absorption_units ?? ""}
            onChange={(v) => {
              setSubmarket({ ...submarket, absorption_units: v ? Number(v) : null });
              setSubmarketDirty(true);
            }}
          />
          <FieldInput
            label="Deliveries"
            type="number"
            suffix="units/yr"
            value={submarket.deliveries_units ?? ""}
            onChange={(v) => {
              setSubmarket({ ...submarket, deliveries_units: v ? Number(v) : null });
              setSubmarketDirty(true);
            }}
          />
        </div>
        <div className="mt-4">
          <label className="block text-[10px] text-muted-foreground uppercase tracking-wide mb-1">
            Market Narrative
          </label>
          <textarea
            value={submarket.narrative ?? ""}
            onChange={(e) => {
              setSubmarket({ ...submarket, narrative: e.target.value });
              setSubmarketDirty(true);
            }}
            placeholder="Submarket context, demand drivers, supply pipeline…"
            rows={3}
            className="w-full px-3 py-2 text-sm bg-muted/20 border border-border/40 rounded-lg outline-none resize-none focus:border-primary/40"
          />
        </div>
      </Section>

      {/* Distance filter (only when subject has coords) */}
      {!subject?.lat || !subject?.lng ? (
        <div className="flex items-center justify-between gap-3 p-3 rounded-lg bg-muted/10 border border-border/30 text-xs">
          <div className="flex items-center gap-2 text-muted-foreground">
            <MapPinned className="h-3.5 w-3.5 flex-shrink-0" />
            <span>
              Geocode this deal to show distance-from-subject for comps and
              unlock the radius filter.
            </span>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={handleGeocodeSubject}
            disabled={geocodingSubject || !subject?.address}
          >
            {geocodingSubject ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
            ) : (
              <MapPinned className="h-3.5 w-3.5 mr-1.5" />
            )}
            Geocode Subject
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-primary/5 border border-primary/20 text-xs">
          <MapPinned className="h-3.5 w-3.5 text-primary flex-shrink-0" />
          <span className="text-muted-foreground">
            Subject:{" "}
            <span className="text-foreground font-medium">
              {[subject.address, subject.city, subject.state]
                .filter(Boolean)
                .join(", ")}
            </span>
          </span>
          <div className="flex-1" />
          <label className="flex items-center gap-2 text-muted-foreground">
            <span>Within</span>
            <input
              type="number"
              min="0"
              step="0.5"
              value={radiusMiles ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                setRadiusMiles(v === "" ? null : Math.max(0, Number(v)));
              }}
              placeholder="—"
              className="w-16 px-2 py-1 text-xs bg-muted/20 border border-border/40 rounded outline-none focus:border-primary/40 text-right"
            />
            <span>mi</span>
            {radiusMiles != null && (
              <button
                onClick={() => setRadiusMiles(null)}
                className="text-muted-foreground hover:text-foreground"
                title="Clear radius filter"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </label>
        </div>
      )}

      {/* Sale comps */}
      <Section
        title={`Sale Comps (${filteredSale.length}${radiusMiles != null && filteredSale.length !== saleComps.length ? ` / ${saleComps.length}` : ""})`}
        action={
          <Button size="sm" variant="outline" onClick={() => openPaste("sale")}>
            <ClipboardPaste className="h-3.5 w-3.5 mr-1.5" />
            Paste Listing
          </Button>
        }
      >
        {filteredSale.length === 0 ? (
          saleComps.length === 0 ? (
            <EmptyState type="sale" onAdd={() => openPaste("sale")} />
          ) : (
            <div className="text-center py-8 text-xs text-muted-foreground">
              No sale comps within {radiusMiles} miles of the subject.
            </div>
          )
        ) : (
          <CompTable comps={filteredSale} type="sale" showDistance={!!(subject?.lat && subject?.lng)} onToggle={handleToggleSelected} onDelete={handleDeleteComp} onSaveToWorkspace={handleSaveToWorkspace} />
        )}
      </Section>

      {/* Rent comps */}
      <Section
        title={`Rent Comps (${filteredRent.length}${radiusMiles != null && filteredRent.length !== rentComps.length ? ` / ${rentComps.length}` : ""})`}
        action={
          <Button size="sm" variant="outline" onClick={() => openPaste("rent")}>
            <ClipboardPaste className="h-3.5 w-3.5 mr-1.5" />
            Paste Listing
          </Button>
        }
      >
        {filteredRent.length === 0 ? (
          rentComps.length === 0 ? (
            <EmptyState type="rent" onAdd={() => openPaste("rent")} />
          ) : (
            <div className="text-center py-8 text-xs text-muted-foreground">
              No rent comps within {radiusMiles} miles of the subject.
            </div>
          )
        ) : (
          <CompTable comps={filteredRent} type="rent" showDistance={!!(subject?.lat && subject?.lng)} onToggle={handleToggleSelected} onDelete={handleDeleteComp} onSaveToWorkspace={handleSaveToWorkspace} />
        )}
      </Section>

      {/* Paste modal */}
      {pasteOpen && (
        <PasteCompModal
          dealId={params.id}
          compType={pasteType}
          onClose={() => setPasteOpen(false)}
          onSaved={() => {
            setPasteOpen(false);
            loadData();
          }}
        />
      )}

      {/* Extract-from-doc modal */}
      {docExtractOpen && (
        <ExtractFromDocModal
          dealId={params.id}
          onClose={() => setDocExtractOpen(false)}
          onSaved={() => {
            setDocExtractOpen(false);
            loadData();
          }}
        />
      )}
    </div>
  );
}

// ── Comp table ────────────────────────────────────────────────────────────

function CompTable({
  comps,
  type,
  showDistance,
  onToggle,
  onDelete,
  onSaveToWorkspace,
}: {
  comps: Array<Comp & { _subjectDistance?: number | null }>;
  type: "sale" | "rent";
  showDistance?: boolean;
  onToggle: (c: Comp) => void;
  onDelete: (id: string) => void;
  onSaveToWorkspace: (c: Comp) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-muted-foreground border-b border-border/40">
            <th className="pb-2 pr-2 w-8"></th>
            <th className="pb-2 pr-2">Name / Address</th>
            <th className="pb-2 pr-2 text-right">Yr</th>
            <th className="pb-2 pr-2 text-right">Units / SF</th>
            {type === "sale" ? (
              <>
                <th className="pb-2 pr-2 text-right">Price</th>
                <th className="pb-2 pr-2 text-right">$/Unit</th>
                <th className="pb-2 pr-2 text-right">$/SF</th>
                <th className="pb-2 pr-2 text-right">Cap</th>
                <th className="pb-2 pr-2 text-right">Date</th>
              </>
            ) : (
              <>
                <th className="pb-2 pr-2 text-right">Rent/Unit</th>
                <th className="pb-2 pr-2 text-right">Rent/SF</th>
                <th className="pb-2 pr-2 text-right">Occ</th>
                <th className="pb-2 pr-2 text-right">Lease</th>
              </>
            )}
            <th className="pb-2 pr-2 text-right">Dist</th>
            <th className="pb-2 pr-2 w-8"></th>
          </tr>
        </thead>
        <tbody>
          {comps.map((c) => (
            <tr
              key={c.id}
              className={`border-b border-border/20 ${c.selected ? "" : "opacity-40"}`}
            >
              <td className="py-2 pr-2">
                <button
                  onClick={() => onToggle(c)}
                  title={c.selected ? "Selected" : "Excluded"}
                  className={`h-4 w-4 rounded border flex items-center justify-center ${
                    c.selected
                      ? "bg-primary/20 border-primary/40 text-primary"
                      : "border-border/40"
                  }`}
                >
                  {c.selected && <Check className="h-3 w-3" />}
                </button>
              </td>
              <td className="py-2 pr-2">
                <div className="font-medium text-foreground">{c.name || "—"}</div>
                <div className="text-[10px] text-muted-foreground">
                  {[c.address, c.city, c.state].filter(Boolean).join(", ") || "—"}
                </div>
              </td>
              <td className="py-2 pr-2 text-right">{c.year_built ?? "—"}</td>
              <td className="py-2 pr-2 text-right">
                {c.units ? `${fn(c.units)}u` : ""}
                {c.units && c.total_sf ? " / " : ""}
                {c.total_sf ? `${fn(c.total_sf)} SF` : ""}
                {!c.units && !c.total_sf ? "—" : ""}
              </td>
              {type === "sale" ? (
                <>
                  <td className="py-2 pr-2 text-right">{fc(c.sale_price)}</td>
                  <td className="py-2 pr-2 text-right">{fc(c.price_per_unit)}</td>
                  <td className="py-2 pr-2 text-right">{fc(c.price_per_sf)}</td>
                  <td className="py-2 pr-2 text-right">{fpct(c.cap_rate)}</td>
                  <td className="py-2 pr-2 text-right">
                    {c.sale_date ? new Date(c.sale_date).toLocaleDateString() : "—"}
                  </td>
                </>
              ) : (
                <>
                  <td className="py-2 pr-2 text-right">{fc(c.rent_per_unit)}</td>
                  <td className="py-2 pr-2 text-right">
                    {c.rent_per_sf != null ? `$${Number(c.rent_per_sf).toFixed(2)}` : "—"}
                  </td>
                  <td className="py-2 pr-2 text-right">{fpct(c.occupancy_pct, 0)}</td>
                  <td className="py-2 pr-2 text-right">{c.lease_type || "—"}</td>
                </>
              )}
              <td className="py-2 pr-2 text-right">
                {showDistance && c._subjectDistance != null
                  ? `${c._subjectDistance.toFixed(1)}mi`
                  : c.distance_mi != null
                  ? `${Number(c.distance_mi).toFixed(1)}mi`
                  : "—"}
              </td>
              <td className="py-2 pr-2 text-right">
                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={() => onSaveToWorkspace(c)}
                    className="text-muted-foreground hover:text-primary transition-colors"
                    title="Save to Comps Library (workspace)"
                  >
                    <Save className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => onDelete(c.id)}
                    className="text-muted-foreground hover:text-red-400 transition-colors"
                    title="Delete"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmptyState({
  type,
  onAdd,
}: {
  type: "sale" | "rent";
  onAdd: () => void;
}) {
  return (
    <div className="text-center py-10">
      <div className="text-xs text-muted-foreground mb-3">
        No {type} comps yet. Paste a listing from CoStar / LoopNet / Crexi (opened in your
        browser) and Claude will extract the fields.
      </div>
      <Button size="sm" variant="outline" onClick={onAdd}>
        <Plus className="h-3.5 w-3.5 mr-1.5" />
        Add {type} comp
      </Button>
    </div>
  );
}

// ── Paste modal ───────────────────────────────────────────────────────────

function PasteCompModal({
  dealId,
  compType,
  onClose,
  onSaved,
}: {
  dealId: string;
  compType: "sale" | "rent";
  onClose: () => void;
  onSaved: () => void;
}) {
  const [text, setText] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleExtract() {
    if (text.trim().length < 20) {
      toast.error("Paste at least a few lines of listing detail");
      return;
    }
    setExtracting(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/comps/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pasted_text: text,
          source_url: sourceUrl || undefined,
          expected_type: compType,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || "Extraction failed");
        return;
      }
      setDraft(json.data);
    } catch {
      toast.error("Extraction failed");
    } finally {
      setExtracting(false);
    }
  }

  async function handleSave() {
    if (!draft) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/comps`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...draft,
          source: "paste",
          source_url: sourceUrl || null,
          source_note: null,
        }),
      });
      if (!res.ok) {
        toast.error("Save failed");
        return;
      }
      toast.success("Comp added");
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  function updateDraft(key: string, value: unknown) {
    if (!draft) return;
    setDraft({ ...draft, [key]: value });
  }

  return (
    <div
      className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border/60 rounded-xl shadow-2xl w-full max-w-3xl my-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-border/40">
          <h2 className="font-semibold text-sm">
            Add {compType === "sale" ? "Sale" : "Rent"} Comp — Paste Listing
          </h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {!draft ? (
            <>
              <div>
                <label className="block text-[10px] text-muted-foreground uppercase tracking-wide mb-1">
                  Source URL (reference only — not fetched)
                </label>
                <input
                  type="text"
                  value={sourceUrl}
                  onChange={(e) => setSourceUrl(e.target.value)}
                  placeholder="https://www.crexi.com/properties/..."
                  className="w-full px-3 py-2 text-sm bg-muted/20 border border-border/40 rounded-lg outline-none focus:border-primary/40"
                />
              </div>
              <div>
                <label className="block text-[10px] text-muted-foreground uppercase tracking-wide mb-1">
                  Pasted Listing Content
                </label>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Paste property name, address, price, cap rate, units, SF, year built, etc…"
                  rows={12}
                  className="w-full px-3 py-2 text-sm bg-muted/20 border border-border/40 rounded-lg outline-none resize-y focus:border-primary/40 font-mono"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={onClose}>
                  Cancel
                </Button>
                <Button onClick={handleExtract} disabled={extracting}>
                  {extracting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  Extract
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="text-xs text-muted-foreground">
                Review and edit before saving.{" "}
                {typeof draft.confidence === "number" && (
                  <span>
                    Claude confidence:{" "}
                    <span
                      className={
                        (draft.confidence as number) > 0.75
                          ? "text-emerald-300"
                          : (draft.confidence as number) > 0.5
                          ? "text-amber-300"
                          : "text-red-300"
                      }
                    >
                      {Math.round((draft.confidence as number) * 100)}%
                    </span>
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <FieldInput
                  label="Name"
                  value={(draft.name as string) ?? ""}
                  onChange={(v) => updateDraft("name", v)}
                />
                <FieldInput
                  label="Address"
                  value={(draft.address as string) ?? ""}
                  onChange={(v) => updateDraft("address", v)}
                />
                <FieldInput
                  label="City"
                  value={(draft.city as string) ?? ""}
                  onChange={(v) => updateDraft("city", v)}
                />
                <FieldInput
                  label="State"
                  value={(draft.state as string) ?? ""}
                  onChange={(v) => updateDraft("state", v)}
                />
                <FieldInput
                  label="Year Built"
                  type="number"
                  value={(draft.year_built as number) ?? ""}
                  onChange={(v) => updateDraft("year_built", v ? Number(v) : null)}
                />
                <FieldInput
                  label="Property Type"
                  value={(draft.property_type as string) ?? ""}
                  onChange={(v) => updateDraft("property_type", v)}
                />
                <FieldInput
                  label="Units"
                  type="number"
                  value={(draft.units as number) ?? ""}
                  onChange={(v) => updateDraft("units", v ? Number(v) : null)}
                />
                <FieldInput
                  label="Total SF"
                  type="number"
                  value={(draft.total_sf as number) ?? ""}
                  onChange={(v) => updateDraft("total_sf", v ? Number(v) : null)}
                />
                {compType === "sale" ? (
                  <>
                    <FieldInput
                      label="Sale Price"
                      type="number"
                      suffix="$"
                      value={(draft.sale_price as number) ?? ""}
                      onChange={(v) => updateDraft("sale_price", v ? Number(v) : null)}
                    />
                    <FieldInput
                      label="Sale Date"
                      type="date"
                      value={(draft.sale_date as string) ?? ""}
                      onChange={(v) => updateDraft("sale_date", v || null)}
                    />
                    <FieldInput
                      label="Cap Rate"
                      type="number"
                      suffix="%"
                      value={(draft.cap_rate as number) ?? ""}
                      onChange={(v) => updateDraft("cap_rate", v ? Number(v) : null)}
                    />
                    <FieldInput
                      label="NOI"
                      type="number"
                      suffix="$"
                      value={(draft.noi as number) ?? ""}
                      onChange={(v) => updateDraft("noi", v ? Number(v) : null)}
                    />
                    <FieldInput
                      label="$ / Unit"
                      type="number"
                      suffix="$"
                      value={(draft.price_per_unit as number) ?? ""}
                      onChange={(v) => updateDraft("price_per_unit", v ? Number(v) : null)}
                    />
                    <FieldInput
                      label="$ / SF"
                      type="number"
                      suffix="$"
                      value={(draft.price_per_sf as number) ?? ""}
                      onChange={(v) => updateDraft("price_per_sf", v ? Number(v) : null)}
                    />
                  </>
                ) : (
                  <>
                    <FieldInput
                      label="Rent / Unit (mo)"
                      type="number"
                      suffix="$"
                      value={(draft.rent_per_unit as number) ?? ""}
                      onChange={(v) => updateDraft("rent_per_unit", v ? Number(v) : null)}
                    />
                    <FieldInput
                      label="Rent / SF (yr)"
                      type="number"
                      suffix="$"
                      value={(draft.rent_per_sf as number) ?? ""}
                      onChange={(v) => updateDraft("rent_per_sf", v ? Number(v) : null)}
                    />
                    <FieldInput
                      label="Rent / Bed (mo)"
                      type="number"
                      suffix="$"
                      value={(draft.rent_per_bed as number) ?? ""}
                      onChange={(v) => updateDraft("rent_per_bed", v ? Number(v) : null)}
                    />
                    <FieldInput
                      label="Occupancy"
                      type="number"
                      suffix="%"
                      value={(draft.occupancy_pct as number) ?? ""}
                      onChange={(v) => updateDraft("occupancy_pct", v ? Number(v) : null)}
                    />
                    <FieldInput
                      label="Lease Type"
                      value={(draft.lease_type as string) ?? ""}
                      onChange={(v) => updateDraft("lease_type", v)}
                    />
                  </>
                )}
                <FieldInput
                  label="Distance"
                  type="number"
                  suffix="mi"
                  value={(draft.distance_mi as number) ?? ""}
                  onChange={(v) => updateDraft("distance_mi", v ? Number(v) : null)}
                />
              </div>
              {typeof draft.notes === "string" && draft.notes && (
                <div>
                  <label className="block text-[10px] text-muted-foreground uppercase tracking-wide mb-1">
                    Extraction Notes
                  </label>
                  <div className="px-3 py-2 text-xs bg-muted/10 border border-border/30 rounded-lg text-muted-foreground">
                    {draft.notes as string}
                  </div>
                </div>
              )}
              <div className="flex justify-between gap-2">
                <Button variant="ghost" onClick={() => setDraft(null)}>
                  Back
                </Button>
                <Button onClick={handleSave} disabled={saving}>
                  {saving ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  ) : (
                    <Save className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  Save Comp
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Extract-from-doc modal ────────────────────────────────────────────────
//
// Lists the deal's documents in the "market" category, lets the user pick
// one, runs Claude extraction, and shows a bulk-review screen. Per-draft
// checkboxes let the user cherry-pick which extracted comps to save.

interface MarketDoc {
  id: string;
  original_name: string | null;
  name: string;
  category: string;
}

interface DraftComp {
  comp_type: "sale" | "rent";
  name?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  year_built?: number | null;
  units?: number | null;
  total_sf?: number | null;
  sale_price?: number | null;
  sale_date?: string | null;
  cap_rate?: number | null;
  price_per_unit?: number | null;
  price_per_sf?: number | null;
  rent_per_unit?: number | null;
  rent_per_sf?: number | null;
  rent_per_bed?: number | null;
  occupancy_pct?: number | null;
  lease_type?: string | null;
  distance_mi?: number | null;
  confidence?: number;
  notes?: string | null;
}

function ExtractFromDocModal({
  dealId,
  onClose,
  onSaved,
}: {
  dealId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [docs, setDocs] = useState<MarketDoc[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [drafts, setDrafts] = useState<DraftComp[] | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [summary, setSummary] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`/api/deals/${dealId}/documents`)
      .then((r) => r.json())
      .then((json) => {
        const all: MarketDoc[] = json.data || [];
        setDocs(all.filter((d) => d.category === "market"));
      })
      .catch(() => toast.error("Failed to load documents"))
      .finally(() => setLoadingDocs(false));
  }, [dealId]);

  async function handleExtract() {
    if (!selectedDocId) return;
    setExtracting(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/comps/extract-from-doc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document_id: selectedDocId }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || "Extraction failed");
        return;
      }
      const batch = json.data;
      setDrafts(batch.comps || []);
      setSummary(batch.summary || "");
      // default: pick all
      setPicked(new Set(batch.comps?.map((_: unknown, i: number) => i) || []));
    } catch {
      toast.error("Extraction failed");
    } finally {
      setExtracting(false);
    }
  }

  async function handleSaveSelected() {
    if (!drafts) return;
    const toSave = drafts.filter((_, i) => picked.has(i));
    if (toSave.length === 0) {
      toast.error("Select at least one comp to save");
      return;
    }
    setSaving(true);
    let saved = 0;
    try {
      const selectedDoc = docs.find((d) => d.id === selectedDocId);
      for (const draft of toSave) {
        const res = await fetch(`/api/deals/${dealId}/comps`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...draft,
            source: "doc",
            source_url: null,
            source_note: selectedDoc
              ? `Extracted from ${selectedDoc.original_name || selectedDoc.name}`
              : null,
          }),
        });
        if (res.ok) saved++;
      }
      if (saved > 0) {
        toast.success(`Saved ${saved} comp${saved === 1 ? "" : "s"}`);
        onSaved();
      } else {
        toast.error("Nothing saved");
      }
    } finally {
      setSaving(false);
    }
  }

  function togglePick(i: number) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  return (
    <div
      className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border/60 rounded-xl shadow-2xl w-full max-w-4xl my-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-border/40">
          <h2 className="font-semibold text-sm">Extract Comps from Market Document</h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Doc picker */}
          {!drafts && (
            <>
              {loadingDocs ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : docs.length === 0 ? (
                <div className="text-center py-8 text-xs text-muted-foreground">
                  No documents classified as &quot;market&quot; yet. Upload a market study,
                  appraisal, or broker comp report to the Documents tab, and it will
                  be auto-classified.
                </div>
              ) : (
                <>
                  <div className="text-xs text-muted-foreground mb-2">
                    Select a market-category document. Claude will extract every
                    comparable property it finds and let you review them before
                    saving.
                  </div>
                  <div className="space-y-1 max-h-64 overflow-y-auto border border-border/30 rounded-lg p-1">
                    {docs.map((d) => (
                      <button
                        key={d.id}
                        onClick={() => setSelectedDocId(d.id)}
                        className={`w-full text-left px-3 py-2 rounded-md text-xs transition-colors ${
                          selectedDocId === d.id
                            ? "bg-primary/20 text-foreground"
                            : "hover:bg-muted/30 text-muted-foreground"
                        }`}
                      >
                        {d.original_name || d.name}
                      </button>
                    ))}
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" onClick={onClose}>
                      Cancel
                    </Button>
                    <Button
                      onClick={handleExtract}
                      disabled={!selectedDocId || extracting}
                    >
                      {extracting ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                      ) : (
                        <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                      )}
                      Extract
                    </Button>
                  </div>
                </>
              )}
            </>
          )}

          {/* Review screen */}
          {drafts && (
            <>
              <div className="text-xs text-muted-foreground">
                {summary || `${drafts.length} comp${drafts.length === 1 ? "" : "s"} extracted.`}
                {drafts.length > 0 &&
                  " Uncheck any you don't want to save — edits can be made after saving by deleting and re-adding (inline edit coming soon)."}
              </div>

              {drafts.length === 0 ? (
                <div className="text-center py-6 text-xs text-muted-foreground">
                  No comparable properties found in this document.
                </div>
              ) : (
                <div className="max-h-96 overflow-y-auto border border-border/30 rounded-lg">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-card">
                      <tr className="text-left text-muted-foreground border-b border-border/40">
                        <th className="pb-2 px-2 w-10"></th>
                        <th className="pb-2 px-2">Type</th>
                        <th className="pb-2 px-2">Name / Address</th>
                        <th className="pb-2 px-2 text-right">Yr</th>
                        <th className="pb-2 px-2 text-right">Size</th>
                        <th className="pb-2 px-2 text-right">Headline</th>
                        <th className="pb-2 px-2 text-right">Conf</th>
                      </tr>
                    </thead>
                    <tbody>
                      {drafts.map((d, i) => (
                        <tr
                          key={i}
                          className={`border-b border-border/20 ${
                            picked.has(i) ? "" : "opacity-40"
                          }`}
                        >
                          <td className="py-2 px-2">
                            <button
                              onClick={() => togglePick(i)}
                              className={`h-4 w-4 rounded border flex items-center justify-center ${
                                picked.has(i)
                                  ? "bg-primary/20 border-primary/40 text-primary"
                                  : "border-border/40"
                              }`}
                            >
                              {picked.has(i) && <Check className="h-3 w-3" />}
                            </button>
                          </td>
                          <td className="py-2 px-2 uppercase text-[10px] font-medium">
                            {d.comp_type}
                          </td>
                          <td className="py-2 px-2">
                            <div className="font-medium text-foreground">
                              {d.name || "—"}
                            </div>
                            <div className="text-[10px] text-muted-foreground">
                              {[d.address, d.city, d.state].filter(Boolean).join(", ") ||
                                "—"}
                            </div>
                          </td>
                          <td className="py-2 px-2 text-right">{d.year_built ?? "—"}</td>
                          <td className="py-2 px-2 text-right">
                            {d.units ? `${d.units}u` : d.total_sf ? `${Number(d.total_sf).toLocaleString()} SF` : "—"}
                          </td>
                          <td className="py-2 px-2 text-right">
                            {d.comp_type === "sale" ? (
                              <>
                                {d.sale_price != null && (
                                  <div>{fc(d.sale_price)}</div>
                                )}
                                {d.cap_rate != null && (
                                  <div className="text-[10px] text-muted-foreground">
                                    {d.cap_rate}% cap
                                  </div>
                                )}
                              </>
                            ) : (
                              <>
                                {d.rent_per_unit != null && (
                                  <div>{fc(d.rent_per_unit)}/unit</div>
                                )}
                                {d.rent_per_sf != null && (
                                  <div className="text-[10px] text-muted-foreground">
                                    ${Number(d.rent_per_sf).toFixed(2)}/SF
                                  </div>
                                )}
                              </>
                            )}
                          </td>
                          <td className="py-2 px-2 text-right">
                            {typeof d.confidence === "number"
                              ? `${Math.round(d.confidence * 100)}%`
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="flex justify-between gap-2">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setDrafts(null);
                    setPicked(new Set());
                  }}
                >
                  Back
                </Button>
                <Button onClick={handleSaveSelected} disabled={saving || picked.size === 0}>
                  {saving ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  ) : (
                    <Save className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  Save {picked.size} Selected
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
