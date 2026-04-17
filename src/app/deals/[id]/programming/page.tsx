"use client";

import React, { useState, useEffect, useCallback } from "react";
import { v4 as uuidv4 } from "uuid";
import {
  Loader2, Save, Plus, Trash2, Layers, Building2, Car, DollarSign, Star,
  ChevronDown, ChevronRight, ArrowRight, Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type {
  BuildingProgram, OtherIncomeItem, CommercialTenant, CommercialLeaseType,
} from "@/lib/types";
import { COMMON_OTHER_INCOME } from "@/lib/types";
import MassingSection from "@/components/massing/MassingSection";
import AffordabilityPlanner from "@/components/AffordabilityPlanner";
import { useViewMode } from "@/lib/use-view-mode";
import ViewModeToggle from "@/components/ViewModeToggle";
import { newBuildingProgram, computeMassingSummary, newScenario } from "@/components/massing/massing-utils";
import type { ZoningInputs } from "@/components/massing/massing-utils";
import { splitUnitGroupsByAffordability } from "@/lib/affordability-split";

// ── Helpers ──────────────────────────────────────────────────────────────────
const fc = (n: number) => n || n === 0 ? "$" + Math.round(n).toLocaleString("en-US") : "—";
const fn = (n: number) => n || n === 0 ? Math.round(n).toLocaleString("en-US") : "—";

function Section({ title, icon, children, defaultOpen = true }: {
  title: string; icon: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-border/60 rounded-xl bg-card shadow-card overflow-hidden">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-3 px-5 py-3.5 bg-muted/20 hover:bg-muted/30 transition-colors text-left">
        {open ? <ChevronDown className="h-4 w-4 text-muted-foreground/60" /> : <ChevronRight className="h-4 w-4 text-muted-foreground/60" />}
        <span className="flex items-center gap-2">{icon}<span className="font-semibold text-sm">{title}</span></span>
      </button>
      {open && <div className="px-5 py-4">{children}</div>}
    </div>
  );
}

function NumInput({ label, value, onChange, prefix, suffix, decimals = 0 }: {
  label: string; value: number; onChange: (v: number) => void;
  prefix?: string; suffix?: string; decimals?: number;
}) {
  const fmt = (v: number) => v === 0 ? "" : v.toLocaleString("en-US", { maximumFractionDigits: decimals });
  const [raw, setRaw] = React.useState(fmt(value));
  React.useEffect(() => { setRaw(fmt(value)); }, [value]);
  return (
    <div>
      <label className="block text-xs font-medium text-muted-foreground mb-1">{label}</label>
      <div className="flex items-center border rounded-md bg-background overflow-hidden">
        {prefix && <span className="px-2 text-sm text-muted-foreground bg-muted border-r">{prefix}</span>}
        <input type="text" inputMode="decimal" value={raw}
          onChange={e => setRaw(e.target.value)}
          onBlur={() => { const v = parseFloat(raw.replace(/,/g, "")) || 0; onChange(v); setRaw(fmt(v)); }}
          className="flex-1 px-2 py-1.5 text-sm outline-none bg-transparent text-blue-300 tabular-nums" placeholder="0" />
        {suffix && <span className="px-2 text-sm text-muted-foreground bg-muted border-l">{suffix}</span>}
      </div>
    </div>
  );
}

// Compact read-only chip for the zoning / bonuses context strip.
// `color` just picks a tint; content is opaque so we can stuff either
// a zoning designation, a metric, or a density-bonus source into it.
function ZoningChip({
  children, color = "blue", title,
}: { children: React.ReactNode; color?: "blue" | "emerald" | "slate"; title?: string }) {
  const tint =
    color === "emerald"
      ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-200"
      : color === "slate"
      ? "bg-slate-500/10 border-slate-500/30 text-slate-200"
      : "bg-blue-500/10 border-blue-500/30 text-blue-200";
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] ${tint}`}
      title={title}
    >
      {children}
    </span>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────
export default function ProgrammingPage({ params }: { params: { id: string } }) {
  const [viewMode, setViewMode] = useViewMode();
  const isBasic = viewMode === "basic";
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [deal, setDeal] = useState<any>(null);

  // Data from UW JSONB
  const [buildingProgram, setBuildingProgram] = useState<BuildingProgram>(newBuildingProgram());
  const [otherIncomeItems, setOtherIncomeItems] = useState<OtherIncomeItem[]>([]);
  const [commercialTenants, setCommercialTenants] = useState<CommercialTenant[]>([]);
  const [zoningInputs, setZoningInputs] = useState<ZoningInputs>({ land_sf: 0, far: 0, lot_coverage_pct: 0, height_limit_ft: 0, height_limit_stories: 0 });
  const [densityBonuses, setDensityBonuses] = useState<Array<{ source: string; description: string; additional_density: string }>>([]);
  // Read-only zoning context surfaced as chips on this page so analysts
  // see the constraints driving the active massing without jumping back
  // to Site & Zoning. Purely display — edits still go to that page.
  const [zoningContext, setZoningContext] = useState<{
    zoning_designation: string;
    overlays: string[];
    height_limits: Array<{ label: string; value: string }>;
  }>({ zoning_designation: "", overlays: [], height_limits: [] });
  const [zoningOpen, setZoningOpen] = useState(false);
  const [unitGroups, setUnitGroups] = useState<any[]>([]);
  const [affordabilityConfig, setAffordabilityConfig] = useState<any>(null);
  const [taxesAnnual, setTaxesAnnual] = useState(0);
  // Site-plan massings drive everything on this page. Each massing
  // owns a list of buildings (drawn on Site & Zoning); Programming
  // surfaces them as nested tabs (massing → building) where each
  // (massing, building) pair has its own floor stack stored as a
  // MassingScenario row keyed by site_plan_scenario_id +
  // site_plan_building_id. Empty list = no drawn site plan; the page
  // falls back to the legacy single-scenario workflow.
  const [sitePlanMassings, setSitePlanMassings] = useState<
    Array<{
      id: string;
      name: string;
      is_base_case?: boolean;
      buildings: Array<{ id: string; label: string; area_sf: number }>;
    }>
  >([]);
  // Currently active (massing, building) selection drives which scenario
  // row we're editing. Both fall back to the first available when null.
  const [activeMassingId, setActiveMassingId] = useState<string | null>(null);
  const [activeBuildingId, setActiveBuildingId] = useState<string | null>(null);

  // Load data
  useEffect(() => {
    Promise.all([
      fetch(`/api/deals/${params.id}`).then(r => r.json()),
      fetch(`/api/underwriting?deal_id=${params.id}`).then(r => r.json()),
    ]).then(([dealRes, uwRes]) => {
      const d = dealRes.data;
      setDeal(d);
      const uw = uwRes.data?.data ? (typeof uwRes.data.data === "string" ? JSON.parse(uwRes.data.data) : uwRes.data.data) : {};

      // ── Build the site-plan massings list (Programming's source of truth)
      // The Site & Zoning page owns the canonical structure
      // (`scenarios: SitePlanScenario[]`, each with `buildings`).
      // We also handle two legacy shapes:
      //   - flat {parcel_points, buildings} → wrap as one Massing
      //   - earliest {building_points, building_area_sf} → wrap as one
      //     Massing with one Building.
      // Whatever we materialize is what drives the tab structure below.
      const rawPlan = uw.site_plan as any;
      const massings: Array<{
        id: string;
        name: string;
        is_base_case?: boolean;
        buildings: Array<{ id: string; label: string; area_sf: number }>;
      }> = [];
      if (rawPlan && Array.isArray(rawPlan.scenarios) && rawPlan.scenarios.length > 0) {
        for (const sp of rawPlan.scenarios) {
          massings.push({
            id: sp.id,
            name: sp.name || "Massing",
            is_base_case: !!sp.is_base_case,
            buildings: (Array.isArray(sp.buildings) ? sp.buildings : []).map((b: any) => ({
              id: b.id,
              label: b.label,
              area_sf: Math.round(Number(b.area_sf) || 0),
            })),
          });
        }
      } else if (rawPlan && Array.isArray(rawPlan.buildings) && rawPlan.buildings.length > 0) {
        massings.push({
          id: "legacy-massing-1",
          name: "Massing 1",
          buildings: rawPlan.buildings.map((b: any) => ({
            id: b.id,
            label: b.label,
            area_sf: Math.round(Number(b.area_sf) || 0),
          })),
        });
      } else if (
        rawPlan &&
        Array.isArray(rawPlan.building_points) &&
        rawPlan.building_points.length >= 3
      ) {
        massings.push({
          id: "legacy-massing-1",
          name: "Massing 1",
          buildings: [{
            id: "legacy-building-1",
            label: "Building 1",
            area_sf: Math.round(Number(rawPlan.building_area_sf) || 0),
          }],
        });
      }
      setSitePlanMassings(massings);

      // ── Sync building_program.scenarios with the site-plan structure
      // We want exactly one MassingScenario row per (massing, building)
      // pair. Existing rows are preserved (so floors/unit_mix/AI label
      // survive). New pairs get a fresh row. Orphan rows that no longer
      // map to a site-plan pair are kept too (analyst legacy work) but
      // hidden from the tab UI; if they want them back they can pin to
      // a different building.
      const prog =
        uw.building_program?.scenarios?.length > 0
          ? (uw.building_program as BuildingProgram)
          : newBuildingProgram();
      const existing = prog.scenarios;
      const synced: typeof existing = [];

      if (massings.length === 0) {
        // No site plan at all — keep whatever was saved as-is so the
        // legacy typed-footprint workflow keeps working.
        synced.push(...existing);
      } else {
        for (const m of massings) {
          if (m.buildings.length === 0) {
            // Massing with no buildings yet — emit one placeholder so
            // the tab still renders, footprint=0 until they draw one.
            const match = existing.find(
              (s) =>
                s.site_plan_scenario_id === m.id && !s.site_plan_building_id
            );
            if (match) {
              synced.push(match);
            } else {
              const fresh = newScenario(m.name);
              fresh.site_plan_scenario_id = m.id;
              fresh.site_plan_building_id = null;
              synced.push(fresh);
            }
            continue;
          }
          for (const b of m.buildings) {
            // Find an existing row that matches this exact pair, or
            // adopt a legacy row keyed only by building_id when this
            // massing is the legacy-migrated one.
            let match = existing.find(
              (s) =>
                s.site_plan_scenario_id === m.id && s.site_plan_building_id === b.id
            );
            if (!match) {
              match = existing.find(
                (s) =>
                  !s.site_plan_scenario_id && s.site_plan_building_id === b.id
              );
            }
            if (match) {
              // Guard against legacy scenarios missing fields the rest
              // of Programming assumes. Without these defaults, the
              // render path (computeMassingSummary / floor editor) can
              // crash on old data — shows as "Application error" in
              // prod. Normalize to newScenario-shaped defaults.
              synced.push({
                ...newScenario(b.label),
                ...match,
                site_plan_scenario_id: m.id,
                site_plan_building_id: b.id,
                footprint_sf: b.area_sf, // always re-sync from the drawn area
                floors: Array.isArray(match.floors) ? match.floors : [],
                unit_mix: Array.isArray(match.unit_mix) ? match.unit_mix : [],
              });
            } else {
              const fresh = newScenario(b.label);
              fresh.site_plan_scenario_id = m.id;
              fresh.site_plan_building_id = b.id;
              fresh.footprint_sf = b.area_sf;
              synced.push(fresh);
            }
          }
        }
      }

      // Normalize any legacy rows that skipped the reconcile loop (no
      // site plan, single-scenario holdovers) so computeMassingSummary
      // and the floor editor never see undefined arrays.
      for (let i = 0; i < synced.length; i++) {
        const s = synced[i];
        if (!Array.isArray(s.floors) || !Array.isArray(s.unit_mix)) {
          synced[i] = {
            ...newScenario(s.name || "Massing"),
            ...s,
            floors: Array.isArray(s.floors) ? s.floors : [],
            unit_mix: Array.isArray(s.unit_mix) ? s.unit_mix : [],
          };
        }
      }

      // Pick a sensible active selection: prefer what was previously
      // active if it still exists, else the first massing/building.
      const firstMassing = massings[0];
      const initialMassingId = firstMassing?.id || null;
      const initialBuildingId = firstMassing?.buildings[0]?.id || null;
      setActiveMassingId(initialMassingId);
      setActiveBuildingId(initialBuildingId);

      // Active scenario = the row matching the active (massing, building).
      const activeScenarioRow =
        synced.find(
          (s) =>
            s.site_plan_scenario_id === initialMassingId &&
            s.site_plan_building_id === initialBuildingId
        ) ||
        synced.find((s) => s.site_plan_scenario_id === initialMassingId) ||
        synced[0];

      setBuildingProgram({
        ...prog,
        scenarios: synced,
        active_scenario_id: activeScenarioRow?.id || prog.active_scenario_id,
      });
      if (uw.other_income_items?.length > 0) setOtherIncomeItems(uw.other_income_items);
      if (uw.commercial_tenants?.length > 0) setCommercialTenants(uw.commercial_tenants);
      if (uw.unit_groups?.length > 0) setUnitGroups(uw.unit_groups);
      if (uw.affordability_config) setAffordabilityConfig(uw.affordability_config);
      if (uw.taxes_annual) setTaxesAnnual(uw.taxes_annual);

      // Build zoning inputs from UW data
      const si = uw.site_info || {};
      const landSF = si.land_sf || (d?.land_acres || 0) * 43560;
      let heightFt = 0;
      const hl = uw.zoning_info?.height_limits || [];
      for (const h of hl) {
        // New structured shape — prefer feet, fall back to stories × 10.
        if (typeof h.feet === "number" && h.feet > 0) { heightFt = h.feet; break; }
        if (typeof h.stories === "number" && h.stories > 0) { heightFt = h.stories * 10; break; }
        // Legacy shape — regex-parse the free-text value string.
        const match = (h.value || "").match(/(\d+)\s*(ft|feet|')/i);
        if (match) { heightFt = parseInt(match[1]); break; }
      }
      if (!heightFt && uw.height_limit_stories > 0) heightFt = uw.height_limit_stories * 10;

      setZoningInputs({
        land_sf: landSF,
        far: uw.far || uw.dev_params?.far || 0,
        lot_coverage_pct: uw.lot_coverage_pct || uw.dev_params?.lot_coverage_pct || 0,
        height_limit_ft: heightFt,
        height_limit_stories: uw.height_limit_stories || uw.dev_params?.height_limit_stories || 0,
      });
      // Only feed Programming the bonuses the analyst has left enabled on
      // Site & Zoning. A disabled bonus means "considered, not applied" and
      // shouldn't flow into the affordability planner / tax exemption UI.
      setDensityBonuses(
        (uw.zoning_info?.density_bonuses || []).filter(
          (b: any) => b?.enabled !== false
        )
      );
      setZoningContext({
        zoning_designation: uw.zoning_info?.zoning_designation || "",
        overlays: Array.isArray(uw.zoning_info?.overlays) ? uw.zoning_info.overlays : [],
        height_limits: Array.isArray(uw.zoning_info?.height_limits) ? uw.zoning_info.height_limits : [],
      });
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [params.id]);

  // Save
  const saveAll = useCallback(async () => {
    setSaving(true);
    try {
      const uwRes = await fetch(`/api/underwriting?deal_id=${params.id}`);
      const uwJson = await uwRes.json();
      const current = uwJson.data?.data ? (typeof uwJson.data.data === "string" ? JSON.parse(uwJson.data.data) : uwJson.data.data) : {};

      // Split unit groups by affordability tiers if configured. The shared
      // helper honours each tier's per-BR breakdown directly (see
      // src/lib/affordability-split.ts).
      const nextUnitGroups = splitUnitGroupsByAffordability(
        current.unit_groups || [],
        affordabilityConfig
      );

      // Pro-rata tax exemption: (affordable_units / total_units) × taxes × exemption_pct
      let adjustedTaxes = current.taxes_annual;
      if (
        affordabilityConfig?.tax_exemption_enabled &&
        affordabilityConfig.tax_exemption_pct > 0 &&
        current.taxes_annual > 0
      ) {
        const totalUnits = nextUnitGroups.reduce((s: number, g: any) => s + (g.unit_count || 0), 0);
        const affordableUnits = nextUnitGroups.reduce(
          (s: number, g: any) => s + (g.is_affordable ? (g.unit_count || 0) : 0),
          0
        );
        if (totalUnits > 0) {
          const reductionFraction = (affordableUnits / totalUnits) * (affordabilityConfig.tax_exemption_pct / 100);
          adjustedTaxes = Math.round(current.taxes_annual * (1 - reductionFraction));
        }
      }

      const merged = {
        ...current,
        building_program: buildingProgram,
        other_income_items: otherIncomeItems,
        commercial_tenants: commercialTenants,
        affordability_config: affordabilityConfig,
        unit_groups: nextUnitGroups,
        ...(adjustedTaxes !== current.taxes_annual ? { taxes_annual: adjustedTaxes } : {}),
      };

      await fetch("/api/underwriting", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deal_id: params.id, data: merged }),
      });
      setDirty(false);
      toast.success("Programming saved");
    } catch {
      toast.error("Failed to save");
    } finally {
      setSaving(false);
    }
  }, [params.id, buildingProgram, otherIncomeItems, commercialTenants, affordabilityConfig]);

  // Auto-save
  useEffect(() => {
    if (loading || !dirty) return;
    const t = setTimeout(saveAll, 3000);
    return () => clearTimeout(t);
  }, [dirty, loading, saveAll]);

  // Push to Underwriting
  const pushToUW = useCallback(async (scenario: any) => {
    const summary = computeMassingSummary(scenario, zoningInputs);
    try {
      const uwRes = await fetch(`/api/underwriting?deal_id=${params.id}`);
      const uwJson = await uwRes.json();
      const current = uwJson.data?.data ? (typeof uwJson.data.data === "string" ? JSON.parse(uwJson.data.data) : uwJson.data.data) : {};

      const mix = scenario.unit_mix || [];
      const resNRSF = summary.nrsf_by_use.residential || 0;
      const wavg = mix.length > 0 ? mix.reduce((s: number, m: any) => s + m.avg_sf * (m.allocation_pct / 100), 0) : 0;
      const totalU = wavg > 0 ? Math.floor(resNRSF / wavg) : summary.total_units;
      // Multi-building push semantics:
      //   • If this scenario is linked to a site-plan building, we tag each
      //     new unit group with that building_id and KEEP any existing
      //     unit groups that belong to other buildings. This lets analysts
      //     push Building 1 and Building 2 independently without wiping
      //     each other's rows.
      //   • If the scenario is unlinked (classic as-of-right vs bonus
      //     alternative flow), we replace the whole unit_groups list —
      //     same behaviour as before.
      const buildingId = scenario.site_plan_building_id || null;
      // Look the building label up across every massing — pushToUW is
      // called from massing-iteration in "Push <Massing> to UW" and
      // from the per-stack hydrate path, so we can't assume it's the
      // currently active massing.
      const buildingLabel = (() => {
        if (!buildingId) return "";
        for (const m of sitePlanMassings) {
          const b = m.buildings.find((x) => x.id === buildingId);
          if (b) return b.label;
        }
        return "";
      })();
      const generated = mix.length > 0
        ? mix.map((m: any) => ({
            id: uuidv4(),
            label: buildingLabel ? `${buildingLabel} · ${m.type_label}` : m.type_label,
            unit_count: Math.round(totalU * (m.allocation_pct / 100)),
            renovation_count: 0, renovation_cost_per_unit: 0,
            unit_change: "none", unit_change_count: 0,
            bedrooms: m.type_label.includes("Studio") ? 0 : m.type_label.includes("3") ? 3 : m.type_label.includes("2") ? 2 : 1,
            bathrooms: m.type_label.includes("3") ? 2 : 1, sf_per_unit: m.avg_sf,
            current_rent_per_sf: 0, market_rent_per_sf: 0, lease_type: "NNN", expense_reimbursement_per_sf: 0,
            current_rent_per_unit: 0, market_rent_per_unit: 0,
            beds_per_unit: 1, current_rent_per_bed: 0, market_rent_per_bed: 0,
            ...(buildingId ? { site_plan_building_id: buildingId } : {}),
          }))
        : [];
      const newUnitGroups = (() => {
        if (buildingId) {
          const others = (current.unit_groups || []).filter(
            (g: any) => g.site_plan_building_id !== buildingId
          );
          // Generated empty (no mix) → keep existing rows for this building.
          if (generated.length === 0) return current.unit_groups || [];
          return [...others, ...generated];
        }
        return generated.length > 0 ? generated : current.unit_groups || [];
      })();

      // Detect mixed-use
      const useTypes: string[] = Array.from(new Set(scenario.floors.filter((f: any) => f.use_type !== "mechanical" && f.use_type !== "parking").map((f: any) => f.use_type as string)));
      const isMixed = useTypes.length > 1;
      const mixedUseConfig = isMixed ? {
        enabled: true, total_gfa: summary.total_gsf, common_area_sf: 0,
        components: useTypes.map((t: string) => ({
          id: uuidv4(), component_type: t === "lobby_amenity" ? "other" : t,
          label: t === "residential" ? "Residential" : t === "retail" ? "Retail" : t === "office" ? "Office" : t,
          sf_allocation: summary.gsf_by_use[t as keyof typeof summary.gsf_by_use] || 0,
          unit_groups: [], opex_mode: "shared", opex_allocation_pct: t === "residential" ? 70 : 30,
          cap_rate: t === "residential" ? 5.0 : 6.5, ti_allowance_per_sf: 0,
          leasing_commission_pct: t === "retail" ? 6 : 0, free_rent_months: 0, rent_escalation_pct: 3,
        })),
      } : current.mixed_use || null;

      const parkingSpaces = summary.total_parking_spaces_est;

      // Compute other income totals for UW
      const totalOtherIncomeMonthly = otherIncomeItems.reduce((s, item) => {
        if (item.basis === "per_unit") return s + item.amount * totalU;
        if (item.basis === "per_space") return s + item.amount * (item.label.toLowerCase().includes("reserved") ? parkingSpaces : 0);
        return s + item.amount;
      }, 0);

      const merged = {
        ...current,
        development_mode: true,
        max_gsf: summary.total_gsf, max_nrsf: summary.total_nrsf,
        efficiency_pct: summary.total_gsf > 0 ? Math.round((summary.total_nrsf / summary.total_gsf) * 100) : 80,
        unit_groups: newUnitGroups,
        mixed_use: mixedUseConfig,
        building_program: buildingProgram,
        other_income_items: otherIncomeItems,
        commercial_tenants: commercialTenants,
        // Parking — auto-split 70% reserved / 30% unreserved with default rates
        parking_reserved_spaces: Math.round(parkingSpaces * 0.7),
        parking_reserved_rate: current.parking_reserved_rate || 200,
        parking_unreserved_spaces: Math.round(parkingSpaces * 0.3),
        parking_unreserved_rate: current.parking_unreserved_rate || 100,
        // Legacy fields for backward compat
        rubs_per_unit_monthly: otherIncomeItems.find(i => i.label.toLowerCase().includes("rubs"))?.amount || 0,
        parking_monthly: 0,
        laundry_monthly: otherIncomeItems.find(i => i.label.toLowerCase().includes("laundry"))?.amount || 0,
      };

      await fetch("/api/underwriting", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deal_id: params.id, data: merged }),
      });
      toast.success(`Pushed to UW: ${fn(summary.total_gsf)} GSF, ${totalU} units, ${parkingSpaces} parking`);

      // Auto-trigger AI OpEx estimate if opex fields are empty
      const hasOpex = current.taxes_annual > 0 || current.insurance_annual > 0;
      if (!hasOpex) {
        toast.info("Running AI OpEx estimate...");
        fetch(`/api/deals/${params.id}/opex-estimate`, { method: "POST" })
          .then(r => r.json())
          .then(json => {
            if (json.data) {
              const est = json.data;
              // Merge opex into UW
              fetch(`/api/underwriting?deal_id=${params.id}`).then(r => r.json()).then(uwj => {
                const cur = uwj.data?.data ? (typeof uwj.data.data === "string" ? JSON.parse(uwj.data.data) : uwj.data.data) : {};
                const opexMerged = { ...cur,
                  vacancy_rate: est.vacancy_rate ?? cur.vacancy_rate,
                  management_fee_pct: est.management_fee_pct ?? cur.management_fee_pct,
                  taxes_annual: est.taxes_annual ?? cur.taxes_annual,
                  insurance_annual: est.insurance_annual ?? cur.insurance_annual,
                  repairs_annual: est.repairs_annual ?? cur.repairs_annual,
                  utilities_annual: est.utilities_annual ?? cur.utilities_annual,
                  ga_annual: est.ga_annual ?? cur.ga_annual,
                  marketing_annual: est.marketing_annual ?? cur.marketing_annual,
                  reserves_annual: est.reserves_annual ?? cur.reserves_annual,
                  opex_narrative: est.basis || "",
                };
                fetch("/api/underwriting", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deal_id: params.id, data: opexMerged }) });
                toast.success("AI OpEx estimate applied to underwriting");
              });
            }
          }).catch(() => {});

        // Auto-trigger AI loan sizing
        fetch(`/api/deals/${params.id}/loan-size`, { method: "POST" })
          .then(r => r.json())
          .then(json => {
            if (json.data) {
              const est = json.data;
              fetch(`/api/underwriting?deal_id=${params.id}`).then(r => r.json()).then(uwj => {
                const cur = uwj.data?.data ? (typeof uwj.data.data === "string" ? JSON.parse(uwj.data.data) : uwj.data.data) : {};
                const loanMerged = { ...cur,
                  has_financing: true,
                  acq_ltc: est.acq_ltc ?? cur.acq_ltc,
                  acq_interest_rate: est.acq_interest_rate ?? cur.acq_interest_rate,
                  acq_amort_years: est.acq_amort_years ?? cur.acq_amort_years,
                  acq_io_years: est.acq_io_years ?? cur.acq_io_years,
                  loan_narrative: est.narrative || "",
                };
                fetch("/api/underwriting", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deal_id: params.id, data: loanMerged }) });
                toast.success("AI loan sizing applied to underwriting");
              });
            }
          }).catch(() => {});
      }
    } catch {
      toast.error("Failed to push to underwriting");
    }
  }, [params.id, zoningInputs, buildingProgram, otherIncomeItems, commercialTenants, sitePlanMassings]);

  // Snapshot the current programming state as a named UW Scenario.
  // Called automatically by "Push <Massing> to UW" so each massing push
  // becomes a comparable saved scenario in Underwriting. The snapshot
  // captures whatever is in the underwriting blob right NOW (after the
  // pushes have committed building_program + unit_groups), so the saved
  // scenario reflects the freshly-pushed numbers.
  // Toggle the "base case" star on a massing. Writes to
  // underwriting.data.site_plan.scenarios[*].is_base_case so the flag
  // is shared with Site & Zoning. Only one massing can be base case
  // at a time; the setter clears it on siblings.
  const toggleMassingBaseCase = useCallback(async (massingId: string) => {
    try {
      const uwRes = await fetch(`/api/underwriting?deal_id=${params.id}`);
      const uwJson = await uwRes.json();
      const current = uwJson.data?.data
        ? (typeof uwJson.data.data === "string" ? JSON.parse(uwJson.data.data) : uwJson.data.data)
        : {};
      const sp = current.site_plan || {};
      const scenarios = Array.isArray(sp.scenarios) ? sp.scenarios : [];
      const wasBase = scenarios.find((s: any) => s.id === massingId)?.is_base_case === true;
      const nextScenarios = scenarios.map((s: any) => ({
        ...s,
        is_base_case: s.id === massingId ? !wasBase : false,
      }));
      await fetch("/api/underwriting", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deal_id: params.id,
          data: {
            ...current,
            site_plan: { ...sp, scenarios: nextScenarios, updated_at: new Date().toISOString() },
          },
        }),
      });
      // Update local state so the UI reflects the toggle immediately.
      setSitePlanMassings((prev) =>
        prev.map((m) => ({ ...m, is_base_case: m.id === massingId ? !wasBase : false }))
      );
      toast.success(
        !wasBase
          ? `Marked "${scenarios.find((s: any) => s.id === massingId)?.name}" as base case`
          : "Cleared base case"
      );
    } catch {
      toast.error("Failed to update base case");
    }
  }, [params.id]);

  const snapshotMassingToUw = useCallback(async (massingName: string) => {
    try {
      const uwRes = await fetch(`/api/underwriting?deal_id=${params.id}`);
      const uwJson = await uwRes.json();
      const current = uwJson.data?.data
        ? (typeof uwJson.data.data === "string" ? JSON.parse(uwJson.data.data) : uwJson.data.data)
        : {};
      // Sum a quick summary across the linked stacks of this massing
      // for the saved-scenarios list display on Underwriting.
      const linkedScenarios = (current.building_program?.scenarios || []).filter(
        (s: any) => s.site_plan_scenario_id === activeMassingId
      );
      const summarized = linkedScenarios.reduce(
        (acc: any, s: any) => {
          const gsf = (s.floors || []).reduce((x: number, f: any) => x + (f.floor_plate_sf || 0), 0);
          const nrsf = (s.floors || []).reduce(
            (x: number, f: any) => x + Math.round((f.floor_plate_sf || 0) * ((f.efficiency_pct || 0) / 100)),
            0
          );
          const units = (s.floors || []).reduce((x: number, f: any) => x + (f.units_on_floor || 0), 0);
          const parkingSf = (s.floors || []).reduce(
            (x: number, f: any) => x + (f.use_type === "parking" ? f.floor_plate_sf : 0),
            0
          );
          return {
            total_gsf: (acc.total_gsf || 0) + gsf,
            total_nrsf: (acc.total_nrsf || 0) + nrsf,
            total_units: (acc.total_units || 0) + units,
            total_parking_spaces_est:
              (acc.total_parking_spaces_est || 0) +
              Math.floor(parkingSf / (s.parking_sf_per_space || 350)),
            buildings_count: (acc.buildings_count || 0) + 1,
          };
        },
        {}
      );
      // De-dupe by name: replace an existing scenario with the same
      // massing name so re-pushing doesn't pile up duplicates.
      const existing = Array.isArray(current.uw_scenarios) ? current.uw_scenarios : [];
      const nameClash = existing.findIndex((x: any) => x.name === massingName);
      const snapshot = {
        id:
          (typeof crypto !== "undefined" && typeof (crypto as any).randomUUID === "function"
            ? (crypto as any).randomUUID()
            : `uws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
        name: massingName,
        created_at: new Date().toISOString(),
        site_plan_scenario_id: activeMassingId,
        building_program: current.building_program || null,
        unit_groups: current.unit_groups || [],
        other_income_items: current.other_income_items || [],
        commercial_tenants: current.commercial_tenants || [],
        summary: summarized,
      };
      const next = nameClash >= 0
        ? existing.map((x: any, i: number) => (i === nameClash ? snapshot : x))
        : [...existing, snapshot];
      await fetch("/api/underwriting", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deal_id: params.id,
          data: { ...current, uw_scenarios: next },
        }),
      });
      toast.success(
        nameClash >= 0
          ? `Updated UW scenario "${massingName}"`
          : `Saved as UW scenario "${massingName}"`
      );
    } catch {
      toast.error("Failed to snapshot massing as UW scenario");
    }
  }, [params.id, activeMassingId]);

  if (loading) return <div className="flex items-center justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  // Compute summary for active scenario
  // ── Active selection (massing + building) → scenario row
  // The Programming page is a 2D grid: massings on one axis, buildings
  // on the other. Each cell is a MassingScenario row keyed by
  // (site_plan_scenario_id, site_plan_building_id). The selection is
  // managed at the page level — MassingSection just edits the row.
  const currentMassing =
    sitePlanMassings.find((m) => m.id === activeMassingId) || sitePlanMassings[0] || null;
  const currentBuilding =
    currentMassing?.buildings.find((b) => b.id === activeBuildingId) ||
    currentMassing?.buildings[0] ||
    null;

  const activeScenario =
    (currentMassing
      ? buildingProgram.scenarios.find(
          (s) =>
            s.site_plan_scenario_id === currentMassing.id &&
            s.site_plan_building_id === (currentBuilding?.id ?? null)
        )
      : null) ||
    buildingProgram.scenarios.find((s) => s.id === buildingProgram.active_scenario_id) ||
    buildingProgram.scenarios[0];

  const summary = activeScenario ? computeMassingSummary(activeScenario, zoningInputs) : null;

  // ── Massing totals — sums the floor stacks of every building in the
  // current massing. This is what the analyst sees in the GSF box at
  // the top: the whole massing's numbers, not just the visible building.
  const massingScenarios = currentMassing
    ? buildingProgram.scenarios.filter((s) => s.site_plan_scenario_id === currentMassing.id)
    : [];
  const massingTotals = massingScenarios.length > 0
    ? massingScenarios.reduce(
        (acc, s) => {
          const sm = computeMassingSummary(s, zoningInputs);
          return {
            total_gsf: acc.total_gsf + sm.total_gsf,
            total_nrsf: acc.total_nrsf + sm.total_nrsf,
            total_units: acc.total_units + sm.total_units,
            total_parking_spaces_est: acc.total_parking_spaces_est + sm.total_parking_spaces_est,
            max_height_ft: Math.max(acc.max_height_ft, sm.total_height_ft),
            buildings_count: acc.buildings_count + 1,
          };
        },
        { total_gsf: 0, total_nrsf: 0, total_units: 0, total_parking_spaces_est: 0, max_height_ft: 0, buildings_count: 0 }
      )
    : null;

  const totalUnits = unitGroups.reduce((s: number, g: any) => s + (g.unit_count || 0), 0) || summary?.total_units || 0;
  const hasMultipleBuildings = (currentMassing?.buildings.length || 0) > 1;
  const hasMultipleMassings = sitePlanMassings.length > 1;

  // The load effect already keeps buildingProgram.active_scenario_id
  // in sync with the active massing/building pair. A previous
  // follow-up useEffect here caused React error #310 ("Rendered more
  // hooks than during the previous render") because it was declared
  // after an `if (loading) return` early-return — the Rules of Hooks
  // forbid that. Removed; no runtime regression because tab clicks
  // set active_scenario_id directly.

  // Commercial tenant totals
  const commercialGPR = commercialTenants.reduce((s, t) => s + t.sf * t.rent_per_sf, 0);
  const commercialSF = commercialTenants.reduce((s, t) => s + t.sf, 0);

  // Other income totals
  const otherIncomeAnnual = otherIncomeItems.reduce((s, item) => {
    if (item.basis === "per_unit") return s + item.amount * totalUnits * 12;
    if (item.basis === "per_space") return s + item.amount * 12 * (summary?.total_parking_spaces_est || 0);
    return s + item.amount * 12; // per_property is monthly
  }, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Programming</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Define what you&apos;re building — massing, unit mix, commercial tenants, and income sources. Push to underwriting when ready.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ViewModeToggle mode={viewMode} onChange={setViewMode} />
          <Button variant="outline" size="sm" onClick={saveAll} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}Save
          </Button>
          {currentMassing && massingScenarios.length > 0 && (
            <Button
              size="sm"
              onClick={async () => {
                if (massingScenarios.length > 1) {
                  toast.info(`Pushing ${currentMassing.name} (${massingScenarios.length} buildings)…`);
                }
                for (const s of massingScenarios) {
                  await pushToUW(s);
                }
                // After the buildings are pushed, snapshot the whole
                // massing as a named UW Scenario so it shows in the
                // Underwriting "Saved Scenarios" panel.
                await snapshotMassingToUw(currentMassing.name);
              }}
              className="bg-primary hover:bg-primary/90"
              title={`Push the ${currentMassing.name} massing (all ${massingScenarios.length} building${massingScenarios.length === 1 ? "" : "s"}) to Underwriting and save it as a UW Scenario named "${currentMassing.name}"`}
            >
              <ArrowRight className="h-4 w-4 mr-2" /> Push {currentMassing.name} to UW
            </Button>
          )}
        </div>
      </div>

      {/* Massing tabs — driven 1:1 by site_plan.scenarios. To rename,
          add or delete a Massing the analyst goes back to Site & Zoning;
          this page is read-only on the structure (it just edits the
          floor stacks within each cell). */}
      {hasMultipleMassings && (
        <div className="flex items-center gap-1 flex-wrap border-b border-border/40 pb-2">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground mr-2">
            Massing
          </span>
          {sitePlanMassings.map((m) => {
            const isActive = currentMassing?.id === m.id;
            const isBase = !!m.is_base_case;
            return (
              // Wrapping div so the tab can host two clickable children
              // (select + star). Nested buttons aren't valid HTML.
              <div
                key={m.id}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border transition-colors ${
                  isActive
                    ? "bg-amber-500/15 border-amber-500/40 text-amber-200"
                    : "bg-muted/20 border-border/40 text-muted-foreground hover:border-border/60 hover:text-foreground"
                }`}
                title="Site-plan massing"
              >
                {/* Star = base-case toggle. Shared with Site Plan; writes
                    to underwriting.data.site_plan.scenarios[*].is_base_case. */}
                <button
                  type="button"
                  onClick={() => toggleMassingBaseCase(m.id)}
                  title={isBase ? "Base case — click to un-star" : "Mark as base case"}
                  className={`${isBase ? "text-amber-300" : "text-muted-foreground/40 hover:text-amber-300"}`}
                >
                  <Star className={`h-3 w-3 ${isBase ? "fill-amber-300" : ""}`} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveMassingId(m.id);
                    // When switching massings, jump to its first building
                    const nextBuildingId = m.buildings[0]?.id || null;
                    setActiveBuildingId(nextBuildingId);
                    // Also sync buildingProgram.active_scenario_id so
                    // MassingSection (which reads from the program) picks
                    // up the right floor stack. Doing this in the click
                    // handler avoids a hook-ordering trap we hit earlier
                    // (useEffect declared after `if (loading) return`
                    // triggered React error #310).
                    const nextScenario = buildingProgram.scenarios.find(
                      (s) =>
                        s.site_plan_scenario_id === m.id &&
                        s.site_plan_building_id === nextBuildingId
                    );
                    if (nextScenario && nextScenario.id !== buildingProgram.active_scenario_id) {
                      setBuildingProgram((p) => ({ ...p, active_scenario_id: nextScenario.id }));
                    }
                  }}
                  className="flex items-center gap-1.5"
                >
                  <Layers className="h-3 w-3" />
                  <span className="font-medium">{m.name}</span>
                  <span className="text-[10px] text-muted-foreground/80">
                    {m.buildings.length} {m.buildings.length === 1 ? "building" : "buildings"}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Building tabs (within the active Massing) — driven by
          currentMassing.buildings. Each tab edits its own floor stack +
          unit mix. Add/delete/rename happens on Site & Zoning. */}
      {hasMultipleBuildings && currentMassing && (
        <div className="flex items-center gap-1 flex-wrap border-b border-border/40 pb-2">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground mr-2">
            Building
          </span>
          {currentMassing.buildings.map((b) => {
            const isActive = currentBuilding?.id === b.id;
            return (
              <button
                key={b.id}
                onClick={() => {
                  setActiveBuildingId(b.id);
                  // Sync active_scenario_id so MassingSection picks up
                  // the right floor stack — same reasoning as the
                  // massing tab handler above.
                  if (!currentMassing) return;
                  const nextScenario = buildingProgram.scenarios.find(
                    (s) =>
                      s.site_plan_scenario_id === currentMassing.id &&
                      s.site_plan_building_id === b.id
                  );
                  if (nextScenario && nextScenario.id !== buildingProgram.active_scenario_id) {
                    setBuildingProgram((p) => ({ ...p, active_scenario_id: nextScenario.id }));
                  }
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border transition-colors ${
                  isActive
                    ? "bg-blue-500/15 border-blue-500/40 text-blue-200"
                    : "bg-muted/20 border-border/40 text-muted-foreground hover:border-border/60 hover:text-foreground"
                }`}
              >
                <Building2 className="h-3 w-3" />
                <span className="font-medium">{b.label}</span>
                <span className="text-[10px] text-muted-foreground/80">
                  {b.area_sf.toLocaleString()} SF
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Collapsed by default. Zoning and bonus constraints drive the
          massing but the analyst rarely references them while editing
          unit mix / rents. A one-line summary stays visible so they
          know the context exists; click to expand for full chips. */}
      {(zoningContext.zoning_designation ||
        zoningContext.overlays.length > 0 ||
        zoningContext.height_limits.length > 0 ||
        zoningInputs.far > 0 ||
        zoningInputs.lot_coverage_pct > 0 ||
        densityBonuses.length > 0) && (
        <div className="border border-border/40 rounded-md bg-muted/5">
          <button
            onClick={() => setZoningOpen((o) => !o)}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-muted/15 transition-colors"
          >
            {zoningOpen ? (
              <ChevronDown className="h-3 w-3 text-muted-foreground/60 shrink-0" />
            ) : (
              <ChevronRight className="h-3 w-3 text-muted-foreground/60 shrink-0" />
            )}
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Zoning constraints
            </span>
            {!zoningOpen && (
              <span className="text-[11px] text-muted-foreground/80 truncate">
                {[
                  zoningContext.zoning_designation,
                  zoningInputs.far > 0 ? `FAR ${zoningInputs.far}` : null,
                  zoningInputs.lot_coverage_pct > 0 ? `Cov ≤ ${zoningInputs.lot_coverage_pct}%` : null,
                  densityBonuses.length > 0
                    ? `${densityBonuses.length} bonus${densityBonuses.length > 1 ? "es" : ""}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            )}
          </button>
          {zoningOpen && (
            <div className="flex items-center gap-1.5 flex-wrap text-[11px] px-3 pb-2 pt-1 border-t border-border/40">
              {zoningContext.zoning_designation && (
                <ZoningChip color="blue">{zoningContext.zoning_designation}</ZoningChip>
              )}
              {zoningInputs.far > 0 && (
                <ZoningChip color="blue">FAR {zoningInputs.far}</ZoningChip>
              )}
              {zoningInputs.lot_coverage_pct > 0 && (
                <ZoningChip color="blue">Coverage ≤ {zoningInputs.lot_coverage_pct}%</ZoningChip>
              )}
              {zoningContext.height_limits
                .filter((h) => typeof h?.value === "string" && h.value.trim() !== "")
                .slice(0, 2)
                .map((h, i) => (
                  <ZoningChip key={`hl-${i}`} color="blue" title={typeof h.label === "string" ? h.label : undefined}>
                    {String(h.value)}
                  </ZoningChip>
                ))}
              {zoningContext.overlays
                .filter((o) => typeof o === "string" && o.trim() !== "")
                .slice(0, 3)
                .map((o, i) => (
                  <ZoningChip key={`ov-${i}`} color="slate">{String(o)}</ZoningChip>
                ))}
              {densityBonuses.length > 0 && (
                <>
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground mx-1">
                    Bonuses
                  </span>
                  {densityBonuses.map((b, i) => (
                    <ZoningChip
                      key={`db-${i}`}
                      color="emerald"
                      title={typeof b?.description === "string" ? b.description : undefined}
                    >
                      {String(b?.source || "")}
                      {typeof b?.additional_density === "string" && b.additional_density
                        ? ` · ${b.additional_density}`
                        : ""}
                    </ZoningChip>
                  ))}
                </>
              )}
              <a
                href={`/deals/${params.id}/site-zoning`}
                className="ml-auto text-[10px] text-muted-foreground hover:text-foreground underline decoration-dotted"
              >
                Edit on Site &amp; Zoning →
              </a>
            </div>
          )}
        </div>
      )}

      {/* Summary Bar — when in multi-building mode, the headline numbers
          show the WHOLE active massing (all buildings summed). The
          per-building MassingSection below shows the single-stack
          numbers for whichever building tab is active. */}
      {(massingTotals || summary) && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {(() => {
            const t = massingTotals || (summary ? {
              total_gsf: summary.total_gsf,
              total_nrsf: summary.total_nrsf,
              total_units: summary.total_units,
              total_parking_spaces_est: summary.total_parking_spaces_est,
              max_height_ft: summary.total_height_ft,
              buildings_count: 1,
            } : null);
            if (!t) return null;
            const heightLabel = (massingTotals?.buildings_count || 1) > 1 ? "Max Height" : "Height";
            return (
              <>
                <div className="border rounded-lg p-3 bg-card">
                  <p className="text-[10px] text-muted-foreground uppercase">
                    Total GSF{currentMassing ? ` · ${currentMassing.name}` : ""}
                  </p>
                  <p className="text-lg font-bold tabular-nums">{fn(t.total_gsf)}</p>
                  {(massingTotals?.buildings_count || 0) > 1 && (
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {massingTotals!.buildings_count} buildings
                    </p>
                  )}
                </div>
                <div className="border rounded-lg p-3 bg-card">
                  <p className="text-[10px] text-muted-foreground uppercase">Total NRSF</p>
                  <p className="text-lg font-bold tabular-nums">{fn(t.total_nrsf)}</p>
                </div>
                <div className="border rounded-lg p-3 bg-card">
                  <p className="text-[10px] text-muted-foreground uppercase">Res. Units</p>
                  <p className="text-lg font-bold tabular-nums">{fn(t.total_units)}</p>
                </div>
                <div className="border rounded-lg p-3 bg-card">
                  <p className="text-[10px] text-muted-foreground uppercase">Parking</p>
                  <p className="text-lg font-bold tabular-nums">{fn(t.total_parking_spaces_est)}</p>
                </div>
                <div className="border rounded-lg p-3 bg-card">
                  <p className="text-[10px] text-muted-foreground uppercase">{heightLabel}</p>
                  <p className="text-lg font-bold tabular-nums">{Math.round(t.max_height_ft).toLocaleString()} ft</p>
                </div>
              </>
            );
          })()}
        </div>
      )}

      {/* ═══════════════════ BUILDING MASSING ═══════════════════ */}
      <Section
        title={(() => {
          // When multi-building, scope the section to the active building
          // so the analyst has a clear anchor as they switch tabs.
          if (!hasMultipleBuildings) return "Building Massing";
          return currentBuilding
            ? `Building Massing — ${currentBuilding.label}`
            : "Building Massing";
        })()}
        icon={<Layers className="h-4 w-4 text-blue-400" />}
      >
        <MassingSection
          program={buildingProgram}
          onChange={p => { setBuildingProgram(p); setDirty(true); }}
          zoning={zoningInputs}
          densityBonuses={densityBonuses}
          footprintReadOnly={!!currentBuilding}
          activeBuildingLabel={currentBuilding?.label ?? null}
        />
      </Section>

      {/* ═══════════════════ AFFORDABILITY ═══════════════════
          Hidden in Basic mode — analysts running back-of-envelope
          numbers don't need the per-tier affordable mix planner.
          Their affordability_config persists in state and re-appears
          when they switch back to Advanced. */}
      {!isBasic && (
      <AffordabilityPlanner
        dealId={params.id}
        totalUnits={(() => {
          // Affordability is set per Massing — totalUnits is the sum of
          // all building stacks in the active massing (so a 3-building
          // project's affordable target is computed against the whole
          // massing, not just the visible tab). Falls back to UW unit
          // groups when there's no massing data yet.
          if (massingTotals && massingTotals.total_units > 0) return massingTotals.total_units;
          if (summary?.total_units) return summary.total_units;
          return unitGroups.reduce((s: number, g: any) => s + (g.unit_count || 0), 0) || 100;
        })()}
        avgMarketRent={(() => {
          if (unitGroups.length === 0) return 0;
          const totalUnits = unitGroups.reduce((s: number, g: any) => s + (g.unit_count || 0), 0);
          if (totalUnits === 0) return 0;
          const totalRent = unitGroups.reduce((s: number, g: any) => s + (g.unit_count || 0) * (g.market_rent_per_unit || 0), 0);
          return totalRent / totalUnits;
        })()}
        currentTaxes={taxesAnnual}
        initialConfig={affordabilityConfig}
        buildingUnitMix={(() => {
          // Bucket the UW unit_groups into BR buckets — same logic as
          // underwriting/page.tsx. Exclude affordable rows so we're
          // reasoning about the market-rate template, not a post-split
          // mix.
          const mix = { studio: 0, one_br: 0, two_br: 0, three_br: 0, four_br_plus: 0 };
          for (const g of unitGroups as any[]) {
            if (g?.is_affordable) continue;
            const count = Number(g.unit_count) || 0;
            if (!count) continue;
            const bd = Number(g.bedrooms) || 0;
            if (bd === 0) mix.studio += count;
            else if (bd === 1) mix.one_br += count;
            else if (bd === 2) mix.two_br += count;
            else if (bd === 3) mix.three_br += count;
            else mix.four_br_plus += count;
          }
          return mix;
        })()}
        mode="type"
        spottedBonuses={densityBonuses}
        availableBuildings={currentMassing?.buildings.map((b) => ({ id: b.id, label: b.label })) || []}
        onConfigChange={(cfg) => { setAffordabilityConfig(cfg); setDirty(true); }}
      />
      )}

      {/* Commercial Tenants and Other Income are now on the Underwriting page under Revenue */}
    </div>
  );
}
