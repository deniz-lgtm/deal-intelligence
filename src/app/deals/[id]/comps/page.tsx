"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import dynamic from "next/dynamic";
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
  Map as MapIcon,
  Table as TableIcon,
  BarChart3,
  Upload,
  Image as ImageIcon,
  FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { Comp, SubmarketMetrics, Document } from "@/lib/types";
import { DocCoverageChip } from "@/components/ai";
import MarketIntelligencePanel from "@/components/comps/MarketIntelligencePanel";
import { fireAndForgetAutoEnrich } from "@/lib/location-auto-enrich";

// ── Underwriting-side rent comp matrix types ────────────────────────────────
//
// The richer "matrix" rent-comp UI (with per-unit-type rent columns + selection
// + Apply-to-Market-Rents) lives in the underwriting JSONB blob so that the
// existing investment-package generator at
// /api/deals/[id]/investment-package/generate-all keeps reading from
// `uw.rent_comps` without a data migration. We expose the editor here on the
// Comps page (the natural home), but the storage location is unchanged.

interface MatrixRentComp {
  name: string;
  address: string;
  distance_mi: number;
  year_built: number;
  units?: number;
  total_sf?: number;
  occupancy_pct: number;
  unit_types?: Array<{ type: string; sf: number; rent: number }>;
  rent_per_sf?: number;
  lease_type?: string;
  tenant_type?: string;
  amenities?: string;
  notes?: string;
}

interface UnitGroupLite {
  id: string;
  bedrooms?: number;
  bathrooms?: number;
  market_rent_per_unit?: number;
  market_rent_per_sf?: number;
}

// Leaflet is heavy and SSR-incompatible — load it only when the user opens
// the map view.
const CompsMapView = dynamic(() => import("@/components/CompsMapView"), {
  ssr: false,
  loading: () => (
    <div className="border border-border/40 rounded-xl bg-card/40 h-[540px] flex items-center justify-center text-xs text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin mr-2" />
      Loading map…
    </div>
  ),
});


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
  defaultOpen = false,
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
  property_type?: string | null;
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
  const [geocodingMissing, setGeocodingMissing] = useState(false);
  const [viewMode, setViewMode] = useState<"table" | "map">("table");

  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteType, setPasteType] = useState<"sale" | "rent">("sale");
  const [docExtractOpen, setDocExtractOpen] = useState(false);
  // Documents are fetched once at the page level so the coverage chip
  // next to "Extract from Market Docs" can tell the user at a glance
  // whether any market-category docs exist before they open the modal.
  const [documents, setDocuments] = useState<Document[]>([]);

  // Matrix-style rent comps live inside the underwriting JSONB blob — see
  // MatrixRentComp comment near the top of this file for why. We hold the
  // editable copy in state and write it back to /api/underwriting via PUT.
  const [matrixComps, setMatrixComps] = useState<MatrixRentComp[]>([]);
  const [matrixUnitTypes, setMatrixUnitTypes] = useState<string[]>([]);
  const [matrixSelectedIds, setMatrixSelectedIds] = useState<number[]>([]);
  const [matrixUnitGroups, setMatrixUnitGroups] = useState<UnitGroupLite[]>([]);
  const [matrixUwId, setMatrixUwId] = useState<string | null>(null);
  // Snapshot of the full underwriting blob — we PUT it back unchanged except
  // for the rent_comps fields so we don't clobber other underwriting state.
  const matrixUwSnapshot = useRef<Record<string, unknown> | null>(null);
  const [matrixSaving, setMatrixSaving] = useState(false);
  const [matrixDirty, setMatrixDirty] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [compsRes, metricsRes, dealRes, uwRes] = await Promise.all([
        fetch(`/api/deals/${params.id}/comps`).then((r) => r.json()),
        fetch(`/api/deals/${params.id}/submarket-metrics`).then((r) => r.json()),
        fetch(`/api/deals/${params.id}`).then((r) => r.json()),
        fetch(`/api/underwriting?deal_id=${params.id}`).then((r) => r.json()),
      ]);
      const all: Comp[] = compsRes.data || [];
      setSaleComps(all.filter((c) => c.comp_type === "sale"));
      setRentComps(all.filter((c) => c.comp_type === "rent"));
      setSubmarket(metricsRes.data || {});
      setSubject(dealRes.data || null);

      // Hydrate matrix-style rent comps from underwriting blob.
      const uwRow = uwRes.data;
      if (uwRow) {
        const raw = uwRow.data;
        const parsed: Record<string, unknown> | null =
          raw == null
            ? null
            : typeof raw === "string"
            ? (JSON.parse(raw) as Record<string, unknown>)
            : (raw as Record<string, unknown>);
        matrixUwSnapshot.current = parsed;
        setMatrixUwId(uwRow.id ?? null);
        setMatrixComps(
          Array.isArray(parsed?.rent_comps)
            ? (parsed!.rent_comps as MatrixRentComp[])
            : []
        );
        setMatrixUnitTypes(
          Array.isArray(parsed?.rent_comp_unit_types)
            ? (parsed!.rent_comp_unit_types as string[])
            : []
        );
        setMatrixSelectedIds(
          Array.isArray(parsed?.selected_comp_ids)
            ? (parsed!.selected_comp_ids as number[])
            : []
        );
        setMatrixUnitGroups(
          Array.isArray(parsed?.unit_groups)
            ? (parsed!.unit_groups as UnitGroupLite[])
            : []
        );
      } else {
        matrixUwSnapshot.current = null;
        setMatrixUwId(null);
        setMatrixComps([]);
        setMatrixUnitTypes([]);
        setMatrixSelectedIds([]);
        setMatrixUnitGroups([]);
      }
      setMatrixDirty(false);
    } catch (err) {
      console.error(err);
      toast.error("Failed to load comps");
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  const handleGeocodeSubject = useCallback(async (silent = false) => {
    setGeocodingSubject(true);
    try {
      const res = await fetch(`/api/deals/${params.id}/geocode`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok) {
        if (!silent) toast.error(json.error || "Failed to geocode subject deal");
        return;
      }
      if (!silent) toast.success("Subject deal geocoded");
      loadData();
      // Kick off background market-data enrichment — HUD AMI + FMR, BLS LAUS
      // + QCEW, USPS migration, FEMA flood, Census demographics. Fire-and-
      // forget so the UI doesn't block on HUD/BLS round-trips. Each feed
      // degrades gracefully when its API key is missing.
      fireAndForgetAutoEnrich(params.id);
    } finally {
      setGeocodingSubject(false);
    }
  }, [params.id, loadData]);

  // Auto-geocode on load if subject has an address but no coords
  useEffect(() => {
    if (subject && subject.address && (!subject.lat || !subject.lng) && !geocodingSubject) {
      handleGeocodeSubject(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject?.address, subject?.lat, subject?.lng]);

  // Load documents for the page-level coverage chip (separate from the
  // filtered list the doc-extract modal maintains internally).
  useEffect(() => {
    fetch(`/api/deals/${params.id}/documents`)
      .then((r) => r.json())
      .then((j) => setDocuments(j.data || []))
      .catch(() => {});
  }, [params.id]);

  async function handleGeocodeMissing() {
    setGeocodingMissing(true);
    try {
      const res = await fetch("/api/workspace/comps/geocode-missing", {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || "Failed to geocode comps");
        return;
      }
      const { geocoded, failed, more } = json.data;
      toast.success(
        `Geocoded ${geocoded} comp${geocoded === 1 ? "" : "s"}` +
          (failed ? ` (${failed} failed)` : "") +
          (more ? " — more remaining, run again" : "")
      );
      loadData();
    } finally {
      setGeocodingMissing(false);
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

  // Geocoded comps for the map view. We pull from the *unfiltered* annotated
  // lists so the user can see comps that fall outside the radius too — the
  // radius circle on the map already visualizes the active filter.
  const mapComps = useMemo(() => {
    const all = [...annotatedSale, ...annotatedRent];
    return all
      .filter((c) => c.lat != null && c.lng != null)
      .map((c) => ({
        id: c.id,
        deal_id: c.deal_id,
        source_deal_id: c.source_deal_id ?? null,
        comp_type: c.comp_type,
        name: c.name,
        address: c.address,
        city: c.city,
        state: c.state,
        sale_price: c.sale_price,
        cap_rate: c.cap_rate,
        rent_per_unit: c.rent_per_unit,
        rent_per_sf: c.rent_per_sf,
        lat: Number(c.lat),
        lng: Number(c.lng),
      }));
  }, [annotatedSale, annotatedRent]);

  const mapSubject = useMemo(() => {
    if (!subject?.lat || !subject?.lng) return null;
    return {
      lat: Number(subject.lat),
      lng: Number(subject.lng),
      name: subject.name,
      address: [subject.address, subject.city, subject.state]
        .filter(Boolean)
        .join(", ") || null,
    };
  }, [subject]);

  // Show map controls only when there's something useful to show on the map
  const mapHasContent = mapComps.length > 0 || mapSubject != null;

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

  // ── Matrix rent comps helpers ────────────────────────────────────────────

  // Derive deal type flags from the loaded subject so the matrix can pick
  // between the multifamily/student-housing layout (per-unit-type rent) and
  // the commercial layout ($/SF). We default to multifamily — that matches
  // the underwriting page's behaviour when a property type isn't set.
  const isStudent = subject?.property_type === "student_housing";
  const isMatrixMF =
    subject?.property_type === "multifamily" ||
    subject?.property_type === "sfr" ||
    isStudent ||
    !subject?.property_type;

  // Union of explicitly-saved unit-type columns, plus columns derived from
  // existing comp data and the unit_groups themselves so legacy deals show
  // their columns immediately on first render.
  const matrixAllTypes = useMemo(() => {
    if (matrixUnitTypes.length > 0) return matrixUnitTypes;
    const derived = new Set<string>();
    for (const c of matrixComps) {
      for (const ut of c.unit_types || []) derived.add(ut.type);
    }
    for (const g of matrixUnitGroups) {
      derived.add(`${g.bedrooms || 1}BR/${g.bathrooms || 1}BA`);
    }
    return Array.from(derived).sort();
  }, [matrixUnitTypes, matrixComps, matrixUnitGroups]);

  function patchMatrix(updates: {
    comps?: MatrixRentComp[];
    selectedIds?: number[];
    unitTypes?: string[];
    unitGroups?: UnitGroupLite[];
  }) {
    if (updates.comps !== undefined) setMatrixComps(updates.comps);
    if (updates.selectedIds !== undefined) setMatrixSelectedIds(updates.selectedIds);
    if (updates.unitTypes !== undefined) setMatrixUnitTypes(updates.unitTypes);
    if (updates.unitGroups !== undefined) setMatrixUnitGroups(updates.unitGroups);
    setMatrixDirty(true);
  }

  async function saveMatrix(extraOverrides: Record<string, unknown> = {}) {
    setMatrixSaving(true);
    try {
      // Merge into the latest underwriting snapshot (or build a fresh blob if
      // the deal has no underwriting row yet) so we don't clobber other
      // underwriting fields.
      const base = matrixUwSnapshot.current
        ? { ...matrixUwSnapshot.current }
        : {};
      const merged: Record<string, unknown> = {
        ...base,
        ...extraOverrides,
        rent_comps: matrixComps,
        rent_comp_unit_types: matrixUnitTypes,
        selected_comp_ids: matrixSelectedIds,
      };
      const res = await fetch("/api/underwriting", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deal_id: params.id, data: merged }),
      });
      if (!res.ok) {
        toast.error("Failed to save rent comps");
        return false;
      }
      matrixUwSnapshot.current = merged;
      const json = await res.json().catch(() => null);
      if (json?.data?.id && !matrixUwId) setMatrixUwId(json.data.id);
      setMatrixDirty(false);
      toast.success("Rent comps saved");
      return true;
    } catch {
      toast.error("Failed to save rent comps");
      return false;
    } finally {
      setMatrixSaving(false);
    }
  }

  function addMatrixComp() {
    const seedTypes = isMatrixMF
      ? Array.from(
          new Set(
            matrixUnitGroups.map(
              (g) => `${g.bedrooms || 1}BR/${g.bathrooms || 1}BA`
            )
          )
        ).map((t) => ({ type: t, sf: 0, rent: 0 }))
      : [];
    const newComp: MatrixRentComp = {
      name: "",
      address: "",
      distance_mi: 0,
      year_built: 0,
      units: 0,
      occupancy_pct: 0,
      unit_types: seedTypes,
      rent_per_sf: 0,
      notes: "",
    };
    const nextComps = [...matrixComps, newComp];
    const nextSel = [...matrixSelectedIds, nextComps.length - 1];
    patchMatrix({ comps: nextComps, selectedIds: nextSel });
  }

  function applyMarketRents() {
    const selected = matrixComps.filter((_, i) =>
      matrixSelectedIds.includes(i)
    );
    if (selected.length === 0) {
      toast.error("Select at least one comp first");
      return;
    }
    if (isMatrixMF) {
      const rentsByType: Record<string, { total: number; count: number }> = {};
      for (const comp of selected) {
        for (const ut of comp.unit_types || []) {
          if (!rentsByType[ut.type])
            rentsByType[ut.type] = { total: 0, count: 0 };
          if (ut.rent > 0) {
            rentsByType[ut.type].total += ut.rent;
            rentsByType[ut.type].count++;
          }
        }
      }
      const updatedGroups: UnitGroupLite[] = matrixUnitGroups.map((g) => {
        const bd = g.bedrooms || 1;
        const match = Object.entries(rentsByType).find(([k]) =>
          k.startsWith(`${bd}BR`)
        );
        if (match && match[1].count > 0) {
          return {
            ...g,
            market_rent_per_unit: Math.round(match[1].total / match[1].count),
          };
        }
        return g;
      });
      patchMatrix({ unitGroups: updatedGroups });
      // Persist immediately — applying market rents is a meaningful action
      // and the user expects the underwriting page to reflect it next time
      // they open it.
      saveMatrix({ unit_groups: updatedGroups });
    } else {
      const totalRent = selected.reduce(
        (s, c) => s + (c.rent_per_sf || 0),
        0
      );
      const avg = selected.length > 0 ? totalRent / selected.length : 0;
      if (avg <= 0) {
        toast.error("Selected comps have no $/SF data");
        return;
      }
      const rounded = Math.round(avg * 100) / 100;
      const updatedGroups: UnitGroupLite[] = matrixUnitGroups.map((g) => ({
        ...g,
        market_rent_per_sf: rounded,
      }));
      patchMatrix({ unitGroups: updatedGroups });
      saveMatrix({ unit_groups: updatedGroups });
    }
  }

  function toggleMatrixSelected(idx: number) {
    const set = new Set(matrixSelectedIds);
    if (set.has(idx)) set.delete(idx);
    else set.add(idx);
    patchMatrix({ selectedIds: Array.from(set).sort((a, b) => a - b) });
  }

  function deleteMatrixComp(idx: number) {
    const nextComps = matrixComps.filter((_, j) => j !== idx);
    const nextSel: number[] = [];
    for (const v of matrixSelectedIds) {
      if (v < idx) nextSel.push(v);
      else if (v > idx) nextSel.push(v - 1);
    }
    patchMatrix({ comps: nextComps, selectedIds: nextSel });
  }

  function updateMatrixComp(idx: number, updates: Partial<MatrixRentComp>) {
    const nextComps = matrixComps.map((c, i) =>
      i === idx ? { ...c, ...updates } : c
    );
    patchMatrix({ comps: nextComps });
  }

  function updateMatrixUnitTypeCell(
    compIdx: number,
    typeStr: string,
    field: "rent" | "sf",
    value: number
  ) {
    const nextComps = matrixComps.map((c, i) => {
      if (i !== compIdx) return c;
      const types = [...(c.unit_types || [])];
      const existing = types.findIndex((ut) => ut.type === typeStr);
      if (existing >= 0) {
        types[existing] = { ...types[existing], [field]: value };
      } else {
        types.push({
          type: typeStr,
          sf: field === "sf" ? value : 0,
          rent: field === "rent" ? value : 0,
        });
      }
      return { ...c, unit_types: types };
    });
    patchMatrix({ comps: nextComps });
  }

  function addMatrixUnitType() {
    const base = "New Type";
    let label = base;
    let n = 2;
    while (matrixAllTypes.includes(label)) {
      label = `${base} ${n++}`;
    }
    patchMatrix({ unitTypes: [...matrixAllTypes, label] });
  }

  function removeMatrixUnitType(t: string) {
    const nextTypes = matrixAllTypes.filter((x) => x !== t);
    const nextComps = matrixComps.map((c) => ({
      ...c,
      unit_types: (c.unit_types || []).filter((ut) => ut.type !== t),
    }));
    patchMatrix({ unitTypes: nextTypes, comps: nextComps });
  }

  function renameMatrixUnitType(oldT: string, newT: string) {
    const trimmed = newT.trim();
    if (!trimmed || trimmed === oldT) return;
    if (matrixAllTypes.includes(trimmed)) return;
    const nextTypes = matrixAllTypes.map((x) => (x === oldT ? trimmed : x));
    const nextComps = matrixComps.map((c) => ({
      ...c,
      unit_types: (c.unit_types || []).map((ut) =>
        ut.type === oldT ? { ...ut, type: trimmed } : ut
      ),
    }));
    patchMatrix({ unitTypes: nextTypes, comps: nextComps });
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
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDocExtractOpen(true)}
          >
            <FileSearch className="h-3.5 w-3.5 mr-1.5" />
            Extract from Market Docs
          </Button>
          <DocCoverageChip documents={documents} section="comps" />
        </div>
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

      {/* AI-extracted broker research — CBRE / JLL / C&W / M&M / Berkadia. */}
      <Section
        title="Market Intelligence"
        icon={<FileSearch className="h-4 w-4 text-primary" />}
        defaultOpen={true}
      >
        <MarketIntelligencePanel dealId={params.id} />
      </Section>

      {/* Distance filter (only when subject has coords) */}
      {!subject?.lat || !subject?.lng ? (
        <div className="flex items-center justify-between gap-3 p-3 rounded-lg bg-muted/10 border border-border/30 text-xs">
          <div className="flex items-center gap-2 text-muted-foreground">
            {geocodingSubject ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin flex-shrink-0" />
            ) : (
              <MapPinned className="h-3.5 w-3.5 flex-shrink-0" />
            )}
            <span>
              {geocodingSubject
                ? "Geocoding property address…"
                : subject?.address
                ? "Unable to geocode this address — verify it's correct on the deal overview."
                : "Add an address to the deal to unlock distance-based comp filtering."}
            </span>
          </div>
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

      {/* View toggle (Table | Map) */}
      {(saleComps.length > 0 || rentComps.length > 0 || subject?.lat) && (
        <div className="flex items-center justify-between gap-3">
          <div className="inline-flex items-center rounded-lg border border-border/40 bg-muted/20 p-0.5">
            <button
              type="button"
              onClick={() => setViewMode("table")}
              className={`flex items-center gap-1.5 px-3 py-1 text-xs rounded-md transition-colors ${
                viewMode === "table"
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <TableIcon className="h-3.5 w-3.5" />
              Table
            </button>
            <button
              type="button"
              onClick={() => setViewMode("map")}
              className={`flex items-center gap-1.5 px-3 py-1 text-xs rounded-md transition-colors ${
                viewMode === "map"
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <MapIcon className="h-3.5 w-3.5" />
              Map
            </button>
          </div>

          {viewMode === "map" && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleGeocodeMissing}
              disabled={geocodingMissing}
            >
              {geocodingMissing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
              ) : (
                <MapPinned className="h-3.5 w-3.5 mr-1.5" />
              )}
              Geocode Missing
            </Button>
          )}
        </div>
      )}

      {viewMode === "map" ? (
        mapHasContent ? (
          <div className="space-y-2">
            <CompsMapView
              comps={mapComps}
              subject={mapSubject}
              radiusMiles={radiusMiles}
              height={560}
            />
            <div className="flex items-center justify-between text-[11px] text-muted-foreground px-1">
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  Subject
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-amber-500" />
                  Sale ({mapComps.filter((c) => c.comp_type === "sale").length})
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-blue-500" />
                  Rent ({mapComps.filter((c) => c.comp_type === "rent").length})
                </span>
              </div>
              {saleComps.length + rentComps.length - mapComps.length > 0 && (
                <span>
                  {saleComps.length + rentComps.length - mapComps.length} comp
                  {saleComps.length + rentComps.length - mapComps.length === 1
                    ? ""
                    : "s"}{" "}
                  not yet geocoded
                </span>
              )}
            </div>
          </div>
        ) : (
          <div className="border border-dashed border-border/40 rounded-xl bg-card/40 py-16 text-center">
            <MapIcon className="h-8 w-8 mx-auto mb-3 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              No comps with coordinates yet.
            </p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              Click <em>Geocode Missing</em> above, or paste comps that include
              an address.
            </p>
          </div>
        )
      ) : (
        <>
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

          {/* Rent comps — matrix editor (per-unit-type rent grid for MF/SH,
              $/SF table for commercial). Persists into the underwriting JSONB
              so the existing investment-package generator keeps working. */}
          <Section
            title={`Rent Comps (${matrixComps.length})`}
            icon={<BarChart3 className="h-4 w-4 text-teal-400" />}
            action={
              matrixDirty ? (
                <Button
                  size="sm"
                  variant="default"
                  onClick={() => saveMatrix()}
                  disabled={matrixSaving}
                >
                  {matrixSaving ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  <span className="ml-1.5">Save</span>
                </Button>
              ) : null
            }
          >
            <RentCompsMatrix
              isMF={isMatrixMF}
              isStudent={isStudent}
              comps={matrixComps}
              selectedIds={matrixSelectedIds}
              allTypes={matrixAllTypes}
              hasUnitGroups={matrixUnitGroups.length > 0}
              onAdd={addMatrixComp}
              onPaste={() => openPaste("rent")}
              onUploadReport={() => setDocExtractOpen(true)}
              onApplyMarketRents={applyMarketRents}
              onToggleSelected={toggleMatrixSelected}
              onDelete={deleteMatrixComp}
              onUpdateComp={updateMatrixComp}
              onUpdateUnitTypeCell={updateMatrixUnitTypeCell}
              onAddUnitType={addMatrixUnitType}
              onRemoveUnitType={removeMatrixUnitType}
              onRenameUnitType={renameMatrixUnitType}
            />
          </Section>

          {/* Paste-mode rent comps from CoStar / LoopNet / Crexi / Zillow that
              the user has pasted in. Stored in the comps DB table, separate
              from the matrix above. Both feed the investment-package
              generator. */}
          {(rentComps.length > 0 || filteredRent.length > 0) && (
            <Section
              title={`Pasted Rent Listings (${filteredRent.length}${radiusMiles != null && filteredRent.length !== rentComps.length ? ` / ${rentComps.length}` : ""})`}
              icon={<ClipboardPaste className="h-4 w-4 text-blue-400" />}
              action={
                <Button size="sm" variant="outline" onClick={() => openPaste("rent")}>
                  <ClipboardPaste className="h-3.5 w-3.5 mr-1.5" />
                  Paste Listing
                </Button>
              }
              defaultOpen={false}
            >
              {filteredRent.length === 0 ? (
                <div className="text-center py-8 text-xs text-muted-foreground">
                  No pasted rent listings within {radiusMiles} miles of the subject.
                </div>
              ) : (
                <CompTable
                  comps={filteredRent}
                  type="rent"
                  showDistance={!!(subject?.lat && subject?.lng)}
                  onToggle={handleToggleSelected}
                  onDelete={handleDeleteComp}
                  onSaveToWorkspace={handleSaveToWorkspace}
                />
              )}
            </Section>
          )}
        </>
      )}

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

// ── Rent comps matrix ────────────────────────────────────────────────────
//
// The richer rent-comp editor that used to live on the underwriting page.
// For multifamily / student-housing it renders a per-unit-type rent grid;
// for commercial it falls back to a $/SF table. Selection + Apply-to-Market-
// Rents push averages back to the underwriting unit_groups.

function RentCompsMatrix({
  isMF,
  isStudent,
  comps,
  selectedIds,
  allTypes,
  hasUnitGroups,
  onAdd,
  onPaste,
  onUploadReport,
  onApplyMarketRents,
  onToggleSelected,
  onDelete,
  onUpdateComp,
  onUpdateUnitTypeCell,
  onAddUnitType,
  onRemoveUnitType,
  onRenameUnitType,
}: {
  isMF: boolean;
  isStudent: boolean;
  comps: MatrixRentComp[];
  selectedIds: number[];
  allTypes: string[];
  hasUnitGroups: boolean;
  onAdd: () => void;
  onPaste: () => void;
  onUploadReport: () => void;
  onApplyMarketRents: () => void;
  onToggleSelected: (idx: number) => void;
  onDelete: (idx: number) => void;
  onUpdateComp: (idx: number, updates: Partial<MatrixRentComp>) => void;
  onUpdateUnitTypeCell: (
    compIdx: number,
    typeStr: string,
    field: "rent" | "sf",
    value: number
  ) => void;
  onAddUnitType: () => void;
  onRemoveUnitType: (t: string) => void;
  onRenameUnitType: (oldT: string, newT: string) => void;
}) {
  const selectedSet = new Set(selectedIds);

  return (
    <div className="space-y-3">
      {/* Toolbar — comps come from user-pulled sources only:
            • Paste Listing  → user-copied listing text from CoStar / LoopNet /
              Crexi / Zillow (their own browser session, their own ToS)
            • Upload Report  → user-uploaded broker comp report / market study
              gets parsed into structured rows
            • Add Comp       → manual entry */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button variant="default" size="sm" onClick={onPaste}>
          <ClipboardPaste className="h-3.5 w-3.5 mr-1.5" />
          Paste Listing
        </Button>
        <Button variant="outline" size="sm" onClick={onUploadReport}>
          <FileSearch className="h-3.5 w-3.5 mr-1.5" />
          Upload Report
        </Button>
        <Button variant="outline" size="sm" onClick={onAdd}>
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          Add Comp
        </Button>
        <div className="flex-1" />
        {comps.length > 0 && selectedSet.size > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={onApplyMarketRents}
            disabled={!hasUnitGroups}
            title={
              hasUnitGroups
                ? "Push the average of selected comps to the underwriting market rents"
                : "Add unit groups in Underwriting first"
            }
          >
            Apply to Market Rents
          </Button>
        )}
        {comps.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {selectedSet.size}/{comps.length} selected
          </span>
        )}
      </div>

      {/* Empty state */}
      {comps.length === 0 ? (
        <div className="text-center py-10">
          <div className="text-xs text-muted-foreground mb-3 max-w-md mx-auto">
            No rent comps yet. Paste a listing you copied from CoStar /
            LoopNet / Crexi / Zillow, upload a broker comp report, or add
            one manually.
          </div>
        </div>
      ) : isMF ? (
        // ── Multifamily / Student housing: per-unit-type matrix ──────────
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-muted/30 border-b border-border/40">
                <th className="px-1 py-1 w-[24px]" rowSpan={2} />
                <th
                  className="text-left px-2 py-1 text-xs font-medium text-muted-foreground"
                  rowSpan={2}
                >
                  Property
                </th>
                <th
                  className="text-right px-1 py-1 text-xs font-medium text-muted-foreground w-[45px]"
                  rowSpan={2}
                >
                  Dist
                </th>
                <th
                  className="text-right px-1 py-1 text-xs font-medium text-muted-foreground w-[40px]"
                  rowSpan={2}
                >
                  Yr
                </th>
                <th
                  className="text-right px-1 py-1 text-xs font-medium text-muted-foreground w-[40px]"
                  rowSpan={2}
                >
                  Units
                </th>
                <th
                  className="text-right px-1 py-1 text-xs font-medium text-muted-foreground w-[40px]"
                  rowSpan={2}
                >
                  Occ
                </th>
                {allTypes.map((t) => (
                  <th
                    key={t}
                    colSpan={2}
                    className="text-center px-1 py-1 text-xs font-semibold text-primary border-l border-border/40 group/col"
                  >
                    <div className="flex items-center justify-center gap-1">
                      <input
                        type="text"
                        defaultValue={t}
                        onBlur={(e) => onRenameUnitType(t, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter")
                            (e.target as HTMLInputElement).blur();
                        }}
                        className="bg-transparent text-center text-xs font-semibold text-primary outline-none w-[70px] focus:border-b focus:border-primary/50"
                      />
                      <button
                        onClick={() => onRemoveUnitType(t)}
                        className="opacity-0 group-hover/col:opacity-100 text-muted-foreground hover:text-destructive"
                        title="Remove column"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  </th>
                ))}
                <th
                  className="px-1 py-1 border-l border-border/40 align-middle"
                  rowSpan={2}
                >
                  <button
                    onClick={onAddUnitType}
                    className="text-muted-foreground hover:text-foreground flex items-center gap-0.5 text-[10px]"
                    title="Add unit type column"
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                </th>
                <th
                  className="text-left px-2 py-1 text-xs font-medium text-muted-foreground"
                  rowSpan={2}
                >
                  Notes
                </th>
                <th className="w-[28px]" rowSpan={2} />
              </tr>
              <tr className="bg-muted/20 border-b border-border/40">
                {allTypes.map((t) => (
                  <React.Fragment key={t}>
                    <th className="text-right px-1 py-0.5 text-[10px] text-muted-foreground border-l border-border/40 w-[60px]">
                      Rent
                    </th>
                    <th className="text-right px-1 py-0.5 text-[10px] text-muted-foreground w-[45px]">
                      SF
                    </th>
                  </React.Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {comps.map((comp, i) => {
                const isSelected = selectedSet.has(i);
                return (
                  <tr
                    key={i}
                    className={`border-b border-border/20 ${
                      isSelected ? "bg-primary/5" : "opacity-40"
                    } group`}
                  >
                    <td className="px-1 py-1">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => onToggleSelected(i)}
                        className="rounded"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <input
                        type="text"
                        value={comp.name}
                        onChange={(e) =>
                          onUpdateComp(i, { name: e.target.value })
                        }
                        className="w-full bg-transparent text-xs outline-none font-medium"
                        placeholder="Property name"
                      />
                      <input
                        type="text"
                        value={comp.address}
                        onChange={(e) =>
                          onUpdateComp(i, { address: e.target.value })
                        }
                        className="w-full bg-transparent text-[10px] outline-none text-muted-foreground"
                        placeholder="Address"
                      />
                    </td>
                    <td className="px-1 py-1">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={comp.distance_mi || ""}
                        onChange={(e) =>
                          onUpdateComp(i, {
                            distance_mi: parseFloat(e.target.value) || 0,
                          })
                        }
                        className="w-full text-right bg-transparent text-xs outline-none tabular-nums"
                      />
                    </td>
                    <td className="px-1 py-1">
                      <input
                        type="text"
                        inputMode="numeric"
                        value={comp.year_built || ""}
                        onChange={(e) =>
                          onUpdateComp(i, {
                            year_built: parseInt(e.target.value) || 0,
                          })
                        }
                        className="w-full text-right bg-transparent text-xs outline-none tabular-nums"
                      />
                    </td>
                    <td className="px-1 py-1">
                      <input
                        type="text"
                        inputMode="numeric"
                        value={comp.units || ""}
                        onChange={(e) =>
                          onUpdateComp(i, {
                            units: parseInt(e.target.value) || 0,
                          })
                        }
                        className="w-full text-right bg-transparent text-xs outline-none tabular-nums"
                      />
                    </td>
                    <td className="px-1 py-1">
                      <input
                        type="text"
                        inputMode="numeric"
                        value={comp.occupancy_pct || ""}
                        onChange={(e) =>
                          onUpdateComp(i, {
                            occupancy_pct: parseInt(e.target.value) || 0,
                          })
                        }
                        className="w-full text-right bg-transparent text-xs outline-none tabular-nums"
                      />
                    </td>
                    {allTypes.map((t) => {
                      const ut = (comp.unit_types || []).find(
                        (u) => u.type === t
                      );
                      return (
                        <React.Fragment key={t}>
                          <td className="px-1 py-1 border-l border-border/40">
                            <input
                              type="text"
                              inputMode="decimal"
                              value={ut?.rent || ""}
                              onChange={(e) =>
                                onUpdateUnitTypeCell(
                                  i,
                                  t,
                                  "rent",
                                  parseFloat(e.target.value.replace(/,/g, "")) ||
                                    0
                                )
                              }
                              className="w-full text-right bg-transparent text-xs outline-none tabular-nums"
                              placeholder="—"
                            />
                          </td>
                          <td className="px-1 py-1">
                            <input
                              type="text"
                              inputMode="numeric"
                              value={ut?.sf || ""}
                              onChange={(e) =>
                                onUpdateUnitTypeCell(
                                  i,
                                  t,
                                  "sf",
                                  parseInt(e.target.value) || 0
                                )
                              }
                              className="w-full text-right bg-transparent text-xs outline-none tabular-nums"
                              placeholder="—"
                            />
                          </td>
                        </React.Fragment>
                      );
                    })}
                    <td />
                    <td className="px-2 py-1">
                      <input
                        type="text"
                        value={comp.notes || ""}
                        onChange={(e) =>
                          onUpdateComp(i, { notes: e.target.value })
                        }
                        className="w-full bg-transparent text-xs outline-none"
                        placeholder="Notes"
                      />
                    </td>
                    <td className="px-1 py-1">
                      <button
                        onClick={() => onDelete(i)}
                        className="text-muted-foreground/30 hover:text-destructive opacity-0 group-hover:opacity-100"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Averages row */}
          {selectedSet.size > 0 && (
            <div className="mt-3 p-3 bg-muted/20 border border-border/30 rounded-lg">
              <p className="text-xs font-medium text-muted-foreground mb-1.5">
                Avg. {isStudent ? "Bed" : "Unit"} Rents (Selected)
              </p>
              <div className="flex flex-wrap gap-2">
                {allTypes.map((t) => {
                  const rents = comps
                    .filter((_, i) => selectedSet.has(i))
                    .flatMap((c) =>
                      (c.unit_types || [])
                        .filter((u) => u.type === t && u.rent > 0)
                        .map((u) => u.rent)
                    );
                  if (rents.length === 0) return null;
                  return (
                    <span
                      key={t}
                      className="text-xs bg-card border border-border/40 px-2 py-1 rounded tabular-nums"
                    >
                      {t}:{" "}
                      <span className="font-semibold">
                        $
                        {Math.round(
                          rents.reduce((a, b) => a + b, 0) / rents.length
                        ).toLocaleString()}
                      </span>
                      /mo
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ) : (
        // ── Commercial: $/SF table ───────────────────────────────────────
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-muted/30 border-b border-border/40">
                <th className="px-1 py-1 w-[24px]" />
                <th className="text-left px-2 py-1 text-xs font-medium text-muted-foreground">
                  Property
                </th>
                <th className="text-right px-1 py-1 text-xs font-medium text-muted-foreground w-[45px]">
                  Dist
                </th>
                <th className="text-right px-1 py-1 text-xs font-medium text-muted-foreground w-[40px]">
                  Yr
                </th>
                <th className="text-right px-1 py-1 text-xs font-medium text-muted-foreground w-[60px]">
                  SF
                </th>
                <th className="text-right px-1 py-1 text-xs font-medium text-muted-foreground w-[60px]">
                  $/SF
                </th>
                <th className="text-right px-1 py-1 text-xs font-medium text-muted-foreground w-[40px]">
                  Occ
                </th>
                <th className="text-center px-1 py-1 text-xs font-medium text-muted-foreground w-[60px]">
                  Lease
                </th>
                <th className="text-left px-2 py-1 text-xs font-medium text-muted-foreground">
                  Notes
                </th>
                <th className="w-[28px]" />
              </tr>
            </thead>
            <tbody>
              {comps.map((comp, i) => {
                const isSelected = selectedSet.has(i);
                return (
                  <tr
                    key={i}
                    className={`border-b border-border/20 ${
                      isSelected ? "bg-primary/5" : "opacity-40"
                    } group`}
                  >
                    <td className="px-1 py-1">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => onToggleSelected(i)}
                        className="rounded"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <input
                        type="text"
                        value={comp.name}
                        onChange={(e) =>
                          onUpdateComp(i, { name: e.target.value })
                        }
                        className="w-full bg-transparent text-xs font-medium outline-none"
                        placeholder="Property"
                      />
                      <input
                        type="text"
                        value={comp.address}
                        onChange={(e) =>
                          onUpdateComp(i, { address: e.target.value })
                        }
                        className="w-full bg-transparent text-[10px] outline-none text-muted-foreground"
                        placeholder="Address"
                      />
                    </td>
                    <td className="px-1 py-1">
                      <input
                        type="text"
                        value={comp.distance_mi || ""}
                        onChange={(e) =>
                          onUpdateComp(i, {
                            distance_mi: parseFloat(e.target.value) || 0,
                          })
                        }
                        className="w-full text-right bg-transparent text-xs outline-none tabular-nums"
                      />
                    </td>
                    <td className="px-1 py-1">
                      <input
                        type="text"
                        value={comp.year_built || ""}
                        onChange={(e) =>
                          onUpdateComp(i, {
                            year_built: parseInt(e.target.value) || 0,
                          })
                        }
                        className="w-full text-right bg-transparent text-xs outline-none tabular-nums"
                      />
                    </td>
                    <td className="px-1 py-1">
                      <input
                        type="text"
                        value={comp.total_sf || ""}
                        onChange={(e) =>
                          onUpdateComp(i, {
                            total_sf:
                              parseInt(e.target.value.replace(/,/g, "")) || 0,
                          })
                        }
                        className="w-full text-right bg-transparent text-xs outline-none tabular-nums"
                      />
                    </td>
                    <td className="px-1 py-1">
                      <input
                        type="text"
                        value={comp.rent_per_sf || ""}
                        onChange={(e) =>
                          onUpdateComp(i, {
                            rent_per_sf: parseFloat(e.target.value) || 0,
                          })
                        }
                        className="w-full text-right bg-transparent text-xs outline-none tabular-nums font-medium"
                      />
                    </td>
                    <td className="px-1 py-1">
                      <input
                        type="text"
                        value={comp.occupancy_pct || ""}
                        onChange={(e) =>
                          onUpdateComp(i, {
                            occupancy_pct: parseInt(e.target.value) || 0,
                          })
                        }
                        className="w-full text-right bg-transparent text-xs outline-none tabular-nums"
                      />
                    </td>
                    <td className="px-1 py-1">
                      <input
                        type="text"
                        value={comp.lease_type || ""}
                        onChange={(e) =>
                          onUpdateComp(i, { lease_type: e.target.value })
                        }
                        className="w-full text-center bg-transparent text-xs outline-none"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <input
                        type="text"
                        value={comp.notes || ""}
                        onChange={(e) =>
                          onUpdateComp(i, { notes: e.target.value })
                        }
                        className="w-full bg-transparent text-xs outline-none"
                        placeholder="Notes"
                      />
                    </td>
                    <td className="px-1 py-1">
                      <button
                        onClick={() => onDelete(i)}
                        className="text-muted-foreground/30 hover:text-destructive opacity-0 group-hover:opacity-100"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
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

interface CompAttachment {
  name: string;
  mediaType:
    | "image/png"
    | "image/jpeg"
    | "image/webp"
    | "image/gif"
    | "application/pdf";
  /** base64-encoded payload (no data: prefix) */
  data: string;
  /** Local preview URL for images; null for PDFs. */
  previewUrl: string | null;
  /** Original byte size for the size badge. */
  size: number;
}

const SUPPORTED_ATTACHMENT_TYPES: Array<CompAttachment["mediaType"]> = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
];

// Total cap for all attachments per request — keeps Claude payloads under the
// vision request limits and avoids accidentally uploading a giant PDF.
const MAX_ATTACHMENTS_BYTES = 20 * 1024 * 1024;

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("File read returned non-string"));
        return;
      }
      // result looks like "data:<mime>;base64,<data>"
      const idx = result.indexOf(",");
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(reader.error || new Error("File read failed"));
    reader.readAsDataURL(file);
  });
}

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
  const [attachments, setAttachments] = useState<CompAttachment[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null);
  const [saving, setSaving] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  // Revoke object URLs on unmount / when attachments are removed so we don't
  // leak browser memory across multiple paste sessions.
  useEffect(() => {
    return () => {
      for (const a of attachments) {
        if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
      }
    };
    // We only want this to run on unmount. Per-attachment URLs are revoked in
    // removeAttachment().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function ingestFiles(files: FileList | File[]) {
    const incoming = Array.from(files);
    if (incoming.length === 0) return;

    const currentBytes = attachments.reduce((s, a) => s + a.size, 0);
    let runningBytes = currentBytes;
    const next: CompAttachment[] = [];

    for (const file of incoming) {
      const mediaType = file.type as CompAttachment["mediaType"];
      if (!SUPPORTED_ATTACHMENT_TYPES.includes(mediaType)) {
        toast.error(`Skipped ${file.name}: unsupported file type (${file.type || "unknown"})`);
        continue;
      }
      if (runningBytes + file.size > MAX_ATTACHMENTS_BYTES) {
        toast.error(
          `Skipped ${file.name}: total attachments would exceed ${Math.round(
            MAX_ATTACHMENTS_BYTES / (1024 * 1024)
          )}MB`
        );
        continue;
      }
      try {
        const data = await readFileAsBase64(file);
        const previewUrl = mediaType.startsWith("image/")
          ? URL.createObjectURL(file)
          : null;
        next.push({
          name: file.name,
          mediaType,
          data,
          previewUrl,
          size: file.size,
        });
        runningBytes += file.size;
      } catch (err) {
        console.error("Failed to read", file.name, err);
        toast.error(`Failed to read ${file.name}`);
      }
    }

    if (next.length > 0) setAttachments((prev) => [...prev, ...next]);
  }

  function removeAttachment(idx: number) {
    setAttachments((prev) => {
      const out = [...prev];
      const [removed] = out.splice(idx, 1);
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
      return out;
    });
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer?.files) {
      void ingestFiles(e.dataTransfer.files);
    }
  }

  // Capture screenshots that the user pastes from the clipboard directly into
  // the modal (Cmd/Ctrl+V after a screenshot). React onPaste on the wrapper.
  function handlePasteEvent(e: React.ClipboardEvent<HTMLDivElement>) {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const item of Array.from(items)) {
      if (item.kind === "file") {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      void ingestFiles(files);
    }
  }

  async function handleExtract() {
    const trimmed = text.trim();
    const url = sourceUrl.trim();
    if (trimmed.length < 20 && attachments.length === 0 && !url) {
      toast.error(
        "Add at least one of: a source URL, listing text (20+ chars), or a screenshot/PDF"
      );
      return;
    }
    setExtracting(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/comps/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pasted_text: text,
          source_url: url || undefined,
          expected_type: compType,
          attachments: attachments.map((a) => ({
            media_type: a.mediaType,
            data: a.data,
          })),
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

        <div className="p-5 space-y-4" onPaste={handlePasteEvent}>
          {!draft ? (
            <>
              {/* Source URL — primary field. We don't auto-fetch broker sites
                  (see src/lib/web-allowlist.ts) but the slug + path give Claude
                  a strong hint about the property name and city. */}
              <div>
                <label className="block text-[10px] text-muted-foreground uppercase tracking-wide mb-1">
                  Source URL
                </label>
                <input
                  type="text"
                  value={sourceUrl}
                  onChange={(e) => setSourceUrl(e.target.value)}
                  placeholder="https://www.zillow.com/apartments/..."
                  className="w-full px-3 py-2 text-sm bg-muted/20 border border-border/40 rounded-lg outline-none focus:border-primary/40"
                />
                <p className="text-[10px] text-muted-foreground/80 mt-1">
                  Reference only — broker sites block server-side fetches. Drop a
                  screenshot below for the best extraction.
                </p>
              </div>

              {/* Attachments drop zone */}
              <div>
                <label className="block text-[10px] text-muted-foreground uppercase tracking-wide mb-1">
                  Screenshots / Images / PDF
                </label>
                <div
                  onDragEnter={(e) => {
                    e.preventDefault();
                    setDragActive(true);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragActive(true);
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    setDragActive(false);
                  }}
                  onDrop={handleDrop}
                  className={`border-2 border-dashed rounded-lg px-4 py-6 text-center transition-colors ${
                    dragActive
                      ? "border-primary/60 bg-primary/5"
                      : "border-border/40 bg-muted/10 hover:bg-muted/20"
                  }`}
                >
                  <Upload className="h-5 w-5 mx-auto mb-2 text-muted-foreground/70" />
                  <p className="text-xs text-muted-foreground">
                    Drag screenshots / images / PDFs here, paste from clipboard
                    (Cmd/Ctrl+V), or
                  </p>
                  <label className="inline-block mt-2 text-xs text-primary hover:underline cursor-pointer">
                    browse files
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif,application/pdf"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        if (e.target.files) void ingestFiles(e.target.files);
                        e.target.value = "";
                      }}
                    />
                  </label>
                  <p className="text-[10px] text-muted-foreground/70 mt-2">
                    PNG, JPEG, WEBP, GIF, or PDF — up to 20MB total
                  </p>
                </div>

                {attachments.length > 0 && (
                  <div className="mt-2 grid grid-cols-3 sm:grid-cols-4 gap-2">
                    {attachments.map((att, i) => (
                      <div
                        key={i}
                        className="relative group border border-border/40 rounded-md overflow-hidden bg-muted/20 aspect-[4/3] flex items-center justify-center"
                      >
                        {att.previewUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={att.previewUrl}
                            alt={att.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="flex flex-col items-center text-muted-foreground p-2">
                            <FileText className="h-6 w-6 mb-1" />
                            <span className="text-[10px] truncate max-w-full">
                              PDF
                            </span>
                          </div>
                        )}
                        <button
                          onClick={() => removeAttachment(i)}
                          className="absolute top-1 right-1 bg-background/80 hover:bg-background border border-border/40 rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Remove"
                        >
                          <X className="h-3 w-3" />
                        </button>
                        <div className="absolute bottom-0 inset-x-0 bg-background/80 px-1.5 py-0.5 text-[10px] truncate flex items-center gap-1">
                          {att.previewUrl ? (
                            <ImageIcon className="h-2.5 w-2.5 flex-shrink-0" />
                          ) : (
                            <FileText className="h-2.5 w-2.5 flex-shrink-0" />
                          )}
                          <span className="truncate">{att.name}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Optional pasted text — supplements the URL + screenshots. */}
              <div>
                <label className="block text-[10px] text-muted-foreground uppercase tracking-wide mb-1">
                  Pasted Listing Text (optional)
                </label>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Optional — paste any additional listing text Claude should consider (e.g. the unit-mix table, broker notes, recent renovations)…"
                  rows={6}
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
