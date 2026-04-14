"use client";

import { useState, useCallback, useEffect } from "react";
import dynamic from "next/dynamic";
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
import { buildAmiTables } from "@/lib/ami-calc";

const LocationMapBuilder = dynamic(
  () => import("@/components/LocationMapBuilder"),
  {
    ssr: false,
    loading: () => (
      <div className="border border-border/40 rounded-xl bg-card/40 h-[600px] flex items-center justify-center text-xs text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        Loading map…
      </div>
    ),
  }
);

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
  { id: "diversity", label: "Diversity & Age", description: "Race/ethnicity, age distribution, languages", icon: Users, free: true },
  { id: "bls_qcew", label: "BLS Employment", description: "Quarterly jobs, wages, establishments", icon: Briefcase, free: true },
  { id: "bls_laus", label: "BLS Unemployment", description: "Monthly unemployment rate (most current)", icon: Briefcase, free: true },
  { id: "employers", label: "Top Employers", description: "Major employers, hospitals, universities nearby", icon: Building2, free: true },
  { id: "hpi", label: "FHFA House Prices", description: "State-level home price appreciation trends", icon: Wallet, free: true },
  { id: "permits", label: "Building Permits", description: "Annual new construction permits (supply pipeline)", icon: Building2, free: true },
  { id: "fmr", label: "HUD Fair Market Rents", description: "Official rent benchmarks by bedroom count", icon: Home, free: true },
  { id: "ami", label: "HUD AMI / Income Limits", description: "Area Median Income, max rents by AMI level (LIHTC/affordability)", icon: DollarSign, free: true },
  { id: "population", label: "Population Estimates", description: "Annual county population (more current than ACS)", icon: Users, free: true },
  { id: "migration", label: "Migration Flows", description: "Inflow/outflow — where people are moving", icon: TrendingUp, free: true },
  { id: "flood", label: "FEMA Flood Zone", description: "Flood risk + auto-populates Site & Zoning", icon: MapPin, free: true },
  { id: "walkscore", label: "Walk Score", description: "Walk, transit, and bike scores", icon: MapPin, free: true },
  { id: "schools", label: "Schools", description: "Nearby schools with locations (mappable)", icon: GraduationCap, free: true },
  { id: "amenities", label: "Amenities (OSM)", description: "Restaurants, shopping, groceries, parks, gyms (free)", icon: MapPin, free: true },
  { id: "google_places", label: "Google Places", description: "Amenities with star ratings, reviews, price levels", icon: MapPin, free: false },
  { id: "commute", label: "Commute Analysis", description: "Drive times to airports, hospitals, transit, downtown", icon: MapPin, free: false },
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
        case "ami": url = `/api/deals/${dealId}/location-intelligence/fetch-ami`; break;
        case "population": url = `/api/deals/${dealId}/location-intelligence/fetch-population`; break;
        case "migration": url = `/api/deals/${dealId}/location-intelligence/fetch-migration`; break;
        case "flood": url = `/api/deals/${dealId}/location-intelligence/fetch-flood`; break;
        case "walkscore": url = `/api/deals/${dealId}/location-intelligence/fetch-walkscore`; break;
        case "schools": url = `/api/deals/${dealId}/location-intelligence/fetch-schools`; break;
        case "amenities": url = `/api/deals/${dealId}/location-intelligence/fetch-amenities`; break;
        case "employers": url = `/api/deals/${dealId}/location-intelligence/fetch-employers`; break;
        case "diversity": url = `/api/deals/${dealId}/location-intelligence/fetch-diversity`; break;
        case "google_places": url = `/api/deals/${dealId}/location-intelligence/fetch-places`; break;
        case "commute": url = `/api/deals/${dealId}/location-intelligence/fetch-commute`; break;
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
                  {!src.free && <span className="text-[9px] px-1 py-0.5 rounded bg-amber-500/10 text-amber-400">Google</span>}
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

// ── Data Panels ─────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyData = Record<string, any>;

function DataPanels({
  snapshot,
  currentData,
  projections,
  dirty,
  saving,
  onSaveProjections,
  onUpdateProjection,
  setProjections,
  setDirty,
}: {
  snapshot: DemographicSnapshot | null;
  currentData: LocationIntelligenceType | undefined;
  projections: { population_growth_5yr_pct: number | null; job_growth_5yr_pct: number | null; home_value_growth_5yr_pct: number | null; rent_growth_5yr_pct: number | null; new_units_pipeline: number | null; notes: string | null };
  dirty: boolean;
  saving: boolean;
  onSaveProjections: () => void;
  onUpdateProjection: (key: string, val: string) => void;
  setProjections: React.Dispatch<React.SetStateAction<typeof projections>>;
  setDirty: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  // Extended data (non-typed fields from BLS, FEMA, schools, amenities, etc.)
  const ext: AnyData = currentData?.data
    ? typeof currentData.data === "string"
      ? JSON.parse(currentData.data)
      : currentData.data
    : {};

  return (
    <>
      {/* ── Walk Score / Transit / Bike ────────────────────────────── */}
      {(ext.walkscore != null || ext.transit_score != null || ext.bike_score != null) && (
        <Panel title="Walk Score" icon={<MapPin className="h-4 w-4 text-primary" />}>
          <div className="grid grid-cols-3 gap-3">
            <ScoreCard label="Walk Score" score={ext.walkscore} description={ext.walkscore_description} />
            <ScoreCard label="Transit Score" score={ext.transit_score} description={ext.transit_description} />
            <ScoreCard label="Bike Score" score={ext.bike_score} description={ext.bike_description} />
          </div>
        </Panel>
      )}

      {/* ── FEMA Flood Zone ────────────────────────────────────────── */}
      {ext.fema_flood_zone && (
        <Panel title="Flood Zone" icon={<MapPin className="h-4 w-4 text-primary" />} defaultOpen={ext.fema_flood_zone !== "X"}>
          <div className="flex items-center gap-3">
            <div className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${ext.fema_flood_zone === "X" ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"}`}>
              Zone {ext.fema_flood_zone}
            </div>
            <div className="text-xs text-muted-foreground">
              {ext.fema_flood_subtype || (ext.fema_flood_zone === "X" ? "Minimal flood hazard" : "Special Flood Hazard Area — flood insurance required")}
            </div>
          </div>
        </Panel>
      )}

      {/* ── Population & Demographics ──────────────────────────────── */}
      {snapshot && (
        <Panel title="Population & Demographics" icon={<Users className="h-4 w-4 text-primary" />}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Population" value={fn(snapshot.total_population)} trend={snapshot.population_growth_pct} trendLabel="% yr" icon={Users} />
            <StatCard label="Median Age" value={fn(snapshot.median_age, 1)} icon={Users} />
            <StatCard label="Avg Household Size" value={fn(snapshot.avg_household_size, 1)} icon={Home} />
            <StatCard label="Family Households" value={fpct(snapshot.family_households_pct)} icon={Users} />
            <StatCard label="Median HH Income" value={fc(snapshot.median_household_income)} icon={DollarSign} />
            <StatCard label="Per Capita Income" value={fc(snapshot.per_capita_income)} icon={DollarSign} />
            <StatCard label="Poverty Rate" value={fpct(snapshot.poverty_rate)} icon={DollarSign} />
            <StatCard label="Bachelor's Degree+" value={fpct(snapshot.bachelors_degree_pct)} icon={GraduationCap} />
          </div>
        </Panel>
      )}

      {/* ── Diversity & Age Distribution ───────────────────────────── */}
      {ext.race_ethnicity && (
        <Panel title="Diversity & Age Distribution" icon={<Users className="h-4 w-4 text-primary" />}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <StatCard label="White" value={fpct(ext.race_ethnicity.white_pct)} icon={Users} />
            <StatCard label="Hispanic/Latino" value={fpct(ext.race_ethnicity.hispanic_pct)} icon={Users} />
            <StatCard label="Black" value={fpct(ext.race_ethnicity.black_pct)} icon={Users} />
            <StatCard label="Asian" value={fpct(ext.race_ethnicity.asian_pct)} icon={Users} />
            <StatCard label="Two or More" value={fpct(ext.race_ethnicity.two_or_more_pct)} icon={Users} />
            <StatCard label="Diversity Index" value={ext.race_ethnicity.diversity_index != null ? String(ext.race_ethnicity.diversity_index) : "—"} subtitle="0 = homogeneous, 1 = diverse" icon={Users} />
          </div>
          {ext.age_distribution && (
            <div className="space-y-1.5 mt-3">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">Age Distribution</div>
              {[
                { label: "Under 18", pct: ext.age_distribution.under_18_pct },
                { label: "18–24", pct: ext.age_distribution.age_18_24_pct },
                { label: "25–44", pct: ext.age_distribution.age_25_44_pct },
                { label: "45–64", pct: ext.age_distribution.age_45_64_pct },
                { label: "65+", pct: ext.age_distribution.age_65_plus_pct },
              ].map((ag) => (
                <div key={ag.label} className="flex items-center gap-2 text-xs">
                  <span className="w-16 text-muted-foreground flex-shrink-0">{ag.label}</span>
                  <div className="flex-1 h-2 bg-muted/30 rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-primary/60" style={{ width: `${ag.pct ?? 0}%` }} />
                  </div>
                  <span className="w-12 text-right text-muted-foreground flex-shrink-0">{ag.pct != null ? `${ag.pct}%` : "—"}</span>
                </div>
              ))}
            </div>
          )}
          {ext.languages && ext.languages.length > 0 && (
            <div className="mt-4">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">Languages Spoken at Home</div>
              <div className="flex flex-wrap gap-1.5">
                {ext.languages.slice(0, 6).map((l: AnyData, i: number) => (
                  <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-muted/30 text-muted-foreground">
                    {l.language} {l.pct != null ? `(${l.pct}%)` : ""}
                  </span>
                ))}
              </div>
            </div>
          )}
        </Panel>
      )}

      {/* ── Housing Market ─────────────────────────────────────────── */}
      {snapshot && (
        <Panel title="Housing Market" icon={<Home className="h-4 w-4 text-primary" />}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Median Home Value" value={fc(snapshot.median_home_value)} trend={snapshot.home_value_growth_pct} trendLabel="% yr" icon={Home} />
            <StatCard label="Median Rent" value={snapshot.median_gross_rent != null ? `$${fn(snapshot.median_gross_rent)}/mo` : "—"} trend={snapshot.rent_growth_pct} trendLabel="% yr" icon={DollarSign} />
            <StatCard label="Total Housing Units" value={fn(snapshot.total_housing_units)} icon={Building2} />
            <StatCard label="Owner-Occupied" value={fpct(snapshot.owner_occupied_pct)} subtitle={snapshot.renter_occupied_pct != null ? `Renter: ${fpct(snapshot.renter_occupied_pct)}` : undefined} icon={Home} />
            {ext.hud_fmr && (
              <>
                <StatCard label="HUD FMR (Studio)" value={ext.hud_fmr.studio != null ? `$${fn(ext.hud_fmr.studio)}/mo` : "—"} icon={DollarSign} />
                <StatCard label="HUD FMR (1BR)" value={ext.hud_fmr.one_br != null ? `$${fn(ext.hud_fmr.one_br)}/mo` : "—"} icon={DollarSign} />
                <StatCard label="HUD FMR (2BR)" value={ext.hud_fmr.two_br != null ? `$${fn(ext.hud_fmr.two_br)}/mo` : "—"} icon={DollarSign} />
                <StatCard label="HUD FMR (3BR)" value={ext.hud_fmr.three_br != null ? `$${fn(ext.hud_fmr.three_br)}/mo` : "—"} icon={DollarSign} />
              </>
            )}
          </div>
          {ext.building_permits && ext.building_permits.length > 0 && (
            <div className="mt-4">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">Building Permits (Annual)</div>
              <div className="grid grid-cols-3 gap-2">
                {ext.building_permits.slice(0, 3).map((p: AnyData) => (
                  <div key={p.year} className="border border-border/40 rounded-lg bg-muted/10 p-2.5 text-center">
                    <div className="text-[10px] text-muted-foreground">{p.year}</div>
                    <div className="text-sm font-semibold">{fn(p.total_units)}</div>
                    <div className="text-[10px] text-muted-foreground">
                      SF: {fn(p.single_family)} · MF: {fn(p.multi_family)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Panel>
      )}

      {/* ── AMI / Income Limits (Affordability) ──────────────────── */}
      {ext.ami && (() => {
        // Back-fill missing/empty limits & rents using HUD standard
        // calculations so legacy stored data (or non-metro HUD responses)
        // still render a populated table.
        const storedLimits = (ext.ami.income_limits || {}) as Record<string, number[] | undefined>;
        const storedRents = (ext.ami.max_rents || {}) as Record<string, Record<string, number> | undefined>;
        const mfi = Number(ext.ami.median_family_income) || 0;
        const allZero = (arr?: number[]) => !arr || arr.length === 0 || arr.every((v) => !v);
        const needsBackfill = mfi > 0 && (
          allZero(storedLimits.very_low_50) ||
          allZero(storedLimits.extremely_low_30) ||
          allZero(storedLimits.low_80) ||
          !storedRents.ami_50
        );
        const derived = needsBackfill
          ? buildAmiTables(mfi, {
              very_low_50: storedLimits.very_low_50,
              extremely_low_30: storedLimits.extremely_low_30,
              low_80: storedLimits.low_80,
            })
          : null;
        const incomeLimitsView: Record<string, number[] | undefined> = derived
          ? derived.income_limits as unknown as Record<string, number[] | undefined>
          : storedLimits;
        const maxRentsView: Record<string, Record<string, number> | undefined> = derived
          ? derived.max_rents as unknown as Record<string, Record<string, number> | undefined>
          : storedRents;
        return (
        <Panel title={`Area Median Income — FY${ext.ami.year}`} icon={<DollarSign className="h-4 w-4 text-primary" />}>
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <StatCard
                label="Median Family Income"
                value={fc(ext.ami.median_family_income)}
                subtitle={ext.ami.area_name}
                icon={DollarSign}
              />
            </div>

            {/* Max affordable rents by AMI level */}
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">
                Max Affordable Rents by AMI Level (30% of income)
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-muted-foreground border-b border-border/40">
                      <th className="pb-2 pr-3">AMI Level</th>
                      <th className="pb-2 pr-3 text-right">Studio</th>
                      <th className="pb-2 pr-3 text-right">1 BR</th>
                      <th className="pb-2 pr-3 text-right">2 BR</th>
                      <th className="pb-2 text-right">3 BR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { level: "30% AMI", key: "ami_30", color: "text-red-400" },
                      { level: "50% AMI", key: "ami_50", color: "text-amber-400" },
                      { level: "60% AMI (LIHTC)", key: "ami_60", color: "text-amber-300" },
                      { level: "80% AMI", key: "ami_80", color: "text-emerald-400" },
                      { level: "100% AMI", key: "ami_100", color: "text-foreground/80" },
                      { level: "120% AMI", key: "ami_120", color: "text-primary" },
                    ].map((row) => {
                      const rents = maxRentsView[row.key];
                      if (!rents) return null;
                      return (
                        <tr key={row.key} className="border-b border-border/20 last:border-0">
                          <td className={`py-1.5 pr-3 font-medium ${row.color}`}>{row.level}</td>
                          <td className="py-1.5 pr-3 text-right">${fn(rents.studio)}</td>
                          <td className="py-1.5 pr-3 text-right">${fn(rents.one_br)}</td>
                          <td className="py-1.5 pr-3 text-right">${fn(rents.two_br)}</td>
                          <td className="py-1.5 text-right">${fn(rents.three_br)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Income limits by household size */}
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">
                Income Limits by Household Size
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-muted-foreground border-b border-border/40">
                      <th className="pb-2 pr-3">AMI Level</th>
                      {[1, 2, 3, 4, 5, 6].map((p) => (
                        <th key={p} className="pb-2 pr-2 text-right">{p}p</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { level: "30%", key: "extremely_low_30" },
                      { level: "50%", key: "very_low_50" },
                      { level: "60%", key: "sixty_pct" },
                      { level: "80%", key: "low_80" },
                    ].map((row) => {
                      const limits = incomeLimitsView[row.key];
                      if (!limits) return null;
                      return (
                        <tr key={row.key} className="border-b border-border/20 last:border-0">
                          <td className="py-1.5 pr-3 font-medium text-muted-foreground">{row.level}</td>
                          {limits.slice(0, 6).map((v: number, i: number) => (
                            <td key={i} className="py-1.5 pr-2 text-right">${fn(v)}</td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="text-[10px] text-muted-foreground/60 mt-1.5">
                Source: HUD FY{ext.ami.year} Income Limits for {ext.ami.area_name}. Max rents = 30% of income / 12. Utility allowances not deducted.
                {derived && " Limits derived from MFI using HUD's standard family-size adjustment factors (70/80/90/100/108/116/124/132%)."}
              </div>
            </div>
          </div>
        </Panel>
        );
      })()}

      {/* ── Employment & Economy ───────────────────────────────────── */}
      {(snapshot || ext.avg_weekly_wage != null) && (
        <Panel title="Employment & Economy" icon={<Briefcase className="h-4 w-4 text-primary" />}>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
            {snapshot && <StatCard label="Labor Force" value={fn(snapshot.labor_force)} icon={Briefcase} />}
            {snapshot && <StatCard label="Total Employed" value={fn(snapshot.total_employed)} icon={Briefcase} />}
            {snapshot && <StatCard label="Unemployment Rate" value={fpct(snapshot.unemployment_rate)} icon={Briefcase} />}
            {ext.avg_weekly_wage != null && (
              <StatCard label="Avg Weekly Wage" value={fc(ext.avg_weekly_wage)} subtitle={ext.bls_year ? `BLS ${ext.bls_year}Q${ext.bls_quarter}` : undefined} icon={DollarSign} />
            )}
            {ext.total_establishments != null && (
              <StatCard label="Establishments" value={fn(ext.total_establishments)} icon={Building2} />
            )}
          </div>
          {snapshot?.top_industries && snapshot.top_industries.length > 0 && (
            <div className="mt-3">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">Top Industries by Employment</div>
              <IndustryBar industries={snapshot.top_industries} />
            </div>
          )}
        </Panel>
      )}

      {/* ── Top Employers ──────────────────────────────────────────── */}
      {ext.top_employers && ext.top_employers.length > 0 && ext.top_employers[0]?.distance_mi != null && (
        <Panel title={`Top Employers (${ext.employers_count ?? ext.top_employers.length})`} icon={<Building2 className="h-4 w-4 text-primary" />}>
          <div className="space-y-1.5">
            {ext.top_employers.slice(0, 15).map((emp: AnyData, i: number) => (
              <div key={i} className="flex items-center gap-3 text-xs py-1 border-b border-border/20 last:border-0">
                <span className="font-medium text-foreground/90 flex-1">{emp.name}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted/30 text-muted-foreground">{emp.type}</span>
                {emp.distance_mi != null && <span className="text-muted-foreground w-14 text-right">{emp.distance_mi} mi</span>}
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* ── Commute Analysis ───────────────────────────────────────── */}
      {ext.commute_destinations && ext.commute_destinations.length > 0 && (
        <Panel title="Commute Analysis" icon={<MapPin className="h-4 w-4 text-primary" />}>
          <div className="space-y-1.5">
            {ext.commute_destinations.map((d: AnyData, i: number) => (
              <div key={i} className="flex items-center gap-3 text-xs py-1.5 border-b border-border/20 last:border-0">
                <span className="font-medium text-foreground/90 flex-1 min-w-0 truncate">{d.name}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted/30 text-muted-foreground flex-shrink-0">{d.type}</span>
                <span className="text-muted-foreground flex-shrink-0 w-16 text-right">{d.drive_text || "—"}</span>
                {d.transit_text && <span className="text-muted-foreground/60 flex-shrink-0 w-20 text-right text-[10px]">Transit: {d.transit_text}</span>}
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* ── Schools ────────────────────────────────────────────────── */}
      {ext.schools && ext.schools.length > 0 && (
        <Panel title={`Schools (${ext.schools_count ?? ext.schools.length})`} icon={<GraduationCap className="h-4 w-4 text-primary" />}>
          <div className="space-y-1.5">
            {ext.schools.slice(0, 15).map((s: AnyData, i: number) => (
              <div key={i} className="flex items-center gap-3 text-xs py-1 border-b border-border/20 last:border-0">
                <span className="font-medium text-foreground/90 flex-1">{s.name}</span>
                {s.rating != null && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${s.rating >= 7 ? "bg-emerald-500/10 text-emerald-400" : s.rating >= 4 ? "bg-amber-500/10 text-amber-400" : "bg-red-500/10 text-red-400"}`}>
                    {s.rating}/10
                  </span>
                )}
                {s.distance_mi != null && <span className="text-muted-foreground w-14 text-right">{s.distance_mi} mi</span>}
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* ── Amenities / Google Places ──────────────────────────────── */}
      {ext.google_places_summary && Object.keys(ext.google_places_summary).length > 0 ? (
        <Panel title={`Nearby Amenities (${ext.amenities_total ?? 0})`} icon={<MapPin className="h-4 w-4 text-primary" />}>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-3">
            {Object.entries(ext.google_places_summary).map(([cat, info]: [string, unknown]) => {
              const s = info as AnyData;
              return (
                <div key={cat} className="border border-border/40 rounded-lg bg-muted/10 p-2.5">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{cat}</div>
                  <div className="text-sm font-semibold mt-0.5">{s.count}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {s.avg_rating != null && <span>{s.avg_rating} avg rating · </span>}
                    {s.nearest_mi != null && <span>{s.nearest_mi} mi nearest</span>}
                  </div>
                  {s.top_rated && s.top_rated.length > 0 && (
                    <div className="mt-1 text-[10px] text-muted-foreground/70">
                      {s.top_rated.map((p: AnyData) => `${p.name} (${p.rating}★)`).join(", ")}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Panel>
      ) : ext.amenities_summary && Object.keys(ext.amenities_summary).length > 0 ? (
        <Panel title={`Nearby Amenities (${ext.amenities_total ?? 0})`} icon={<MapPin className="h-4 w-4 text-primary" />}>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {Object.entries(ext.amenities_summary).map(([cat, info]: [string, unknown]) => {
              const s = info as AnyData;
              return (
                <div key={cat} className="border border-border/40 rounded-lg bg-muted/10 p-2.5">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{cat}</div>
                  <div className="text-sm font-semibold mt-0.5">{s.count}</div>
                  {s.nearest_mi != null && <div className="text-[10px] text-muted-foreground">{s.nearest_mi} mi nearest</div>}
                  {s.notable && s.notable.length > 0 && <div className="mt-1 text-[10px] text-muted-foreground/70 truncate">{s.notable.join(", ")}</div>}
                </div>
              );
            })}
          </div>
        </Panel>
      ) : null}

      {/* ── Migration ──────────────────────────────────────────────── */}
      {ext.migration && (
        <Panel title="Migration & Mobility" icon={<TrendingUp className="h-4 w-4 text-primary" />} defaultOpen={false}>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <StatCard label="Mobility Rate" value={fpct(ext.migration.mobility_rate_pct)} subtitle="% moved in past year" icon={TrendingUp} />
            <StatCard label="Domestic Inflow" value={fn(ext.migration.inflow_domestic)} subtitle="From other counties/states" icon={TrendingUp} />
            <StatCard label="Same House" value={fpct(ext.migration.same_house_pct)} icon={Home} />
            <StatCard label="Within County" value={fn(ext.migration.moved_within_county)} icon={MapPin} />
            <StatCard label="From Other State" value={fn(ext.migration.moved_from_other_state)} icon={MapPin} />
            <StatCard label="From Abroad" value={fn(ext.migration.moved_from_abroad)} icon={MapPin} />
          </div>
        </Panel>
      )}

      {/* ── Growth Projections (editable) ──────────────────────────── */}
      <Panel
        title="Growth Projections & Pipeline"
        icon={<TrendingUp className="h-4 w-4 text-primary" />}
        action={dirty ? (
          <Button size="sm" variant="default" onClick={onSaveProjections} disabled={saving}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            <span className="ml-1.5">Save</span>
          </Button>
        ) : null}
      >
        <p className="text-xs text-muted-foreground mb-3">
          Enter projections from market reports, CoStar, ESRI, or your own analysis. These will be included in investment packages.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <InlineField label="Population Growth (5yr)" value={projections.population_growth_5yr_pct} onChange={(v) => onUpdateProjection("population_growth_5yr_pct", v)} suffix="%" />
          <InlineField label="Job Growth (5yr)" value={projections.job_growth_5yr_pct} onChange={(v) => onUpdateProjection("job_growth_5yr_pct", v)} suffix="%" />
          <InlineField label="Home Value Growth (5yr)" value={projections.home_value_growth_5yr_pct} onChange={(v) => onUpdateProjection("home_value_growth_5yr_pct", v)} suffix="%" />
          <InlineField label="Rent Growth (5yr)" value={projections.rent_growth_5yr_pct} onChange={(v) => onUpdateProjection("rent_growth_5yr_pct", v)} suffix="%" />
          <InlineField label="New Units Pipeline" value={projections.new_units_pipeline} onChange={(v) => onUpdateProjection("new_units_pipeline", v)} suffix="units" />
        </div>
        <div className="mt-3">
          <label className="block text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Notes / Sources</label>
          <textarea
            value={projections.notes ?? ""}
            onChange={(e) => { setProjections((prev) => ({ ...prev, notes: e.target.value || null })); setDirty(true); }}
            placeholder="E.g., CoStar Q4 2024 submarket report, ESRI demographic forecast…"
            rows={2}
            className="w-full px-3 py-2 text-sm bg-muted/20 border border-border/40 rounded-lg outline-none resize-none focus:border-primary/40"
          />
        </div>
      </Panel>
    </>
  );
}

// ── Map Section ─────────────────────────────────────────────────────────────

function MapSection({
  dealId,
  dealLat,
  dealLng,
  dealAddress,
  currentData,
  selectedRadius,
}: {
  dealId: string;
  dealLat: number;
  dealLng: number;
  dealAddress?: string | null;
  currentData: LocationIntelligenceType;
  selectedRadius: number;
}) {
  const ext: AnyData = currentData?.data
    ? typeof currentData.data === "string"
      ? JSON.parse(currentData.data)
      : currentData.data
    : {};

  const subject = {
    lat: dealLat,
    lng: dealLng,
    name: "Subject Property",
    address: dealAddress || undefined,
  };

  // Parse amenities — handle both Google Places and OSM formats
  const amenities = (ext.google_places || ext.amenities || []).map((a: AnyData) => ({
    name: a.name || "Unknown",
    category: a.category || "other",
    lat: Number(a.lat || 0),
    lng: Number(a.lng || 0),
    distance_mi: a.distance_mi ?? 0,
    rating: a.rating ?? null,
  }));

  // Parse employers
  const employers = (ext.top_employers || [])
    .filter((e: AnyData) => e.lat && e.lng)
    .map((e: AnyData) => ({
      name: e.name,
      type: e.type || "Business",
      lat: Number(e.lat),
      lng: Number(e.lng),
      distance_mi: e.distance_mi ?? 0,
    }));

  // Parse schools
  const schools = (ext.schools || [])
    .filter((s: AnyData) => s.lat && s.lng)
    .map((s: AnyData) => ({
      name: s.name,
      lat: Number(s.lat),
      lng: Number(s.lng),
      distance_mi: s.distance_mi ?? null,
      rating: s.rating ?? null,
    }));

  // Parse commute destinations
  const commuteDestinations = (ext.commute_destinations || [])
    .filter((d: AnyData) => d.lat && d.lng)
    .map((d: AnyData) => ({
      name: d.name,
      type: d.type || "Destination",
      lat: Number(d.lat),
      lng: Number(d.lng),
      drive_text: d.drive_text ?? null,
    }));

  const hasMapData = amenities.length > 0 || employers.length > 0 || schools.length > 0 || commuteDestinations.length > 0;

  if (!hasMapData) return null;

  return (
    <Panel
      title="Location Map"
      icon={<MapPin className="h-4 w-4 text-primary" />}
      defaultOpen={true}
    >
      <LocationMapBuilder
        dealId={dealId}
        subject={subject}
        radiusMiles={selectedRadius}
        amenities={amenities}
        employers={employers}
        schools={schools}
        commuteDestinations={commuteDestinations}
        height={560}
      />
    </Panel>
  );
}

// ── Score Card (for Walk/Transit/Bike) ───────────────────────────────────────

function ScoreCard({ label, score, description }: { label: string; score: number | null; description: string | null }) {
  if (score == null) return null;
  const color = score >= 70 ? "text-emerald-400" : score >= 50 ? "text-amber-400" : "text-red-400";
  const bg = score >= 70 ? "bg-emerald-500/10" : score >= 50 ? "bg-amber-500/10" : "bg-red-500/10";
  return (
    <div className="border border-border/40 rounded-lg bg-muted/10 p-3.5 text-center">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">{label}</div>
      <div className={`text-2xl font-bold ${color}`}>{score}</div>
      {description && <div className="text-[10px] text-muted-foreground mt-1">{description}</div>}
    </div>
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
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div>
        <h1 className="text-xl font-display font-semibold">Location Intelligence</h1>
        <p className="text-xs text-muted-foreground mt-1">
          Demographics, housing, employment, amenities, and schools within
          a configurable radius. Pull free data from Census, BLS, HUD, and FEMA,
          or paste from paid reports.
        </p>
      </div>

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

      {/* ── Map Builder ──────────────────────────────────────────── */}
      {dealLat && dealLng && currentData && (
        <MapSection
          dealId={dealId}
          dealLat={dealLat}
          dealLng={dealLng}
          dealAddress={dealAddress}
          currentData={currentData}
          selectedRadius={selectedRadius}
        />
      )}

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
      {!snapshot && !currentData ? (
        <div className="border border-dashed border-border/40 rounded-xl bg-card/40 py-16 text-center">
          <BarChart3 className="h-10 w-10 mx-auto mb-3 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            No location data for {selectedRadius}-mile radius yet.
          </p>
          <p className="text-xs text-muted-foreground/70 mt-1 max-w-md mx-auto">
            Use the Data Sources panel above to fetch demographics, employment,
            housing, amenities, and more.
          </p>
        </div>
      ) : (
        <DataPanels snapshot={snapshot} currentData={currentData} projections={projections} dirty={dirty} saving={saving} onSaveProjections={handleSaveProjections} onUpdateProjection={updateProjection} setProjections={setProjections} setDirty={setDirty} />
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
