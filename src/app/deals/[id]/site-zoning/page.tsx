"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import ReactMarkdown from "react-markdown";
import {
  Loader2, MapPin, Sparkles, RefreshCw, Download, Save,
  Building2, Ruler, Trees, ChevronDown, ChevronRight, FileText,
  Map as MapIcon, ExternalLink, CalendarClock, Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { BONUS_CATALOG } from "@/lib/bonus-catalog";
import type { SitePlan as SitePlanType } from "@/lib/types";
import { DEFAULT_SITE_PLAN } from "@/lib/types";
import SitePlanMetrics from "@/components/site-plan/SitePlanMetrics";

// SitePlanGenerator is client-only (leaflet touches window on import).
const SitePlanGenerator = dynamic(
  () => import("@/components/site-plan/SitePlanGenerator"),
  {
    ssr: false,
    loading: () => (
      <div className="border border-border/40 rounded-xl bg-card/40 h-[560px] flex items-center justify-center text-xs text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading site plan…
      </div>
    ),
  }
);
// ── Types ────────────────────────────────────────────────────────────────────

interface Setback { label: string; feet: number | null; }

// Height limits used to be a single free-text string ("4 stories / 55 ft").
// They're now structured so analysts can enter feet and/or stories with an
// explicit "and" / "or" connector ("40 ft OR 3 stories, whichever is less").
// `value` is kept for backwards compatibility on load and regenerated on save.
interface HeightLimit {
  label: string;
  feet: number | null;
  stories: number | null;
  connector: "and" | "or";
  value?: string; // legacy / derived display string
}

type BonusApplicability = "applies" | "may_apply" | "not_applicable";

interface DensityBonus {
  source: string;
  description: string;
  additional_density: string;
  // Allow an analyst to deactivate a spotted bonus without deleting the row.
  // Defaults to true when missing so existing blobs keep working.
  enabled?: boolean;
}

interface FutureLegislation {
  source: string;          // e.g. "AB 1287 (CA)"
  description: string;     // what it does
  effective_date: string;  // free text, e.g. "Jan 2026" or "TBD"
  impact: string;          // e.g. "+40% density bonus if very-low income"
}

interface ZoningInfo {
  zoning_designation: string;
  // URL to the jurisdiction's zoning page that sourced this data. Rendered
  // as a clickable link in the Zoning Information section header.
  source_url: string;
  overlays: string[];
  permitted_uses: string[];
  setbacks: Setback[];
  height_limits: HeightLimit[];
  lot_coverage_pct: number | null;
  far: number | null;
  parking_requirements: string;
  parking_ratio_residential: number;   // spaces per unit
  parking_ratio_commercial: number;    // spaces per 1,000 SF
  parking_reduction_allowed: boolean;
  parking_reduction_notes: string;
  open_space_requirements: string;
  open_space_pct: number | null;       // % of lot
  open_space_sf: number | null;        // or fixed SF
  density_bonuses: DensityBonus[];
  // Per-program applicability for the bonus catalog — grouping in the UI
  // ("applies", "may apply", "n/a"). Keyed by BonusCard.source.
  bonus_applicability: Record<string, BonusApplicability>;
  // Upcoming legislation / general plan changes that could affect housing
  // (bonuses & incentives, density, allowed uses).
  future_legislation: FutureLegislation[];
  additional_notes: string;
  zone_change_needed: boolean;
  zone_change_from: string;
  zone_change_to: string;
  zone_change_notes: string;
}

interface SiteInfo {
  land_acres: number;
  land_sf: number;
  parcel_id: string;
  current_improvements: string;
  topography: string;
  flood_zone: string;
  utilities: string;
  utilities_available: string[];   // structured: Water, Sewer, Gas, Electric, Fiber, Storm Drain
  environmental_notes: string;
  environmental_status: string;    // structured dropdown
  soil_conditions: string;
  soil_type: string;               // structured dropdown
}

interface DevParams {
  lot_coverage_pct: number;
  far: number;
  height_limit_stories: number;
  efficiency_pct: number;
  max_gsf: number;
  max_nrsf: number;
}

interface SiteZoningData {
  site_info: SiteInfo;
  zoning_info: ZoningInfo;
  dev_params: DevParams;
  zoning_narrative: string;
  last_report_date: string | null;
}

const EFFICIENCY_DEFAULTS: Record<string, number> = {
  industrial: 98, multifamily: 80, student_housing: 78,
  office: 87, retail: 95, mixed_use: 85, other: 90,
};

const DEFAULT_SITE_INFO: SiteInfo = {
  land_acres: 0, land_sf: 0, parcel_id: "",
  current_improvements: "", topography: "", flood_zone: "",
  utilities: "", utilities_available: [], environmental_notes: "", environmental_status: "",
  soil_conditions: "", soil_type: "",
};

const DEFAULT_ZONING: ZoningInfo = {
  zoning_designation: "",
  source_url: "",
  overlays: [], permitted_uses: [],
  setbacks: [
    { label: "Front", feet: null }, { label: "Side", feet: null },
    { label: "Rear", feet: null }, { label: "Corner Side", feet: null },
  ],
  height_limits: [{ label: "Base Zoning", feet: null, stories: null, connector: "and" }],
  lot_coverage_pct: null, far: null, parking_requirements: "",
  parking_ratio_residential: 0, parking_ratio_commercial: 0,
  parking_reduction_allowed: false, parking_reduction_notes: "",
  open_space_requirements: "", open_space_pct: null, open_space_sf: null,
  density_bonuses: [],
  bonus_applicability: {},
  future_legislation: [],
  additional_notes: "",
  zone_change_needed: false, zone_change_from: "", zone_change_to: "", zone_change_notes: "",
};

const DEFAULT_DEV: DevParams = {
  lot_coverage_pct: 40, far: 0, height_limit_stories: 0,
  efficiency_pct: 100, max_gsf: 0, max_nrsf: 0,
};

// ── Helpers ──────────────────────────────────────────────────────────────────

const fn = (n: number) => n ? Math.round(n).toLocaleString("en-US") : "0";
const fc = (n: number) => n ? "$" + Math.round(n).toLocaleString("en-US") : "$0";

// Build the legacy "X stories and/or Y ft" display string. Stored alongside
// the structured fields so the Programming page's regex (which parses
// `h.value` for "ft") keeps working without changes on old data.
function heightLimitDisplay(h: HeightLimit): string {
  const parts: string[] = [];
  if (h.stories != null) parts.push(`${h.stories} stories`);
  if (h.feet != null) parts.push(`${h.feet} ft`);
  if (parts.length === 0) return h.value || "";
  return parts.join(` ${h.connector || "and"} `);
}

// Upgrade legacy height_limit rows ({ label, value: "4 stories / 55 ft" })
// into the new structured shape. Any row that already has numeric fields is
// left alone.
function migrateHeightLimit(h: any): HeightLimit {
  if (!h || typeof h !== "object") {
    return { label: "Base Zoning", feet: null, stories: null, connector: "and" };
  }
  if (typeof h.feet === "number" || typeof h.stories === "number" || h.feet === null || h.stories === null) {
    if (h.feet !== undefined || h.stories !== undefined) {
      return {
        label: h.label || "",
        feet: typeof h.feet === "number" ? h.feet : null,
        stories: typeof h.stories === "number" ? h.stories : null,
        connector: h.connector === "or" ? "or" : "and",
      };
    }
  }
  const val: string = typeof h.value === "string" ? h.value : "";
  const storiesMatch = val.match(/(\d+(?:\.\d+)?)\s*stor/i);
  const feetMatch = val.match(/(\d+(?:\.\d+)?)\s*(?:ft|feet|')/i);
  const connector: "and" | "or" = /\bor\b/i.test(val) ? "or" : "and";
  return {
    label: h.label || "",
    feet: feetMatch ? parseFloat(feetMatch[1]) : null,
    stories: storiesMatch ? parseFloat(storiesMatch[1]) : null,
    connector,
  };
}

function Section({ title, icon, children, defaultOpen = true, headerRight }: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  // Optional trailing slot for a link or action in the section header (e.g.
  // a "View source" external link on the Zoning Information section). Clicks
  // in this slot are not bubbled, so they don't collapse the section.
  headerRight?: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-border/60 rounded-xl bg-card shadow-card overflow-hidden">
      <div className="w-full flex items-center gap-3 px-5 py-3.5 bg-muted/20 hover:bg-muted/30 transition-colors">
        <button onClick={() => setOpen(!open)} className="flex items-center gap-3 flex-1 text-left">
          {open ? <ChevronDown className="h-4 w-4 text-muted-foreground/60" /> : <ChevronRight className="h-4 w-4 text-muted-foreground/60" />}
          <span className="flex items-center gap-2">{icon}<span className="font-semibold text-sm">{title}</span></span>
        </button>
        {headerRight && (
          <div onClick={(e) => e.stopPropagation()}>{headerRight}</div>
        )}
      </div>
      {open && <div className="px-5 py-4">{children}</div>}
    </div>
  );
}

function FieldInput({ label, value, onChange, suffix, placeholder, type = "text", className = "" }: {
  label: string; value: string | number; onChange: (v: string) => void;
  suffix?: string; placeholder?: string; type?: string; className?: string;
}) {
  return (
    <div className={className}>
      <label className="block text-[10px] text-muted-foreground uppercase tracking-wide mb-1">{label}</label>
      <div className="flex items-center border border-border/40 rounded-lg bg-muted/20 overflow-hidden">
        <input
          type={type}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder || "—"}
          className="flex-1 px-3 py-1.5 text-sm bg-transparent outline-none"
        />
        {suffix && <span className="px-2 text-xs text-muted-foreground bg-muted/30 border-l border-border/40 py-1.5">{suffix}</span>}
      </div>
    </div>
  );
}

function TextArea({ label, value, onChange, placeholder, rows = 2 }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; rows?: number;
}) {
  return (
    <div>
      <label className="block text-[10px] text-muted-foreground uppercase tracking-wide mb-1">{label}</label>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder || "—"}
        rows={rows}
        className="w-full px-3 py-1.5 text-sm bg-muted/20 border border-border/40 rounded-lg outline-none resize-none focus:border-primary/40"
      />
    </div>
  );
}

function SelectInput({ label, value, onChange, options, className = "" }: {
  label: string; value: string; onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>; className?: string;
}) {
  return (
    <div className={className}>
      <label className="block text-[10px] text-muted-foreground uppercase tracking-wide mb-1">{label}</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full px-3 py-1.5 text-sm bg-background text-foreground border border-border/40 rounded-lg outline-none focus:border-primary/40"
      >
        {options.map(o => <option key={o.value} value={o.value} className="bg-background text-foreground">{o.label}</option>)}
      </select>
    </div>
  );
}

function CheckboxGroup({ label, options, selected, onChange }: {
  label: string; options: string[]; selected: string[]; onChange: (v: string[]) => void;
}) {
  return (
    <div>
      <label className="block text-[10px] text-muted-foreground uppercase tracking-wide mb-1.5">{label}</label>
      <div className="flex flex-wrap gap-2">
        {options.map(opt => {
          const active = selected.includes(opt);
          return (
            <button key={opt} type="button"
              onClick={() => onChange(active ? selected.filter(s => s !== opt) : [...selected, opt])}
              className={`px-2.5 py-1 rounded-md text-xs border transition-colors ${active ? "bg-primary/20 border-primary/30 text-primary" : "bg-muted/20 border-border/40 text-muted-foreground hover:border-primary/20"}`}
            >{opt}</button>
          );
        })}
      </div>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function SiteZoningPage({ params }: { params: { id: string } }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deal, setDeal] = useState<any>(null);

  const [siteInfo, setSiteInfo] = useState<SiteInfo>(DEFAULT_SITE_INFO);
  const [zoning, setZoning] = useState<ZoningInfo>(DEFAULT_ZONING);
  const [devParams, setDevParams] = useState<DevParams>(DEFAULT_DEV);
  const [sitePlan, setSitePlan] = useState<SitePlanType>(DEFAULT_SITE_PLAN);
  const [narrative, setNarrative] = useState("");
  const [lastReportDate, setLastReportDate] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  // APN auto-fill state
  const [apnLookup, setApnLookup] = useState<{
    loading: boolean;
    source_url: string | null;
    confidence: "high" | "medium" | "low" | null;
    notes: string;
    attempted: boolean;
  }>({ loading: false, source_url: null, confidence: null, notes: "", attempted: false });

  // ── Load data ──────────────────────────────────────────────────────────
  useEffect(() => {
    Promise.all([
      fetch(`/api/deals/${params.id}`).then(r => r.json()),
      fetch(`/api/underwriting?deal_id=${params.id}`).then(r => r.json()),
    ]).then(([dealRes, uwRes]) => {
      const d = dealRes.data;
      setDeal(d);

      const uwRaw = uwRes.data?.data;
      const uw = uwRaw ? (typeof uwRaw === "string" ? JSON.parse(uwRaw) : uwRaw) : {};

      // Hydrate site info from deal + UW
      const effDefault = EFFICIENCY_DEFAULTS[d?.property_type || "other"] ?? 90;
      const acres = d?.land_acres || uw?.site_info?.land_acres || 0;
      const sf = acres * 43560;

      // Derive a default "current improvements" description from deal/OM data
      // if Site & Zoning hasn't been filled in yet. Pulls from deal fields that
      // OM Analysis writes (square_footage, units, year_built).
      const existingImprovements = uw?.site_info?.current_improvements?.trim();
      const improvementParts: string[] = [];
      if (d?.units) improvementParts.push(`${d.units} units`);
      if (d?.square_footage) improvementParts.push(`${Number(d.square_footage).toLocaleString()} SF`);
      if (d?.year_built) improvementParts.push(`built ${d.year_built}`);
      const derivedImprovements =
        existingImprovements || (improvementParts.length ? improvementParts.join(", ") : "");

      setSiteInfo({
        ...DEFAULT_SITE_INFO,
        ...uw?.site_info,
        land_acres: acres,
        land_sf: uw?.site_info?.land_sf || sf,
        current_improvements: derivedImprovements,
      });

      setZoning({
        ...DEFAULT_ZONING,
        ...uw?.zoning_info,
        setbacks: uw?.zoning_info?.setbacks?.length > 0
          ? uw.zoning_info.setbacks
          : DEFAULT_ZONING.setbacks,
        height_limits: uw?.zoning_info?.height_limits?.length > 0
          ? uw.zoning_info.height_limits.map(migrateHeightLimit)
          : DEFAULT_ZONING.height_limits,
        bonus_applicability: uw?.zoning_info?.bonus_applicability || {},
        future_legislation: uw?.zoning_info?.future_legislation || [],
        source_url: uw?.zoning_info?.source_url || "",
      });

      const dp = {
        lot_coverage_pct: uw?.lot_coverage_pct ?? uw?.dev_params?.lot_coverage_pct ?? (d?.property_type === "industrial" ? 40 : 0),
        far: uw?.far ?? uw?.dev_params?.far ?? 0,
        height_limit_stories: uw?.height_limit_stories ?? uw?.dev_params?.height_limit_stories ?? 0,
        efficiency_pct: uw?.efficiency_pct ?? uw?.dev_params?.efficiency_pct ?? effDefault,
        max_gsf: uw?.max_gsf ?? uw?.dev_params?.max_gsf ?? 0,
        max_nrsf: uw?.max_nrsf ?? uw?.dev_params?.max_nrsf ?? 0,
      };
      setDevParams(dp);

      // Hydrate the drawn site plan if the analyst has previously traced it.
      // Backwards compatible on two axes:
      // 1. Older UW blobs may have no site_plan key at all — fall through
      //    to the default (empty polygons, no center).
      // 2. The initial release stored a single building as
      //    { building_points, building_area_sf }. If we see that shape and
      //    there's no `buildings` array yet, migrate it into
      //    buildings: [{ id, label: "Building 1", ... }]. The legacy keys
      //    are dropped from state so re-saves write the new shape only.
      if (uw?.site_plan) {
        const raw = uw.site_plan as any;
        let buildings = Array.isArray(raw.buildings) ? raw.buildings : [];
        let activeId = raw.active_building_id ?? null;
        if (
          buildings.length === 0 &&
          Array.isArray(raw.building_points) &&
          raw.building_points.length >= 3
        ) {
          const migratedId =
            (crypto as any)?.randomUUID?.() ||
            `bld-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          buildings = [{
            id: migratedId,
            label: "Building 1",
            points: raw.building_points,
            area_sf: Math.round(raw.building_area_sf || 0),
          }];
          activeId = migratedId;
        }
        const { building_points: _bp, building_area_sf: _ba, ...rest } = raw;
        setSitePlan({
          ...DEFAULT_SITE_PLAN,
          ...rest,
          buildings,
          active_building_id: activeId,
        });
      }

      setNarrative(uw?.zoning_narrative || "");
      setLastReportDate(uw?.last_report_date || null);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [params.id]);

  // ── Recalculate GSF/NRSF when inputs change ───────────────────────────
  const recalcBuilding = useCallback((si: SiteInfo, dp: DevParams) => {
    const landSF = si.land_sf || si.land_acres * 43560;
    const isIndustrial = deal?.property_type === "industrial";
    let gsf = 0;
    if (isIndustrial && landSF > 0 && dp.lot_coverage_pct > 0) {
      gsf = Math.round(landSF * (dp.lot_coverage_pct / 100));
    } else if (landSF > 0 && dp.far > 0) {
      gsf = Math.round(landSF * dp.far);
    }
    const nrsf = Math.round(gsf * (dp.efficiency_pct / 100));
    return { ...dp, max_gsf: gsf, max_nrsf: nrsf };
  }, [deal]);

  // ── Save all data to UW JSONB ──────────────────────────────────────────
  const saveAll = useCallback(async () => {
    setSaving(true);
    try {
      // Also update deal.land_acres
      await fetch(`/api/deals/${params.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ land_acres: siteInfo.land_acres }),
      });

      // Fetch current UW, merge site/zoning data
      const uwRes = await fetch(`/api/underwriting?deal_id=${params.id}`);
      const uwJson = await uwRes.json();
      const current = uwJson.data?.data
        ? (typeof uwJson.data.data === "string" ? JSON.parse(uwJson.data.data) : uwJson.data.data)
        : {};

      const finalDev = recalcBuilding(siteInfo, devParams);
      // Persist a legacy `value` string alongside each structured height
      // limit so downstream consumers (Programming page's regex parser)
      // keep working without needing a coordinated change.
      const zoningForSave: ZoningInfo = {
        ...zoning,
        height_limits: zoning.height_limits.map(h => ({
          ...h,
          value: heightLimitDisplay(h),
        })),
      };
      const merged = {
        ...current,
        site_info: siteInfo,
        zoning_info: zoningForSave,
        dev_params: finalDev,
        site_plan: sitePlan,
        zoning_narrative: narrative,
        last_report_date: lastReportDate,
        // Also sync flat fields used by underwriting page
        development_mode: deal?.investment_strategy === "ground_up" || current.development_mode,
        lot_coverage_pct: finalDev.lot_coverage_pct,
        far: finalDev.far,
        height_limit_stories: finalDev.height_limit_stories,
        efficiency_pct: finalDev.efficiency_pct,
        max_gsf: finalDev.max_gsf,
        max_nrsf: finalDev.max_nrsf,
      };

      await fetch("/api/underwriting", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deal_id: params.id, data: merged }),
      });

      // Save zoning strategy notes as a deal note (context category) if non-empty
      if (zoning.additional_notes?.trim()) {
        try {
          await fetch(`/api/deals/${params.id}/notes`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: `[Zoning] ${zoning.additional_notes}`, category: "context", source: "manual" }),
          });
        } catch { /* non-critical */ }
      }

      setDirty(false);
      toast.success("Site & zoning data saved");
    } catch {
      toast.error("Failed to save");
    } finally {
      setSaving(false);
    }
  }, [params.id, siteInfo, zoning, devParams, sitePlan, narrative, lastReportDate, deal, recalcBuilding]);

  // ── Autosave: fires 2s after any meaningful change, mirrors the
  //    programming page behaviour so drawing a site plan or editing a
  //    zoning field doesn't require clicking Save. The Save button still
  //    works for explicit saves; it just becomes redundant while the
  //    page is idle. Pan/zoom never trigger dirty (see updateSitePlan
  //    below) so map exploration won't thrash the endpoint.
  useEffect(() => {
    if (loading || !dirty) return;
    const t = setTimeout(saveAll, 2000);
    return () => clearTimeout(t);
  }, [dirty, loading, saveAll]);

  // ── AI Zoning Report ───────────────────────────────────────────────────
  const runZoningReport = async () => {
    setGenerating(true);
    try {
      const res = await fetch(`/api/deals/${params.id}/zoning-report`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) { toast.error(json.error || "Failed"); return; }

      const result = json.data;

      // Merge AI results into zoning table
      setZoning(prev => ({
        ...prev,
        zoning_designation: result.structured?.zoning_designation || prev.zoning_designation,
        source_url: result.structured?.source_url || prev.source_url,
        overlays: result.structured?.overlays?.length > 0 ? result.structured.overlays : prev.overlays,
        permitted_uses: result.structured?.permitted_uses?.length > 0 ? result.structured.permitted_uses : prev.permitted_uses,
        lot_coverage_pct: result.structured?.lot_coverage_pct ?? prev.lot_coverage_pct,
        far: result.structured?.far ?? prev.far,
        parking_requirements: result.structured?.parking_requirements || prev.parking_requirements,
        density_bonuses: result.structured?.density_bonuses?.length > 0
          ? result.structured.density_bonuses.map((b: any) => ({ source: b.source, description: b.description, additional_density: b.additional_density, enabled: true }))
          : prev.density_bonuses,
        // AI's per-program applicability hints — merged over any manual overrides.
        bonus_applicability: result.structured?.bonus_applicability
          ? { ...prev.bonus_applicability, ...result.structured.bonus_applicability }
          : prev.bonus_applicability,
        future_legislation: result.structured?.future_legislation?.length > 0
          ? result.structured.future_legislation
          : prev.future_legislation,
        setbacks: result.structured?.setbacks
          ? [
              { label: "Front", feet: result.structured.setbacks.front ?? null },
              { label: "Side", feet: result.structured.setbacks.side ?? null },
              { label: "Rear", feet: result.structured.setbacks.rear ?? null },
            ]
          : prev.setbacks,
        height_limits: (result.structured?.max_height_stories != null || result.structured?.max_height_ft != null)
          ? [{
              label: "Base Zoning",
              stories: result.structured?.max_height_stories ?? null,
              feet: result.structured?.max_height_ft ?? null,
              // Most codes express height as "X feet OR Y stories, whichever is less".
              connector: "or" as const,
            }]
          : prev.height_limits,
      }));

      // Sync dev params from AI
      if (result.structured?.far != null || result.structured?.lot_coverage_pct != null) {
        setDevParams(prev => {
          const updated = {
            ...prev,
            far: result.structured?.far ?? prev.far,
            lot_coverage_pct: result.structured?.lot_coverage_pct ?? prev.lot_coverage_pct,
            height_limit_stories: result.structured?.max_height_stories ?? prev.height_limit_stories,
          };
          return recalcBuilding(siteInfo, updated);
        });
      }

      setNarrative(result.narrative || "");
      setLastReportDate(new Date().toISOString());
      setDirty(true);
      toast.success("Zoning report generated — click Save to persist");

      // Save to deal memory
      try {
        const memoryNote = `[Zoning Report ${new Date().toLocaleDateString()}] Zone: ${result.structured?.zoning_designation || "Unknown"}. FAR: ${result.structured?.far ?? "N/A"}. Lot Coverage: ${result.structured?.lot_coverage_pct ?? "N/A"}%. Overlays: ${result.structured?.overlays?.join(", ") || "None"}.`;
        await fetch(`/api/deals/${params.id}/notes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: memoryNote, category: "context", source: "ai" }),
        });
      } catch { /* silent */ }

    } catch {
      toast.error("Network error generating zoning report");
    } finally {
      setGenerating(false);
    }
  };

  // ── Export Word ─────────────────────────────────────────────────────────
  const exportWord = async () => {
    setExporting(true);
    try {
      const res = await fetch(`/api/deals/${params.id}/zoning-report/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealName: deal?.name || "Deal",
          siteInfo,
          zoningInfo: zoning,
          devParams: recalcBuilding(siteInfo, devParams),
          narrative,
        }),
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Zoning-Report-${(deal?.name || "Deal").replace(/[^a-zA-Z0-9]/g, "-").slice(0, 60)}.docx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Word document downloaded");
    } catch {
      toast.error("Export failed");
    } finally {
      setExporting(false);
    }
  };

  // ── Update helpers ─────────────────────────────────────────────────────
  const updateSite = (k: keyof SiteInfo, v: any) => {
    setSiteInfo(prev => {
      const next = { ...prev, [k]: v };
      // Sync acres ↔ SF
      if (k === "land_acres") next.land_sf = Math.round((parseFloat(v) || 0) * 43560);
      if (k === "land_sf") next.land_acres = parseFloat(((parseFloat(v) || 0) / 43560).toFixed(4));
      setDirty(true);
      return next;
    });
  };

  const updateZoning = (k: keyof ZoningInfo, v: any) => {
    setZoning(prev => ({ ...prev, [k]: v }));
    setDirty(true);
  };

  // Map-controlled updates flow through here. Pan/zoom events also come
  // through onChange (we persist center/zoom so the map re-opens where the
  // user left it), but we do NOT mark the page dirty for pure view changes
  // — otherwise just looking around the map would flip the Save button on
  // and fight autosave. We compare meaningful fields; anything else is
  // treated as a content edit and marks dirty.
  const updateSitePlan = useCallback((next: SitePlanType) => {
    setSitePlan(prev => {
      const contentChanged =
        prev.parcel_points !== next.parcel_points ||
        prev.buildings !== next.buildings ||
        prev.active_building_id !== next.active_building_id ||
        prev.parcel_area_sf !== next.parcel_area_sf ||
        prev.show_setbacks !== next.show_setbacks ||
        prev.snap_right_angle !== next.snap_right_angle ||
        prev.snap_vertex !== next.snap_vertex ||
        prev.snap_grid_ft !== next.snap_grid_ft ||
        prev.map_style !== next.map_style;
      if (contentChanged) setDirty(true);
      return next;
    });
  }, []);

  // Push the drawn site-plan footprint into the Programming page's active
  // massing scenario. Writes directly to underwriting.data.building_program
  // so the user sees the update when they switch pages. We also stamp the
  // scenario's site_plan_building_id so the hydration path knows the link.
  const pushFootprintToProgramming = useCallback(
    async (footprintSf: number, building: any | null) => {
      if (footprintSf <= 0) return;
      try {
        const uwRes = await fetch(`/api/underwriting?deal_id=${params.id}`);
        const uwJson = await uwRes.json();
        const current = uwJson.data?.data
          ? (typeof uwJson.data.data === "string" ? JSON.parse(uwJson.data.data) : uwJson.data.data)
          : {};
        const prog = current.building_program;
        if (!prog?.scenarios?.length) {
          toast.error("No massing scenarios yet — create one on the Programming page first");
          return;
        }
        const activeId = prog.active_scenario_id || prog.scenarios[0].id;
        const updatedProg = {
          ...prog,
          scenarios: prog.scenarios.map((s: any) =>
            s.id === activeId
              ? {
                  ...s,
                  footprint_sf: Math.round(footprintSf),
                  site_plan_building_id: building?.id || null,
                }
              : s
          ),
        };
        await fetch("/api/underwriting", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            deal_id: params.id,
            data: { ...current, building_program: updatedProg },
          }),
        });
        toast.success(
          `Pushed ${Math.round(footprintSf).toLocaleString()} SF ${
            building ? `(${building.label}) ` : ""
          }to active scenario`
        );
      } catch {
        toast.error("Failed to push footprint to Programming");
      }
    },
    [params.id]
  );

  const updateDev = (k: keyof DevParams, v: number) => {
    setDevParams(prev => {
      const updated = { ...prev, [k]: v };
      const recalced = recalcBuilding(siteInfo, updated);
      setDirty(true);
      return recalced;
    });
  };

  // ── APN auto-lookup ───────────────────────────────────────────────────
  // Calls the parcel-lookup endpoint, which uses Claude to suggest an APN
  // based on the deal address. Manual-only — we used to auto-trigger on
  // first load, but Claude's knowledge of county-specific APNs isn't
  // reliable enough for silent execution. Analysts click "Auto-fill" when
  // they want to try it.
  const lookupApn = useCallback(async () => {
    if (!deal?.address && !deal?.city) {
      toast.error("Add a deal address first");
      return;
    }
    setApnLookup(prev => ({ ...prev, loading: true }));
    try {
      const res = await fetch(`/api/deals/${params.id}/parcel-lookup`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        setApnLookup({ loading: false, source_url: null, confidence: "low", notes: json.error || "Lookup failed", attempted: true });
        toast.error(json.error || "APN lookup failed");
        return;
      }
      const { apn, source_url, confidence, notes } = json.data as {
        apn: string | null;
        source_url: string | null;
        confidence: "high" | "medium" | "low";
        notes: string;
      };
      setApnLookup({ loading: false, source_url, confidence, notes, attempted: true });
      if (apn) {
        updateSite("parcel_id", apn);
        toast.success(`APN auto-filled (${confidence} confidence)`);
      } else {
        toast.info("Couldn't find a confident APN — check the county assessor page");
      }
    } catch {
      setApnLookup({ loading: false, source_url: null, confidence: "low", notes: "Network error", attempted: true });
      toast.error("APN lookup failed");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id, deal?.address, deal?.city]);

  // ── Loading ────────────────────────────────────────────────────────────
  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  const isIndustrial = deal?.property_type === "industrial";
  const isMF = ["multifamily", "student_housing"].includes(deal?.property_type || "");
  const isGroundUp = deal?.investment_strategy === "ground_up";
  // Site plan is only relevant where the analyst is shaping a physical
  // program — ground-up, value-add (redevelopment), and opportunistic. Core /
  // core-plus acquisitions typically don't need to sketch a new footprint.
  const isDev = ["ground_up", "value_add", "opportunistic"].includes(
    deal?.investment_strategy || ""
  );
  const computedDev = recalcBuilding(siteInfo, devParams);

  // Map zoning.setbacks[] (label + feet) into the {front, side, rear, corner}
  // shape the SitePlanGenerator / SitePlanMetrics expect. Matches by the
  // label string case-insensitively so analysts who renamed a row still get
  // the envelope — anything we can't match just doesn't drive the inset.
  // We match "side" but exclude rows containing "corner" so a "Corner Side"
  // row feeds the corner slot rather than the side slot.
  const findSetback = (include: string, exclude?: string): number | null => {
    const row = zoning.setbacks.find(s => {
      const label = (s.label || "").toLowerCase();
      if (!label.includes(include)) return false;
      if (exclude && label.includes(exclude)) return false;
      return true;
    });
    return row?.feet ?? null;
  };
  const sitePlanSetbacks = {
    front: findSetback("front"),
    side: findSetback("side", "corner"),
    rear: findSetback("rear"),
    corner: findSetback("corner"),
  };

  const dealCenter =
    deal?.lat != null && deal?.lng != null
      ? { lat: Number(deal.lat), lng: Number(deal.lng) }
      : null;

  return (
    <div className="space-y-5 animate-fade-up">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-bold">Site & Zoning</h2>
          <p className="text-sm text-muted-foreground">
            Site information, zoning analysis, and development parameters
            {lastReportDate && <span className="ml-2 text-xs">· AI report {new Date(lastReportDate).toLocaleDateString()}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {narrative && (
            <Button variant="outline" size="sm" onClick={exportWord} disabled={exporting}>
              {exporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
              Export Word
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={runZoningReport} disabled={generating}>
            {generating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
            {narrative ? "Refresh AI Report" : "Run AI Zoning Report"}
          </Button>
          <Button size="sm" onClick={saveAll} disabled={saving || !dirty}>
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            Save
          </Button>
        </div>
      </div>

      {/* ── Site Information ─────────────────────────────────────────── */}
      <Section title="Site Information" icon={<MapPin className="h-4 w-4 text-emerald-400" />}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <FieldInput label="Land (Acres)" value={siteInfo.land_acres || ""} onChange={v => updateSite("land_acres", parseFloat(v) || 0)} type="number" suffix="AC" />
          <FieldInput label="Land (Square Feet)" value={siteInfo.land_sf || ""} onChange={v => updateSite("land_sf", parseFloat(v) || 0)} type="number" suffix="SF" />
          {/* Parcel ID / APN — auto-populated from the deal address via the
              parcel-lookup endpoint. The button re-runs the lookup and
              overwrites any existing value. */}
          <div>
            <div className="flex items-baseline justify-between mb-1">
              <label className="block text-[10px] text-muted-foreground uppercase tracking-wide">Parcel ID / APN</label>
              <button
                type="button"
                onClick={() => lookupApn()}
                disabled={apnLookup.loading || (!deal?.address && !deal?.city)}
                className="inline-flex items-center gap-1 text-[10px] text-primary hover:text-primary/80 disabled:text-muted-foreground/40 disabled:cursor-not-allowed"
                title="Try to auto-fill APN from address (best effort)"
              >
                {apnLookup.loading
                  ? <><Loader2 className="h-3 w-3 animate-spin" /> Looking up…</>
                  : <><Wand2 className="h-3 w-3" /> Auto-fill</>}
              </button>
            </div>
            <div className="flex items-center border border-border/40 rounded-lg bg-muted/20 overflow-hidden">
              <input
                type="text"
                value={siteInfo.parcel_id}
                onChange={e => updateSite("parcel_id", e.target.value)}
                placeholder="e.g. 123-456-789"
                className="flex-1 px-3 py-1.5 text-sm bg-transparent outline-none"
              />
            </div>
            {apnLookup.source_url ? (
              <a
                href={apnLookup.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 mt-1 text-[10px] text-primary hover:underline"
              >
                <ExternalLink className="h-3 w-3" /> County assessor page
              </a>
            ) : apnLookup.attempted && !apnLookup.loading && !siteInfo.parcel_id ? (
              <p className="mt-1 text-[10px] text-muted-foreground/70">
                {apnLookup.notes || "Couldn't auto-fill — check the county assessor site."}
              </p>
            ) : null}
          </div>
          <SelectInput label="Flood Zone" value={siteInfo.flood_zone} onChange={v => updateSite("flood_zone", v)} options={[
            { value: "", label: "Select..." },
            { value: "Zone X", label: "Zone X (Minimal Risk)" },
            { value: "Zone AE", label: "Zone AE (100-Year Floodplain)" },
            { value: "Zone A", label: "Zone A (100-Year, No BFE)" },
            { value: "Zone AH", label: "Zone AH (Shallow Flooding)" },
            { value: "Zone VE", label: "Zone VE (Coastal High Hazard)" },
            { value: "Zone X500", label: "Zone X (500-Year / Moderate)" },
            { value: "Zone D", label: "Zone D (Undetermined)" },
          ]} />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
          <SelectInput label="Topography" value={siteInfo.topography} onChange={v => updateSite("topography", v)} options={[
            { value: "", label: "Select..." },
            { value: "Flat", label: "Flat" },
            { value: "Gently Sloped", label: "Gently Sloped" },
            { value: "Moderately Sloped", label: "Moderately Sloped" },
            { value: "Steep", label: "Steep" },
            { value: "Varied / Irregular", label: "Varied / Irregular" },
          ]} />
          <SelectInput label="Environmental Status" value={siteInfo.environmental_status || ""} onChange={v => updateSite("environmental_status", v)} options={[
            { value: "", label: "Select..." },
            { value: "Not Started", label: "Not Started" },
            { value: "Phase I Clean", label: "Phase I — Clean" },
            { value: "Phase I RECs Found", label: "Phase I — RECs Found" },
            { value: "Phase II In Progress", label: "Phase II In Progress" },
            { value: "Phase II Clean", label: "Phase II — Clean" },
            { value: "Remediation Needed", label: "Remediation Needed" },
            { value: "Remediation Complete", label: "Remediation Complete" },
            { value: "Cleared", label: "Cleared / No Issues" },
          ]} />
          <SelectInput label="Soil Type" value={siteInfo.soil_type || ""} onChange={v => updateSite("soil_type", v)} options={[
            { value: "", label: "Select..." },
            { value: "Rock / Bedrock", label: "Rock / Bedrock" },
            { value: "Gravel", label: "Gravel" },
            { value: "Sand", label: "Sand" },
            { value: "Clay", label: "Clay" },
            { value: "Silt", label: "Silt" },
            { value: "Fill / Engineered", label: "Fill / Engineered" },
            { value: "Expansive", label: "Expansive Soil" },
            { value: "Unknown", label: "Unknown — Geotech Needed" },
          ]} />
        </div>
        <div className="mt-4">
          <CheckboxGroup label="Utilities Available" options={["Water", "Sewer", "Gas", "Electric", "Fiber/Telecom", "Storm Drain", "Reclaimed Water"]}
            selected={siteInfo.utilities_available || []} onChange={v => updateSite("utilities_available", v)} />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <TextArea label="Current Improvements" value={siteInfo.current_improvements} onChange={v => updateSite("current_improvements", v)} placeholder="Existing structures, parking, etc." />
          <TextArea label="Additional Site Notes" value={siteInfo.environmental_notes} onChange={v => updateSite("environmental_notes", v)} placeholder="Additional environmental, geotechnical, or site notes..." />
        </div>
      </Section>

      {/* ── Zoning Information ───────────────────────────────────────── */}
      <Section
        title="Zoning Information"
        icon={<Building2 className="h-4 w-4 text-blue-400" />}
        headerRight={
          zoning.source_url ? (
            <a
              href={zoning.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
              title="Open jurisdiction's zoning page"
            >
              <ExternalLink className="h-3 w-3" /> Source
            </a>
          ) : null
        }
      >
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <FieldInput label="Zoning Designation" value={zoning.zoning_designation} onChange={v => updateZoning("zoning_designation", v)} placeholder="e.g. M-1, PD-123" className="col-span-2" />
          <FieldInput label="FAR (Floor Area Ratio)" value={zoning.far ?? ""} onChange={v => updateZoning("far", parseFloat(v) || null)} type="number" />
          <FieldInput label="Max Lot Coverage" value={zoning.lot_coverage_pct ?? ""} onChange={v => updateZoning("lot_coverage_pct", parseFloat(v) || null)} type="number" suffix="%" />
        </div>

        {/* Source page URL — editable so analysts can paste or fix the link
            the AI found. Rendered as a clickable "Source" chip in the
            section header when set. */}
        <div className="mt-4">
          <label className="block text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Jurisdiction Source Page (URL)</label>
          <div className="flex items-center border border-border/40 rounded-lg bg-muted/20 overflow-hidden">
            <input
              type="url"
              value={zoning.source_url}
              onChange={e => updateZoning("source_url", e.target.value)}
              placeholder="https://www.city.gov/planning/zoning"
              className="flex-1 px-3 py-1.5 text-sm bg-transparent outline-none"
            />
            {zoning.source_url && (
              <a
                href={zoning.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="px-2 py-1.5 text-xs text-primary bg-muted/30 border-l border-border/40 hover:bg-muted/50"
                title="Open in new tab"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground/70 mt-1">
            Link to the actual jurisdiction&apos;s zoning page. Auto-populated by the AI Zoning Report.
          </p>
        </div>

        {/* Overlays */}
        <div className="mt-4">
          <label className="block text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Overlay Districts</label>
          <div className="flex flex-wrap gap-2 mb-2">
            {zoning.overlays.map((o, i) => (
              <span key={i} className="inline-flex items-center gap-1 px-2.5 py-1 text-xs bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-lg">
                {o}
                <button onClick={() => updateZoning("overlays", zoning.overlays.filter((_, j) => j !== i))} className="hover:text-red-400 ml-1">&times;</button>
              </span>
            ))}
            <button
              onClick={() => {
                const v = prompt("Add overlay district:");
                if (v?.trim()) updateZoning("overlays", [...zoning.overlays, v.trim()]);
              }}
              className="px-2.5 py-1 text-xs border border-dashed border-border/60 rounded-lg text-muted-foreground hover:text-foreground hover:border-primary/40"
            >+ Add</button>
          </div>
        </div>

        {/* Permitted Uses */}
        <div className="mt-4">
          <label className="block text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Permitted Uses</label>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {zoning.permitted_uses.map((u, i) => (
              <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-muted/40 border border-border/40 rounded-md">
                {u}
                <button onClick={() => updateZoning("permitted_uses", zoning.permitted_uses.filter((_, j) => j !== i))} className="hover:text-red-400">&times;</button>
              </span>
            ))}
            <button
              onClick={() => {
                const v = prompt("Add permitted use:");
                if (v?.trim()) updateZoning("permitted_uses", [...zoning.permitted_uses, v.trim()]);
              }}
              className="px-2 py-0.5 text-xs border border-dashed border-border/60 rounded-md text-muted-foreground hover:text-foreground"
            >+ Add</button>
          </div>
        </div>

        {/* Setbacks Table */}
        <div className="mt-4">
          <label className="block text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Setbacks</label>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {zoning.setbacks.map((s, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  value={s.label}
                  onChange={e => {
                    const next = [...zoning.setbacks];
                    next[i] = { ...next[i], label: e.target.value };
                    updateZoning("setbacks", next);
                  }}
                  className="flex-1 px-2 py-1 text-xs bg-muted/20 border border-border/40 rounded outline-none"
                  placeholder="Label"
                />
                <input
                  type="number"
                  value={s.feet ?? ""}
                  onChange={e => {
                    const next = [...zoning.setbacks];
                    next[i] = { ...next[i], feet: parseFloat(e.target.value) || null };
                    updateZoning("setbacks", next);
                  }}
                  className="w-16 px-2 py-1 text-xs bg-muted/20 border border-border/40 rounded outline-none text-right"
                  placeholder="ft"
                />
                <span className="text-xs text-muted-foreground">ft</span>
              </div>
            ))}
          </div>
          <button
            onClick={() => updateZoning("setbacks", [...zoning.setbacks, { label: "", feet: null }])}
            className="mt-2 text-xs text-muted-foreground hover:text-foreground"
          >+ Add setback</button>
        </div>

        {/* Height Limits Table — feet / stories with "and"/"or" connector */}
        <div className="mt-4">
          <label className="block text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Height Limits</label>
          <p className="text-[10px] text-muted-foreground/70 mb-2">
            Enter feet and/or stories. Use <span className="font-medium">&quot;or&quot;</span> when
            the code allows either (&quot;whichever is less&quot;) and
            <span className="font-medium"> &quot;and&quot;</span> when both apply simultaneously.
          </p>
          <div className="space-y-2">
            {zoning.height_limits.map((h, i) => (
              <div key={i} className="flex items-center gap-2 flex-wrap">
                <input
                  value={h.label}
                  onChange={e => {
                    const next = [...zoning.height_limits];
                    next[i] = { ...next[i], label: e.target.value };
                    updateZoning("height_limits", next);
                  }}
                  className="w-40 px-2 py-1 text-xs bg-muted/20 border border-border/40 rounded outline-none"
                  placeholder="e.g. Base Zoning"
                />
                <div className="flex items-center gap-1 border border-border/40 rounded bg-muted/20 overflow-hidden">
                  <input
                    type="number"
                    value={h.feet ?? ""}
                    onChange={e => {
                      const next = [...zoning.height_limits];
                      const parsed = parseFloat(e.target.value);
                      next[i] = { ...next[i], feet: isNaN(parsed) ? null : parsed };
                      updateZoning("height_limits", next);
                    }}
                    className="w-20 px-2 py-1 text-xs bg-transparent outline-none text-right"
                    placeholder="—"
                  />
                  <span className="px-1.5 text-[10px] text-muted-foreground bg-muted/40 border-l border-border/40 py-1">ft</span>
                </div>
                <select
                  value={h.connector || "and"}
                  onChange={e => {
                    const next = [...zoning.height_limits];
                    next[i] = { ...next[i], connector: e.target.value === "or" ? "or" : "and" };
                    updateZoning("height_limits", next);
                  }}
                  className="px-2 py-1 text-xs bg-background text-foreground border border-border/40 rounded outline-none focus:border-primary/40"
                >
                  <option value="and">and</option>
                  <option value="or">or</option>
                </select>
                <div className="flex items-center gap-1 border border-border/40 rounded bg-muted/20 overflow-hidden">
                  <input
                    type="number"
                    value={h.stories ?? ""}
                    onChange={e => {
                      const next = [...zoning.height_limits];
                      const parsed = parseFloat(e.target.value);
                      next[i] = { ...next[i], stories: isNaN(parsed) ? null : parsed };
                      updateZoning("height_limits", next);
                    }}
                    className="w-20 px-2 py-1 text-xs bg-transparent outline-none text-right"
                    placeholder="—"
                  />
                  <span className="px-1.5 text-[10px] text-muted-foreground bg-muted/40 border-l border-border/40 py-1">stories</span>
                </div>
                <button
                  onClick={() => updateZoning("height_limits", zoning.height_limits.filter((_, j) => j !== i))}
                  className="text-muted-foreground/40 hover:text-red-400 text-xs ml-auto"
                  aria-label="Remove height limit"
                >&times;</button>
              </div>
            ))}
          </div>
          <button
            onClick={() => updateZoning("height_limits", [...zoning.height_limits, { label: "", feet: null, stories: null, connector: "and" as const }])}
            className="mt-2 text-xs text-muted-foreground hover:text-foreground"
          >+ Add height limit</button>
        </div>

        {/* Parking Requirements (structured) */}
        <div className="mt-4">
          <label className="block text-[10px] text-muted-foreground uppercase tracking-wide mb-2">Parking Requirements</label>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <FieldInput label="Spaces / Residential Unit" value={zoning.parking_ratio_residential || ""} onChange={v => updateZoning("parking_ratio_residential", parseFloat(v) || 0)} type="number" />
            <FieldInput label="Spaces / 1,000 SF Commercial" value={zoning.parking_ratio_commercial || ""} onChange={v => updateZoning("parking_ratio_commercial", parseFloat(v) || 0)} type="number" />
            <div className="col-span-2 flex items-center gap-3">
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={zoning.parking_reduction_allowed} onChange={e => updateZoning("parking_reduction_allowed", e.target.checked)} className="accent-primary" />
                Shared Parking / Reduction Allowed
              </label>
            </div>
          </div>
          {zoning.parking_reduction_allowed && (
            <div className="mt-2">
              <FieldInput label="Reduction Basis (program, study, TOD, etc.)" value={zoning.parking_reduction_notes} onChange={v => updateZoning("parking_reduction_notes", v)} placeholder="e.g. TOD overlay allows 50% reduction within 0.5mi of transit" />
            </div>
          )}
          <div className="mt-2">
            <TextArea label="Additional Parking Notes" value={zoning.parking_requirements} onChange={v => updateZoning("parking_requirements", v)} placeholder="Additional context on parking code, EV requirements, bicycle parking..." rows={2} />
          </div>
        </div>

        {/* Open Space (structured) */}
        <div className="mt-4">
          <label className="block text-[10px] text-muted-foreground uppercase tracking-wide mb-2">Open Space Requirements</label>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <FieldInput label="Open Space % of Lot" value={zoning.open_space_pct ?? ""} onChange={v => updateZoning("open_space_pct", parseFloat(v) || null)} type="number" suffix="%" />
            <FieldInput label="Or: Fixed SF Required" value={zoning.open_space_sf ?? ""} onChange={v => updateZoning("open_space_sf", parseFloat(v) || null)} type="number" suffix="SF" />
            <div className="col-span-2">
              <TextArea label="Open Space Notes" value={zoning.open_space_requirements} onChange={v => updateZoning("open_space_requirements", v)} placeholder="Common open space, private balconies, rooftop, ground-level..." rows={2} />
            </div>
          </div>
        </div>

        {/* Density Bonuses & Incentives — one unified card grid.
            - Cards in `density_bonuses` (i.e. clicked / applied) render at
              the TOP in "Applied to this project". These are the ones that
              flow through to Programming and underwriting.
            - All other catalog cards render BELOW, grouped by applicability
              (By-Right → Possible → Doesn't Apply).
            - Clicking any card toggles it on/off — applied cards move up
              top, catalog cards move down. Same visual format throughout. */}
        <div className="mt-4">
          <label className="block text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Density Bonuses & Incentives</label>
          <p className="text-[10px] text-muted-foreground/80 mb-3">
            Click a card to apply it to this project. Applied programs move to the top and flow through to Programming & Underwriting.
          </p>

          {(() => {
            // Small reusable card renderer so applied + catalog cards share
            // exactly the same visual format (user's ask: "same grid
            // format"). `applied` controls the emerald accent + the
            // top-right toggle label; everything else is identical.
            const renderCard = (args: {
              source: string;
              description: string;
              additional_density: string;
              applySummary?: string;
              applied: boolean;
              // Allow the 3-way applicability picker to appear only on
              // non-applied (catalog) cards — applied cards don't need it
              // because they've already been selected.
              showApplicability: boolean;
              onToggle: () => void;
            }) => {
              const app = zoning.bonus_applicability[args.source] || "may_apply";
              const setApp = (next: BonusApplicability) => {
                updateZoning("bonus_applicability", { ...zoning.bonus_applicability, [args.source]: next });
              };
              return (
                <button
                  type="button"
                  onClick={args.onToggle}
                  className={`text-left p-2.5 rounded-lg border transition-colors h-full flex flex-col ${
                    args.applied
                      ? "bg-emerald-500/10 border-emerald-500/40 hover:bg-emerald-500/15"
                      : "bg-muted/10 border-border/40 hover:border-primary/40 hover:bg-muted/20"
                  }`}
                  title={args.applied ? "Click to remove from this project" : "Click to apply to this project"}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs font-medium text-foreground">{args.source || "(custom)"}</span>
                    <span className={`text-[10px] whitespace-nowrap ${args.applied ? "text-emerald-400" : "text-primary/70"}`}>
                      {args.applied ? "✓ Applied" : args.additional_density}
                    </span>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1 line-clamp-2">{args.description}</p>
                  {args.applySummary && (
                    <p className="text-[10px] text-primary/80 mt-1">
                      Programming can one-click apply: {args.applySummary}
                    </p>
                  )}
                  {args.showApplicability && (
                    <div className="flex items-center gap-1 mt-2">
                      {(["applies", "may_apply", "not_applicable"] as const).map(a => (
                        <span
                          key={a}
                          role="button"
                          tabIndex={0}
                          onClick={(e) => { e.stopPropagation(); setApp(a); }}
                          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); setApp(a); } }}
                          className={`px-1.5 py-0.5 rounded text-[10px] border transition-colors cursor-pointer ${
                            app === a
                              ? a === "applies" ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-400"
                                : a === "may_apply" ? "bg-amber-500/20 border-amber-500/40 text-amber-400"
                                  : "bg-muted/40 border-border/60 text-muted-foreground"
                              : "bg-transparent border-border/40 text-muted-foreground/70 hover:border-primary/40"
                          }`}
                          title={a === "applies" ? "Move to By-Right" : a === "may_apply" ? "Move to Possible" : "Move to Doesn't Apply"}
                        >
                          {a === "applies" ? "By-Right" : a === "may_apply" ? "Possible" : "N/A"}
                        </span>
                      ))}
                    </div>
                  )}
                </button>
              );
            };

            // ── Applied section (top) ─────────────────────────────────
            const appliedCards = zoning.density_bonuses.map((b, i) => {
              const catalogMatch = BONUS_CATALOG.find(c => c.source === b.source);
              return {
                index: i,
                source: b.source,
                description: b.description || catalogMatch?.description || "",
                additional_density: b.additional_density || catalogMatch?.additional_density || "",
                applySummary: catalogMatch?.effects?.applySummary,
              };
            });

            // ── Catalog section (grouped, excludes applied) ───────────
            const appliedSources = new Set(zoning.density_bonuses.map(b => b.source));
            const catalogByGroup = (["applies", "may_apply", "not_applicable"] as const).map(group => ({
              group,
              items: BONUS_CATALOG.filter(b => {
                if (appliedSources.has(b.source)) return false;
                // Default unclassified programs to "Possible" so every card
                // still lands somewhere legible.
                const app = zoning.bonus_applicability[b.source] || "may_apply";
                return app === group;
              }),
            }));

            const groupLabel = (g: BonusApplicability) =>
              g === "applies" ? "By-Right" : g === "may_apply" ? "Possible" : "Doesn't Apply";
            const groupAccent = (g: BonusApplicability) =>
              g === "applies" ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/5"
                : g === "may_apply" ? "text-amber-400 border-amber-500/30 bg-amber-500/5"
                  : "text-muted-foreground border-border/40 bg-muted/10";

            return (
              <>
                {/* Applied section — only renders when at least one card has
                    been clicked. Uses the same grid layout as the catalog. */}
                {appliedCards.length > 0 && (
                  <div className="mb-4 pb-4 border-b border-border/40">
                    <div className="inline-flex items-center gap-2 px-2 py-0.5 rounded border text-[10px] uppercase tracking-wide mb-2 text-emerald-400 border-emerald-500/40 bg-emerald-500/10">
                      <span className="font-semibold">Applied to This Project</span>
                      <span className="text-[10px] opacity-70">{appliedCards.length}</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                      {appliedCards.map(card => renderCard({
                        source: card.source,
                        description: card.description,
                        additional_density: card.additional_density,
                        applySummary: card.applySummary,
                        applied: true,
                        showApplicability: false,
                        onToggle: () => updateZoning(
                          "density_bonuses",
                          zoning.density_bonuses.filter((_, j) => j !== card.index)
                        ),
                      }))}
                    </div>
                  </div>
                )}

                {/* Catalog section — all remaining cards grouped by
                    applicability. Every card uses the same renderCard. */}
                {catalogByGroup.map(({ group, items }) => (
                  <div key={group} className="mb-3">
                    <div className={`inline-flex items-center gap-2 px-2 py-0.5 rounded border text-[10px] uppercase tracking-wide mb-2 ${groupAccent(group)}`}>
                      <span className="font-semibold">{groupLabel(group)}</span>
                      <span className="text-[10px] opacity-70">{items.length}</span>
                    </div>
                    {items.length === 0 ? (
                      <p className="text-[10px] text-muted-foreground/50 italic">None in this group.</p>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                        {items.map(b => renderCard({
                          source: b.source,
                          description: b.description,
                          additional_density: b.additional_density,
                          applySummary: b.effects?.applySummary,
                          applied: false,
                          showApplicability: true,
                          onToggle: () => updateZoning("density_bonuses", [
                            ...zoning.density_bonuses,
                            {
                              source: b.source,
                              description: b.description,
                              additional_density: b.additional_density,
                              enabled: true,
                            },
                          ]),
                        }))}
                      </div>
                    )}
                  </div>
                ))}
              </>
            );
          })()}

          <button
            onClick={() => {
              const source = window.prompt("Program name / source (e.g. 'Local Inclusionary'):");
              if (!source?.trim()) return;
              const description = window.prompt("Description:", "") || "";
              const additional_density = window.prompt("Additional density (e.g. '+35% FAR'):", "") || "";
              updateZoning("density_bonuses", [
                ...zoning.density_bonuses,
                { source: source.trim(), description: description.trim(), additional_density: additional_density.trim(), enabled: true },
              ]);
            }}
            className="mt-2 text-xs text-muted-foreground hover:text-foreground"
          >+ Add custom program</button>
        </div>

        {/* Zone Change / Rezone */}
        <div className="mt-4">
          <label className="flex items-center gap-2 text-xs mb-2">
            <input type="checkbox" checked={zoning.zone_change_needed} onChange={e => updateZoning("zone_change_needed", e.target.checked)} className="accent-primary" />
            <span className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Zone Change / Rezone Required</span>
          </label>
          {zoning.zone_change_needed && (
            <div className="border border-amber-500/20 bg-amber-500/5 rounded-lg p-3 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <FieldInput label="Current Zoning" value={zoning.zone_change_from || zoning.zoning_designation} onChange={v => updateZoning("zone_change_from", v)} placeholder="e.g. C-2 Commercial" />
                <FieldInput label="Proposed Zoning" value={zoning.zone_change_to} onChange={v => updateZoning("zone_change_to", v)} placeholder="e.g. MF-3 Multifamily" />
                <SelectInput label="Zone Change Type" value={zoning.zone_change_notes} onChange={v => updateZoning("zone_change_notes", v)} options={[
                  { value: "", label: "Select..." },
                  { value: "Rezone Application", label: "Rezone Application" },
                  { value: "Planned Development (PD)", label: "Planned Development (PD)" },
                  { value: "Specific Plan Amendment", label: "Specific Plan Amendment" },
                  { value: "General Plan Amendment", label: "General Plan Amendment" },
                  { value: "Overlay District", label: "Overlay District / Exemption" },
                  { value: "By-Right (CCHS/SB35)", label: "By-Right (CCHS / SB 35 / Housing)" },
                ]} />
              </div>
              <p className="text-[10px] text-amber-400">A zone change adds 6-18 months and requires planning commission + city council approval. Programs like CCHS or SB 35 may allow residential by-right in commercial zones.</p>
            </div>
          )}
        </div>

        {/* Zoning Notes → saved to deal context */}
        <div className="mt-4">
          <TextArea label="Zoning Strategy Notes (saves to Deal Context)" value={zoning.additional_notes} onChange={v => updateZoning("additional_notes", v)} placeholder="Key zoning considerations, local legislation (CCHS, SB 35, density bonuses), entitlement strategy..." rows={3} />
        </div>
      </Section>

      {/* ── Site Plan (parcel + building footprint on satellite) ──────────── */}
      {/* Only shown for strategies where the analyst is shaping the physical
          program: ground-up, value-add (redevelopment), or opportunistic.
          The drawn building footprint (SF) flows into the Programming page's
          active massing scenario footprint_sf on hydrate. Backwards
          compatible: if nothing is drawn, the old typed-footprint workflow
          on Programming is unaffected. */}
      {isDev && (
        <Section title="Site Plan" icon={<MapIcon className="h-4 w-4 text-amber-400" />}>
          <p className="text-xs text-muted-foreground mb-3">
            Trace the parcel boundary, then draw the building footprint on the
            satellite map. Setbacks from the zoning section above appear live
            as a buildable envelope. The drawn footprint SF feeds the
            Programming page&apos;s active massing scenario.
          </p>
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
            <SitePlanGenerator
              value={sitePlan}
              onChange={updateSitePlan}
              setbacks={sitePlanSetbacks}
              fallbackCenter={dealCenter}
              height={560}
            />
            <SitePlanMetrics
              value={sitePlan}
              onChange={updateSitePlan}
              setbacks={sitePlanSetbacks}
              zoningLotCoveragePct={zoning.lot_coverage_pct}
              expectedLandSf={siteInfo.land_sf}
              onPushToProgramming={pushFootprintToProgramming}
              pushTargetLabel="Active massing scenario"
            />
          </div>
        </Section>
      )}

      {/* ── Development Summary (read-only, data from Zoning + Programming) ── */}
      {isGroundUp && (
        <Section title="Development Summary" icon={<Ruler className="h-4 w-4 text-purple-400" />}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-3 bg-muted/30 rounded-lg">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">FAR (from zoning)</p>
              <p className="text-lg font-bold tabular-nums">{devParams.far || zoning.far || "u2014"}</p>
            </div>
            <div className="p-3 bg-muted/30 rounded-lg">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Max GSF</p>
              <p className="text-lg font-bold tabular-nums">{computedDev.max_gsf > 0 ? fn(computedDev.max_gsf) : "u2014"}</p>
            </div>
            <div className="p-3 bg-primary/10 rounded-lg">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Max NRSF</p>
              <p className="text-lg font-bold text-primary tabular-nums">{computedDev.max_nrsf > 0 ? fn(computedDev.max_nrsf) : "u2014"}</p>
              <p className="text-[10px] text-muted-foreground">{devParams.efficiency_pct}% eff.</p>
            </div>
            <div className="p-3 bg-muted/30 rounded-lg">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Lot Coverage</p>
              <p className="text-lg font-bold tabular-nums">{devParams.lot_coverage_pct || zoning.lot_coverage_pct || "u2014"}%</p>
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground mt-2">Configure building program on the <a href={`/deals/${params.id}/programming`} className="text-primary hover:underline">Programming page</a></p>
        </Section>
      )}

      {/* Building Program moved to /deals/[id]/programming page */}


      {/* ── AI Zoning Report Narrative ────────────────────────────────── */}
      {narrative && (
        <Section title="AI Zoning Report" icon={<Sparkles className="h-4 w-4 text-amber-400" />}>
          <div className="prose prose-sm prose-invert max-w-none
            prose-headings:text-foreground prose-headings:font-semibold prose-headings:mt-4 prose-headings:mb-2
            prose-p:text-muted-foreground prose-p:leading-relaxed prose-p:mb-2
            prose-li:text-muted-foreground prose-li:leading-relaxed
            prose-ul:list-disc prose-ul:pl-5 prose-ul:mb-2
            prose-ol:list-decimal prose-ol:pl-5 prose-ol:mb-2
            prose-strong:text-foreground">
            <ReactMarkdown>{narrative}</ReactMarkdown>
          </div>
          <div className="flex gap-2 mt-4 pt-3 border-t border-border/30">
            <Button variant="outline" size="sm" onClick={exportWord} disabled={exporting}>
              {exporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
              Export Word
            </Button>
            <Button variant="outline" size="sm" onClick={async () => {
              try {
                const res = await fetch(`/api/deals/${params.id}/zoning-report/export`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ dealName: deal?.name || "Deal", siteInfo, zoningInfo: zoning, devParams, narrative }),
                });
                if (!res.ok) throw new Error();
                const blob = await res.blob();
                const formData = new FormData();
                formData.append("deal_id", params.id);
                formData.append("files", new File([blob], `Zoning-Report-${(deal?.name || "Deal").replace(/[^a-zA-Z0-9]/g, "_")}.docx`, { type: blob.type }));
                const uploadRes = await fetch("/api/documents/upload", { method: "POST", body: formData });
                if (uploadRes.ok) toast.success("Zoning report saved to deal documents");
                else throw new Error();
              } catch { toast.error("Failed to save report to documents"); }
            }}>
              <FileText className="h-4 w-4 mr-2" /> Save to Documents
            </Button>
          </div>
        </Section>
      )}

      {/* ── Future Legislation ─────────────────────────────────────────
          Upcoming bonuses, incentives, and general plan changes that could
          affect housing on this site. Auto-populated by the AI Zoning Report
          and editable by the analyst. Shown after the zoning report so it
          reads as "here's what could change next". */}
      <Section title="Future Legislation & Plan Changes" icon={<CalendarClock className="h-4 w-4 text-purple-400" />}>
        <p className="text-[11px] text-muted-foreground mb-3">
          Upcoming state or local legislation and general plan changes that could affect this project —
          density bonuses or incentives coming online, phase-in rules, or plan amendments in the works.
        </p>
        {zoning.future_legislation.length === 0 ? (
          <p className="text-xs text-muted-foreground/60 italic mb-3">
            None yet. Run the AI Zoning Report to populate, or add items manually.
          </p>
        ) : (
          <div className="space-y-2 mb-3">
            {zoning.future_legislation.map((item, i) => (
              <div
                key={i}
                className="grid grid-cols-1 md:grid-cols-[180px_120px_1fr_auto] gap-2 p-2.5 bg-purple-500/5 border border-purple-500/20 rounded-lg"
              >
                <input
                  value={item.source}
                  onChange={e => {
                    const next = [...zoning.future_legislation];
                    next[i] = { ...next[i], source: e.target.value };
                    updateZoning("future_legislation", next);
                  }}
                  className="px-2 py-1 text-xs font-medium bg-muted/20 border border-border/40 rounded outline-none"
                  placeholder="Bill / Plan"
                />
                <input
                  value={item.effective_date}
                  onChange={e => {
                    const next = [...zoning.future_legislation];
                    next[i] = { ...next[i], effective_date: e.target.value };
                    updateZoning("future_legislation", next);
                  }}
                  className="px-2 py-1 text-xs bg-muted/20 border border-border/40 rounded outline-none"
                  placeholder="Effective"
                />
                <div className="space-y-1">
                  <input
                    value={item.description}
                    onChange={e => {
                      const next = [...zoning.future_legislation];
                      next[i] = { ...next[i], description: e.target.value };
                      updateZoning("future_legislation", next);
                    }}
                    className="w-full px-2 py-1 text-xs bg-muted/20 border border-border/40 rounded outline-none"
                    placeholder="What it does"
                  />
                  <input
                    value={item.impact}
                    onChange={e => {
                      const next = [...zoning.future_legislation];
                      next[i] = { ...next[i], impact: e.target.value };
                      updateZoning("future_legislation", next);
                    }}
                    className="w-full px-2 py-1 text-xs text-purple-300 bg-muted/20 border border-border/40 rounded outline-none"
                    placeholder="Impact on this deal"
                  />
                </div>
                <button
                  onClick={() => updateZoning("future_legislation", zoning.future_legislation.filter((_, j) => j !== i))}
                  className="text-muted-foreground/40 hover:text-red-400 text-xs self-start"
                  title="Remove"
                >&times;</button>
              </div>
            ))}
          </div>
        )}
        <button
          onClick={() => updateZoning("future_legislation", [...zoning.future_legislation, { source: "", description: "", effective_date: "", impact: "" }])}
          className="text-xs text-muted-foreground hover:text-foreground"
        >+ Add legislation</button>
      </Section>

      {/* Empty state */}
      {!narrative && !zoning.zoning_designation && (
        <div className="border border-dashed border-border/60 rounded-xl p-8 text-center">
          <Sparkles className="h-8 w-8 mx-auto mb-3 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground mb-1">No zoning report yet</p>
          <p className="text-xs text-muted-foreground/60 mb-4">
            Click "Run AI Zoning Report" to analyze zoning codes for this property address, or fill in the fields manually.
          </p>
          <Button variant="outline" size="sm" onClick={runZoningReport} disabled={generating}>
            {generating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
            Run AI Zoning Report
          </Button>
        </div>
      )}
    </div>
  );
}
