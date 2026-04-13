"use client";

import { useState, useCallback, useEffect } from "react";
import {
  Loader2,
  Download,
  RefreshCw,
  Users,
  Briefcase,
  Home,
  DollarSign,
  TrendingUp,
  TrendingDown,
  Building2,
  GraduationCap,
  MapPin,
  ChevronDown,
  ChevronRight,
  Save,
  Upload,
  Info,
  BarChart3,
  Target,
  FileText,
  X,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type {
  DemographicSnapshot,
  LocationIntelligence as LocationIntelligenceType,
  LocationRadiusMiles,
} from "@/lib/types";
import { LOCATION_RADIUS_OPTIONS } from "@/lib/types";

// ── Helpers ──────────────────────────────────────────────────────────────────

const fn = (n: number | null | undefined, digits = 0) =>
  n == null ? "—" : Number(n).toLocaleString("en-US", { maximumFractionDigits: digits });
const fc = (n: number | null | undefined) =>
  n == null ? "—" : "$" + Math.round(Number(n)).toLocaleString("en-US");
const fpct = (n: number | null | undefined, digits = 1) =>
  n == null ? "—" : Number(n).toFixed(digits) + "%";

function TrendBadge({ value, suffix = "%" }: { value: number | null | undefined; suffix?: string }) {
  if (value == null) return <span className="text-muted-foreground text-[10px]">—</span>;
  const positive = value > 0;
  const neutral = value === 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[10px] font-medium ${
        neutral
          ? "text-muted-foreground"
          : positive
          ? "text-emerald-400"
          : "text-red-400"
      }`}
    >
      {positive ? (
        <TrendingUp className="h-3 w-3" />
      ) : neutral ? null : (
        <TrendingDown className="h-3 w-3" />
      )}
      {positive ? "+" : ""}
      {Number(value).toFixed(1)}
      {suffix}
    </span>
  );
}

// ── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  subtitle,
  trend,
  trendLabel,
  icon: Icon,
}: {
  label: string;
  value: string;
  subtitle?: string;
  trend?: number | null;
  trendLabel?: string;
  icon: typeof Users;
}) {
  return (
    <div className="border border-border/40 rounded-lg bg-muted/10 p-3.5 space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
          <Icon className="h-3 w-3" />
          {label}
        </span>
        {trend != null && (
          <TrendBadge value={trend} suffix={trendLabel || "%"} />
        )}
      </div>
      <div className="text-lg font-semibold text-foreground">{value}</div>
      {subtitle && (
        <div className="text-[10px] text-muted-foreground">{subtitle}</div>
      )}
    </div>
  );
}

// ── Inline editor for a numeric field ────────────────────────────────────────

function InlineField({
  label,
  value,
  onChange,
  suffix,
  type = "number",
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

// ── Collapsible section ──────────────────────────────────────────────────────

function Panel({
  title,
  icon,
  children,
  defaultOpen = true,
  action,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  action?: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-border/60 rounded-xl bg-card shadow-card overflow-hidden">
      <div className="w-full flex items-center gap-3 px-5 py-3 bg-muted/20 text-left">
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

// ── Industry bar ─────────────────────────────────────────────────────────────

function IndustryBar({
  industries,
}: {
  industries: Array<{ name: string; share_pct?: number }>;
}) {
  if (!industries || industries.length === 0) {
    return (
      <div className="text-xs text-muted-foreground py-2">
        No industry data available
      </div>
    );
  }
  const maxPct = Math.max(...industries.map((i) => i.share_pct ?? 0));
  return (
    <div className="space-y-1.5">
      {industries.map((ind, idx) => (
        <div key={idx} className="flex items-center gap-2 text-xs">
          <span className="w-[180px] truncate text-muted-foreground flex-shrink-0">
            {ind.name}
          </span>
          <div className="flex-1 h-2 bg-muted/30 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full bg-primary/60"
              style={{
                width: `${maxPct > 0 ? ((ind.share_pct ?? 0) / maxPct) * 100 : 0}%`,
              }}
            />
          </div>
          <span className="w-12 text-right text-muted-foreground flex-shrink-0">
            {ind.share_pct != null ? `${ind.share_pct}%` : "—"}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

interface Props {
  dealId: string;
  dealLat: number | null;
  dealLng: number | null;
  dealAddress?: string | null;
}

// ── Data Source Wizard ───────────────────────────────────────────────────────

const DATA_SOURCES = [
  { id: "census", label: "Census ACS", description: "Demographics, income, housing, education", icon: Users, free: true },
  { id: "bls_qcew", label: "BLS Employment", description: "Quarterly jobs, wages, establishments", icon: Briefcase, free: true },
  { id: "bls_laus", label: "BLS Unemployment", description: "Monthly unemployment rate (most current)", icon: Briefcase, free: true },
  { id: "hpi", label: "FHFA House Prices", description: "State-level home price appreciation trends", icon: Wallet, free: true, needsKey: "FRED_API_KEY" },
  { id: "permits", label: "Building Permits", description: "Annual new construction permits (supply pipeline)", icon: Building2, free: true },
  { id: "fmr", label: "HUD Fair Market Rents", description: "Official rent benchmarks by bedroom count", icon: Home, free: true, needsKey: "HUD_API_TOKEN" },
  { id: "population", label: "Population Estimates", description: "Annual county population (more current than ACS)", icon: Users, free: true },
  { id: "migration", label: "Migration Flows", description: "Inflow/outflow — where people are moving", icon: TrendingUp, free: true },
  { id: "flood", label: "FEMA Flood Zone", description: "Flood risk + auto-populates Site & Zoning", icon: MapPin, free: true },
] as const;

type DataSourceId = typeof DATA_SOURCES[number]["id"];

function DataSourceWizard({
  snapshot,
  onFetchCensus,
  fetchingCensus,
  onFetchBls,
  fetchingBls,
  onFetchHpi,
  fetchingHpi,
  dealId,
  selectedRadius,
  onDataLoaded,
}: {
  snapshot: DemographicSnapshot | null;
  onFetchCensus: () => void;
  fetchingCensus: boolean;
  onFetchBls: () => void;
  fetchingBls: boolean;
  onFetchHpi: () => void;
  fetchingHpi: boolean;
  dealId: string;
  selectedRadius: number;
  onDataLoaded: () => void;
}) {
  const [selected, setSelected] = useState<Set<DataSourceId>>(new Set());
  const [running, setRunning] = useState<Set<DataSourceId>>(new Set());
  const [completed, setCompleted] = useState<Set<DataSourceId>>(new Set());
  const [open, setOpen] = useState(!snapshot);

  function toggleSource(id: DataSourceId) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(DATA_SOURCES.map((s) => s.id)));
  }

  async function fetchSource(id: DataSourceId) {
    setRunning((prev) => new Set([...Array.from(prev), id]));
    try {
      let url = "";
      switch (id) {
        case "census": onFetchCensus(); setCompleted((p) => new Set([...Array.from(p), id])); return;
        case "bls_qcew": onFetchBls(); setCompleted((p) => new Set([...Array.from(p), id])); return;
        case "hpi": onFetchHpi(); setCompleted((p) => new Set([...Array.from(p), id])); return;
        case "bls_laus": url = `/api/deals/${dealId}/location-intelligence/fetch-laus`; break;
        case "permits": url = `/api/deals/${dealId}/location-intelligence/fetch-permits`; break;
        case "fmr": url = `/api/deals/${dealId}/location-intelligence/fetch-fmr`; break;
        case "population": url = `/api/deals/${dealId}/location-intelligence/fetch-population`; break;
        case "migration": url = `/api/deals/${dealId}/location-intelligence/fetch-migration`; break;
        case "flood": url = `/api/deals/${dealId}/location-intelligence/fetch-flood`; break;
      }
      if (url) {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ radius_miles: selectedRadius }),
        });
        const json = await res.json();
        if (!res.ok) {
          toast.error(`${id}: ${json.error || "Failed"}`);
        } else {
          toast.success(`${DATA_SOURCES.find((s) => s.id === id)?.label} loaded`);
          setCompleted((p) => new Set([...Array.from(p), id]));
          onDataLoaded();
        }
      }
    } catch {
      toast.error(`Failed to fetch ${id}`);
    } finally {
      setRunning((prev) => {
        const next = new Set(Array.from(prev));
        next.delete(id);
        return next;
      });
    }
  }

  async function fetchSelected() {
    const ids = Array.from(selected);
    for (const id of ids) {
      await fetchSource(id);
    }
    setSelected(new Set());
  }

  const anyRunning = running.size > 0 || fetchingCensus || fetchingBls || fetchingHpi;

  return (
    <Panel
      title="Data Sources"
      icon={<Download className="h-4 w-4 text-primary" />}
      defaultOpen={open}
      action={
        <div className="flex items-center gap-2">
          <button
            onClick={(e) => { e.stopPropagation(); selectAll(); }}
            className="text-[10px] text-primary hover:underline"
          >
            Select All
          </button>
          {selected.size > 0 && (
            <Button
              size="sm"
              onClick={(e) => { e.stopPropagation(); fetchSelected(); }}
              disabled={anyRunning}
            >
              {anyRunning ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
              ) : (
                <Download className="h-3.5 w-3.5 mr-1.5" />
              )}
              Fetch {selected.size} Source{selected.size === 1 ? "" : "s"}
            </Button>
          )}
        </div>
      }
    >
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        {DATA_SOURCES.map((src) => {
          const isRunning = running.has(src.id) ||
            (src.id === "census" && fetchingCensus) ||
            (src.id === "bls_qcew" && fetchingBls) ||
            (src.id === "hpi" && fetchingHpi);
          const isDone = completed.has(src.id);
          const isSelected = selected.has(src.id);
          const Icon = src.icon;

          return (
            <button
              key={src.id}
              onClick={() => toggleSource(src.id)}
              className={`flex items-start gap-2.5 p-2.5 rounded-lg border text-left transition-all ${
                isSelected
                  ? "border-primary/40 bg-primary/5"
                  : isDone
                  ? "border-emerald-500/30 bg-emerald-500/5"
                  : "border-border/40 bg-muted/10 hover:border-border/60"
              }`}
            >
              <div className="flex-shrink-0 mt-0.5">
                {isRunning ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                ) : isDone ? (
                  <div className="h-3.5 w-3.5 rounded-full bg-emerald-500/20 flex items-center justify-center">
                    <div className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  </div>
                ) : isSelected ? (
                  <div className="h-3.5 w-3.5 rounded border border-primary bg-primary/20 flex items-center justify-center">
                    <div className="h-1.5 w-1.5 rounded-sm bg-primary" />
                  </div>
                ) : (
                  <Icon className="h-3.5 w-3.5 text-muted-foreground/60" />
                )}
              </div>
              <div className="min-w-0">
                <div className="text-xs font-medium text-foreground/90 flex items-center gap-1.5">
                  {src.label}
                  {isDone && <span className="text-[9px] text-emerald-400">loaded</span>}
                </div>
                <div className="text-[10px] text-muted-foreground/70 leading-tight mt-0.5">
                  {src.description}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </Panel>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function LocationIntelligence({
  dealId,
  dealLat,
  dealLng,
  dealAddress,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [fetchingBls, setFetchingBls] = useState(false);
  const [fetchingHpi, setFetchingHpi] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [pasteReportOpen, setPasteReportOpen] = useState(false);
  const [reportText, setReportText] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [selectedRadius, setSelectedRadius] = useState<LocationRadiusMiles>(3);
  const [allData, setAllData] = useState<Record<number, LocationIntelligenceType>>({});
  const [meta, setMeta] = useState<{
    source?: string;
    year?: number;
    prior_year?: number;
    geography?: string;
    tracts_found?: number;
    tracts_with_data?: number;
    counties?: number;
    radius_miles?: number;
    note?: string;
  } | null>(null);

  // Projections editing state
  const [projections, setProjections] = useState<{
    population_growth_5yr_pct: number | null;
    job_growth_5yr_pct: number | null;
    home_value_growth_5yr_pct: number | null;
    rent_growth_5yr_pct: number | null;
    new_units_pipeline: number | null;
    notes: string | null;
  }>({
    population_growth_5yr_pct: null,
    job_growth_5yr_pct: null,
    home_value_growth_5yr_pct: null,
    rent_growth_5yr_pct: null,
    new_units_pipeline: null,
    notes: null,
  });

  const currentData = allData[selectedRadius];
  const snapshot: DemographicSnapshot | null = currentData
    ? typeof currentData.data === "string"
      ? JSON.parse(currentData.data)
      : currentData.data
    : null;

  // Load all location intelligence data for this deal
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/location-intelligence`);
      const json = await res.json();
      const rows: LocationIntelligenceType[] = json.data || [];
      const byRadius: Record<number, LocationIntelligenceType> = {};
      for (const row of rows) {
        byRadius[Number(row.radius_miles)] = row;
      }
      setAllData(byRadius);

      // Load projections for current radius
      const curr = byRadius[selectedRadius];
      if (curr?.projections) {
        const p =
          typeof curr.projections === "string"
            ? JSON.parse(curr.projections)
            : curr.projections;
        setProjections({
          population_growth_5yr_pct: p.population_growth_5yr_pct ?? null,
          job_growth_5yr_pct: p.job_growth_5yr_pct ?? null,
          home_value_growth_5yr_pct: p.home_value_growth_5yr_pct ?? null,
          rent_growth_5yr_pct: p.rent_growth_5yr_pct ?? null,
          new_units_pipeline: p.new_units_pipeline ?? null,
          notes: p.notes ?? null,
        });
      }
    } catch (err) {
      console.error(err);
      toast.error("Failed to load location intelligence data");
    } finally {
      setLoading(false);
    }
  }, [dealId, selectedRadius]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // When radius changes, update projections from stored data
  useEffect(() => {
    const curr = allData[selectedRadius];
    if (curr?.projections) {
      const p =
        typeof curr.projections === "string"
          ? JSON.parse(curr.projections)
          : curr.projections;
      setProjections({
        population_growth_5yr_pct: p.population_growth_5yr_pct ?? null,
        job_growth_5yr_pct: p.job_growth_5yr_pct ?? null,
        home_value_growth_5yr_pct: p.home_value_growth_5yr_pct ?? null,
        rent_growth_5yr_pct: p.rent_growth_5yr_pct ?? null,
        new_units_pipeline: p.new_units_pipeline ?? null,
        notes: p.notes ?? null,
      });
      setDirty(false);
    } else {
      setProjections({
        population_growth_5yr_pct: null,
        job_growth_5yr_pct: null,
        home_value_growth_5yr_pct: null,
        rent_growth_5yr_pct: null,
        new_units_pipeline: null,
        notes: null,
      });
      setDirty(false);
    }
  }, [selectedRadius, allData]);

  // Fetch Census data
  async function handleFetchCensus() {
    setFetching(true);
    setMeta(null);
    try {
      const res = await fetch(
        `/api/deals/${dealId}/location-intelligence/fetch-census`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ radius_miles: selectedRadius }),
        }
      );
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || "Failed to fetch Census data");
        return;
      }
      if (json.meta) setMeta(json.meta);
      toast.success("Census data loaded successfully");
      loadData();
    } catch {
      toast.error("Failed to fetch Census data");
    } finally {
      setFetching(false);
    }
  }

  // Fetch BLS employment data
  async function handleFetchBls() {
    setFetchingBls(true);
    try {
      const res = await fetch(
        `/api/deals/${dealId}/location-intelligence/fetch-bls`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ radius_miles: selectedRadius }),
        }
      );
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || "Failed to fetch BLS data");
        return;
      }
      const q = json.data;
      toast.success(
        `BLS employment data loaded (${q.year} Q${q.quarter}: ${Number(q.total_employment).toLocaleString()} jobs)`
      );
      loadData();
    } catch {
      toast.error("Failed to fetch BLS data");
    } finally {
      setFetchingBls(false);
    }
  }

  // Fetch FHFA HPI data
  async function handleFetchHpi() {
    setFetchingHpi(true);
    try {
      const res = await fetch(
        `/api/deals/${dealId}/location-intelligence/fetch-hpi`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ radius_miles: selectedRadius }),
        }
      );
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || "Failed to fetch HPI data");
        return;
      }
      const hpi = json.data;
      toast.success(
        `House Price Index loaded (YoY: ${hpi.yoy_change_pct != null ? hpi.yoy_change_pct + "%" : "N/A"})`
      );
      loadData();
    } catch {
      toast.error("Failed to fetch HPI data");
    } finally {
      setFetchingHpi(false);
    }
  }

  // Extract from pasted report
  async function handleExtractReport() {
    if (reportText.trim().length < 50) {
      toast.error("Paste at least a few lines of report data");
      return;
    }
    setExtracting(true);
    try {
      const res = await fetch(
        `/api/deals/${dealId}/location-intelligence/extract-report`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: reportText,
            radius_miles: selectedRadius,
          }),
        }
      );
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || "Failed to extract report data");
        return;
      }
      const { fields_extracted, source_description } = json.extracted || {};
      toast.success(
        `Extracted ${fields_extracted || 0} fields${source_description ? ` from ${source_description}` : ""}`
      );
      setPasteReportOpen(false);
      setReportText("");
      loadData();
    } catch {
      toast.error("Failed to extract report data");
    } finally {
      setExtracting(false);
    }
  }

  // Save projections
  async function handleSaveProjections() {
    setSaving(true);
    try {
      const dataToSave = snapshot || {};
      const res = await fetch(
        `/api/deals/${dealId}/location-intelligence`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            radius_miles: selectedRadius,
            data: dataToSave,
            projections,
            data_source: currentData?.data_source || "manual",
            source_year: currentData?.source_year || null,
            source_notes: currentData?.source_notes || null,
          }),
        }
      );
      if (!res.ok) {
        toast.error("Failed to save projections");
        return;
      }
      setDirty(false);
      toast.success("Projections saved");
      loadData();
    } catch {
      toast.error("Save failed");
    } finally {
      setSaving(false);
    }
  }

  function updateProjection(key: string, rawVal: string) {
    const val = rawVal === "" ? null : Number(rawVal);
    setProjections((prev) => ({ ...prev, [key]: val }));
    setDirty(true);
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (!dealLat || !dealLng) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <MapPin className="h-10 w-10 text-muted-foreground/40 mb-3" />
        <p className="text-sm text-muted-foreground">
          Geocode this deal to unlock location intelligence.
        </p>
        <p className="text-xs text-muted-foreground/70 mt-1">
          Go to the Comps tab and click &quot;Geocode Subject&quot; to set the
          property coordinates.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* ── Radius Selector + Actions ──────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-primary" />
          <span className="text-xs font-medium text-muted-foreground">Radius:</span>
          <div className="inline-flex items-center rounded-lg border border-border/40 bg-muted/20 p-0.5">
            {LOCATION_RADIUS_OPTIONS.map((r) => (
              <button
                key={r}
                onClick={() => setSelectedRadius(r)}
                className={`px-3 py-1 text-xs rounded-md transition-colors ${
                  selectedRadius === r
                    ? "bg-primary/15 text-primary font-medium"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {r} mi
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {dirty && (
            <Button
              size="sm"
              variant="default"
              onClick={handleSaveProjections}
              disabled={saving}
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              <span className="ml-1.5">Save Projections</span>
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => setPasteReportOpen(true)}
            title="Paste text from CoStar, ESRI, or other market reports"
          >
            <FileText className="h-3.5 w-3.5 mr-1.5" />
            Paste Report
          </Button>
        </div>
      </div>

      {/* ── Data Source Wizard ──────────────────────────────────────── */}
      <DataSourceWizard
        snapshot={snapshot}
        onFetchCensus={handleFetchCensus}
        fetchingCensus={fetching}
        onFetchBls={handleFetchBls}
        fetchingBls={fetchingBls}
        onFetchHpi={handleFetchHpi}
        fetchingHpi={fetchingHpi}
        dealId={dealId}
        selectedRadius={selectedRadius}
        onDataLoaded={loadData}
      />

      {/* Data source info */}
      {(currentData?.data_source || meta) && (
        <div className="flex items-start gap-2 p-2.5 rounded-lg bg-primary/5 border border-primary/20 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5 flex-shrink-0 mt-0.5 text-primary/60" />
          <div>
            <span className="font-medium text-foreground/80">
              {meta?.source || "Census ACS 5-Year"}
            </span>
            {currentData?.source_year && (
              <span> ({currentData.source_year})</span>
            )}
            {meta?.geography && <span> · {meta.geography}</span>}
            {meta?.tracts_with_data != null && (
              <span>
                {" "}· {meta.tracts_with_data} tract{meta.tracts_with_data === 1 ? "" : "s"}
                {meta?.counties != null && meta.counties > 1 && (
                  <> across {meta.counties} counties</>
                )}
              </span>
            )}
            {meta?.prior_year && (
              <span> · Growth rates: {meta.prior_year}–{meta.year}</span>
            )}
            {meta?.note && (
              <span className="block mt-0.5 text-muted-foreground/70">
                {meta.note}
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── No data state ─────────────────────────────────────────────── */}
      {!snapshot ? (
        <div className="border border-dashed border-border/40 rounded-xl bg-card/40 py-16 text-center">
          <BarChart3 className="h-10 w-10 mx-auto mb-3 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            No location data for {selectedRadius}-mile radius yet.
          </p>
          <p className="text-xs text-muted-foreground/70 mt-1 max-w-md mx-auto">
            Click &quot;Pull Census Data&quot; to automatically fetch population,
            demographics, income, housing, and employment data from the US Census
            Bureau, or manually enter data below.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="mt-4"
            onClick={handleFetchCensus}
            disabled={fetching}
          >
            {fetching ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
            ) : (
              <Download className="h-3.5 w-3.5 mr-1.5" />
            )}
            Pull Census Data
          </Button>
        </div>
      ) : (
        <>
          {/* ── Population & Demographics ──────────────────────────────── */}
          <Panel
            title="Population & Demographics"
            icon={<Users className="h-4 w-4 text-primary" />}
          >
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard
                label="Population"
                value={fn(snapshot.total_population)}
                trend={snapshot.population_growth_pct}
                trendLabel="% yr"
                icon={Users}
              />
              <StatCard
                label="Median Age"
                value={fn(snapshot.median_age, 1)}
                icon={Users}
              />
              <StatCard
                label="Avg Household Size"
                value={fn(snapshot.avg_household_size, 1)}
                icon={Home}
              />
              <StatCard
                label="Family Households"
                value={fpct(snapshot.family_households_pct)}
                icon={Users}
              />
              <StatCard
                label="Median HH Income"
                value={fc(snapshot.median_household_income)}
                icon={DollarSign}
              />
              <StatCard
                label="Per Capita Income"
                value={fc(snapshot.per_capita_income)}
                icon={DollarSign}
              />
              <StatCard
                label="Poverty Rate"
                value={fpct(snapshot.poverty_rate)}
                icon={DollarSign}
              />
              <StatCard
                label="Bachelor's Degree+"
                value={fpct(snapshot.bachelors_degree_pct)}
                icon={GraduationCap}
              />
            </div>
          </Panel>

          {/* ── Housing Market ─────────────────────────────────────────── */}
          <Panel
            title="Housing Market"
            icon={<Home className="h-4 w-4 text-primary" />}
          >
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard
                label="Median Home Value"
                value={fc(snapshot.median_home_value)}
                trend={snapshot.home_value_growth_pct}
                trendLabel="% yr"
                icon={Home}
              />
              <StatCard
                label="Median Rent"
                value={
                  snapshot.median_gross_rent != null
                    ? `$${fn(snapshot.median_gross_rent)}/mo`
                    : "—"
                }
                trend={snapshot.rent_growth_pct}
                trendLabel="% yr"
                icon={DollarSign}
              />
              <StatCard
                label="Total Housing Units"
                value={fn(snapshot.total_housing_units)}
                icon={Building2}
              />
              <StatCard
                label="Owner-Occupied"
                value={fpct(snapshot.owner_occupied_pct)}
                subtitle={
                  snapshot.renter_occupied_pct != null
                    ? `Renter: ${fpct(snapshot.renter_occupied_pct)}`
                    : undefined
                }
                icon={Home}
              />
            </div>
          </Panel>

          {/* ── Employment & Economy ───────────────────────────────────── */}
          <Panel
            title="Employment & Economy"
            icon={<Briefcase className="h-4 w-4 text-primary" />}
          >
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
              <StatCard
                label="Labor Force"
                value={fn(snapshot.labor_force)}
                icon={Briefcase}
              />
              <StatCard
                label="Total Employed"
                value={fn(snapshot.total_employed)}
                icon={Briefcase}
              />
              <StatCard
                label="Unemployment Rate"
                value={fpct(snapshot.unemployment_rate)}
                icon={Briefcase}
              />
              {(snapshot as unknown as Record<string, unknown>).avg_weekly_wage != null && (
                <StatCard
                  label="Avg Weekly Wage"
                  value={fc((snapshot as unknown as Record<string, unknown>).avg_weekly_wage as number)}
                  subtitle={(snapshot as unknown as Record<string, unknown>).bls_year
                    ? `BLS ${(snapshot as unknown as Record<string, unknown>).bls_year}Q${(snapshot as unknown as Record<string, unknown>).bls_quarter}`
                    : undefined}
                  icon={DollarSign}
                />
              )}
              {(snapshot as unknown as Record<string, unknown>).total_establishments != null && (
                <StatCard
                  label="Establishments"
                  value={fn((snapshot as unknown as Record<string, unknown>).total_establishments as number)}
                  icon={Building2}
                />
              )}
            </div>

            {/* Industry breakdown */}
            <div className="mt-3">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">
                Top Industries by Employment
              </div>
              <IndustryBar industries={snapshot.top_industries || []} />
            </div>
          </Panel>

          {/* ── Growth Projections (editable) ──────────────────────────── */}
          <Panel
            title="Growth Projections & Pipeline"
            icon={<TrendingUp className="h-4 w-4 text-primary" />}
            action={
              dirty ? (
                <Button
                  size="sm"
                  variant="default"
                  onClick={handleSaveProjections}
                  disabled={saving}
                >
                  {saving ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  <span className="ml-1.5">Save</span>
                </Button>
              ) : null
            }
          >
            <p className="text-xs text-muted-foreground mb-3">
              Enter projections from market reports, CoStar, ESRI, or your own
              analysis. These will be included in investment packages.
            </p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <InlineField
                label="Population Growth (5yr)"
                value={projections.population_growth_5yr_pct}
                onChange={(v) => updateProjection("population_growth_5yr_pct", v)}
                suffix="%"
              />
              <InlineField
                label="Job Growth (5yr)"
                value={projections.job_growth_5yr_pct}
                onChange={(v) => updateProjection("job_growth_5yr_pct", v)}
                suffix="%"
              />
              <InlineField
                label="Home Value Growth (5yr)"
                value={projections.home_value_growth_5yr_pct}
                onChange={(v) => updateProjection("home_value_growth_5yr_pct", v)}
                suffix="%"
              />
              <InlineField
                label="Rent Growth (5yr)"
                value={projections.rent_growth_5yr_pct}
                onChange={(v) => updateProjection("rent_growth_5yr_pct", v)}
                suffix="%"
              />
              <InlineField
                label="New Units Pipeline"
                value={projections.new_units_pipeline}
                onChange={(v) => updateProjection("new_units_pipeline", v)}
                suffix="units"
              />
            </div>
            <div className="mt-3">
              <label className="block text-[10px] text-muted-foreground uppercase tracking-wide mb-1">
                Notes / Sources
              </label>
              <textarea
                value={projections.notes ?? ""}
                onChange={(e) => {
                  setProjections((prev) => ({
                    ...prev,
                    notes: e.target.value || null,
                  }));
                  setDirty(true);
                }}
                placeholder="E.g., CoStar Q4 2024 submarket report, ESRI demographic forecast, local economic development authority data…"
                rows={2}
                className="w-full px-3 py-2 text-sm bg-muted/20 border border-border/40 rounded-lg outline-none resize-none focus:border-primary/40"
              />
            </div>
          </Panel>
        </>
      )}

      {/* ── Paste Report Modal ─────────────────────────────────────── */}
      {pasteReportOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-card border border-border/60 rounded-xl shadow-xl w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-border/40">
              <div>
                <h3 className="font-semibold text-sm">Paste Market Report</h3>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Paste text from CoStar, ESRI, Placer.ai, Yardi Matrix, or
                  any market report. Claude will extract demographics, housing,
                  employment, and growth projections.
                </p>
              </div>
              <button
                onClick={() => {
                  setPasteReportOpen(false);
                  setReportText("");
                }}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="px-5 py-4 flex-1 overflow-auto">
              <textarea
                value={reportText}
                onChange={(e) => setReportText(e.target.value)}
                placeholder={`Paste market report text here…\n\nExamples of what works well:\n• CoStar submarket demographic summaries\n• ESRI Community Analyst exports\n• Placer.ai trade area reports\n• Yardi Matrix market snapshots\n• Any text with population, income, rent, employment data`}
                rows={14}
                className="w-full px-3 py-2 text-sm bg-muted/20 border border-border/40 rounded-lg outline-none resize-none focus:border-primary/40 font-mono"
              />
              <div className="text-[10px] text-muted-foreground mt-1.5">
                Data will be extracted and merged with existing location
                intelligence for the {selectedRadius}-mile radius.
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border/40">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setPasteReportOpen(false);
                  setReportText("");
                }}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleExtractReport}
                disabled={extracting || reportText.trim().length < 50}
              >
                {extracting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                ) : (
                  <FileText className="h-3.5 w-3.5 mr-1.5" />
                )}
                Extract Data
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
