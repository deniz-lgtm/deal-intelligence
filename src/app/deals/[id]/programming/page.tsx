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
import ScenarioVariantsPanel from "@/components/massing/ScenarioVariantsPanel";
import AffordabilityPlanner from "@/components/AffordabilityPlanner";
import { useViewMode } from "@/lib/use-view-mode";
import ViewModeToggle from "@/components/ViewModeToggle";
import { newBuildingProgram, computeMassingSummary, newScenario } from "@/components/massing/massing-utils";
import type { ZoningInputs } from "@/components/massing/massing-utils";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, horizontalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
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
  const [showVariantsPanel, setShowVariantsPanel] = useState(false);
  // Timestamp of the most recent successful programming save. Bumping
  // this triggers the Programming→Underwriting auto-sync effect so we
  // don't have to thread the call directly through saveAll (which has
  // different useCallback deps).
  const [lastSavedAt, setLastSavedAt] = useState(0);
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
      setLastSavedAt(Date.now());
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

  // Auto-sync to Underwriting after a successful save. Declared below
  // once autoSyncProgrammingToUw is in scope (see effect further down
  // the file) — see also the `lastSavedAt` state that triggers it.

  // Pure merge: given a scenario (one building stack) and a starting
  // underwriting blob, return the merged blob WITHOUT any network calls
  // or side effects. The same merge powers both the old manual push
  // (now removed) and the new auto-sync loop.
  const computePushedUw = useCallback((scenario: any, current: any) => {
    const summary = computeMassingSummary(scenario, zoningInputs);
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
      // Preserve user-entered rent + affordability + lease fields across a
      // re-push. Match an existing unit_group to the generated row by
      // (building_id, bedrooms, sf_per_unit) first, then fall back to
      // (building_id, label), then (building_id alone, single-row case).
      // Anything the analyst typed in UW — market_rent_per_unit/sf/bed,
      // affordability flags, lease_type, expense reimbursement — carries
      // over so the auto-sync loop never stomps their work.
      const existingUnitGroups = (current.unit_groups || []) as any[];
      const findExistingMatch = (row: { bedrooms: number; sf_per_unit: number; label: string }) => {
        const candidates = existingUnitGroups.filter((g) =>
          buildingId ? g.site_plan_building_id === buildingId : true
        );
        return (
          candidates.find((g) =>
            (g.bedrooms ?? 0) === row.bedrooms &&
            Math.abs((g.sf_per_unit ?? 0) - row.sf_per_unit) <= 2
          ) ||
          candidates.find((g) => (g.label || "").toLowerCase() === row.label.toLowerCase()) ||
          (candidates.length === 1 ? candidates[0] : null)
        );
      };
      const generated = mix.length > 0
        ? mix.map((m: any) => {
            const baseLabel = buildingLabel ? `${buildingLabel} · ${m.type_label}` : m.type_label;
            const bedrooms = m.type_label.includes("Studio") ? 0 : m.type_label.includes("3") ? 3 : m.type_label.includes("2") ? 2 : 1;
            const sfPerUnit = m.avg_sf;
            const match = findExistingMatch({ bedrooms, sf_per_unit: sfPerUnit, label: baseLabel });
            return {
              // Reuse the existing id when we have a match — keeps
              // AffordabilityPlanner's per-group splits and any downstream
              // references stable across syncs.
              id: match?.id || uuidv4(),
              label: baseLabel,
              unit_count: Math.round(totalU * (m.allocation_pct / 100)),
              renovation_count: match?.renovation_count ?? 0,
              renovation_cost_per_unit: match?.renovation_cost_per_unit ?? 0,
              unit_change: match?.unit_change ?? "none",
              unit_change_count: match?.unit_change_count ?? 0,
              bedrooms,
              bathrooms: m.type_label.includes("3") ? 2 : 1,
              sf_per_unit: sfPerUnit,
              // Preserve user-entered rent/lease fields — these are what
              // got wiped before every re-push.
              current_rent_per_sf: match?.current_rent_per_sf ?? 0,
              market_rent_per_sf: match?.market_rent_per_sf ?? 0,
              lease_type: match?.lease_type ?? "NNN",
              expense_reimbursement_per_sf: match?.expense_reimbursement_per_sf ?? 0,
              current_rent_per_unit: match?.current_rent_per_unit ?? 0,
              market_rent_per_unit: match?.market_rent_per_unit ?? 0,
              beds_per_unit: match?.beds_per_unit ?? 1,
              current_rent_per_bed: match?.current_rent_per_bed ?? 0,
              market_rent_per_bed: match?.market_rent_per_bed ?? 0,
              // Carry forward affordability flags if set (e.g. is_affordable,
              // ami_pct, affordable_unit_count). Spread last so explicit
              // values above win when defined, affordability extras ride along.
              ...(match
                ? Object.fromEntries(
                    Object.entries(match).filter(([k]) =>
                      ["is_affordable", "ami_pct", "affordable_unit_count", "affordability_tier", "affordable_rent_per_unit"].includes(k)
                    )
                  )
                : {}),
              ...(buildingId ? { site_plan_building_id: buildingId } : {}),
            };
          })
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

      // When the scenario belongs to a multi-building massing we push
      // each building one-by-one — but each call overwrites the UW's
      // max_gsf / max_nrsf, so the last building's SF would win. To
      // keep the dev budget sized to the WHOLE massing, compute
      // aggregate GSF/NRSF across every scenario in the same
      // site_plan_scenario_id. Single-building massings fall straight
      // through to this scenario's own summary.
      const siteMassingId = scenario.site_plan_scenario_id || null;
      const massingScenariosForPush = siteMassingId
        ? buildingProgram.scenarios.filter(
            (s) => s.site_plan_scenario_id === siteMassingId
          )
        : [scenario];
      const aggregateMassing = massingScenariosForPush.reduce(
        (acc, s) => {
          const sm = computeMassingSummary(s, zoningInputs);
          return {
            total_gsf: acc.total_gsf + sm.total_gsf,
            total_nrsf: acc.total_nrsf + sm.total_nrsf,
            total_parking_spaces_est:
              acc.total_parking_spaces_est + sm.total_parking_spaces_est,
          };
        },
        { total_gsf: 0, total_nrsf: 0, total_parking_spaces_est: 0 }
      );

      const merged = {
        ...current,
        development_mode: true,
        max_gsf: aggregateMassing.total_gsf,
        max_nrsf: aggregateMassing.total_nrsf,
        efficiency_pct:
          aggregateMassing.total_gsf > 0
            ? Math.round(
                (aggregateMassing.total_nrsf / aggregateMassing.total_gsf) * 100
              )
            : 80,
        unit_groups: newUnitGroups,
        mixed_use: mixedUseConfig,
        building_program: buildingProgram,
        other_income_items: otherIncomeItems,
        commercial_tenants: commercialTenants,
        // Parking — auto-split 70% reserved / 30% unreserved with default
        // rates. Uses the aggregate parking count so multi-building
        // massings don't collapse to just the last building's stalls.
        parking_reserved_spaces: Math.round(aggregateMassing.total_parking_spaces_est * 0.7),
        parking_reserved_rate: current.parking_reserved_rate || 200,
        parking_unreserved_spaces: Math.round(aggregateMassing.total_parking_spaces_est * 0.3),
        parking_unreserved_rate: current.parking_unreserved_rate || 100,
        // Legacy other-income scalars — zeroed because the underwriting
        // calc now sums d.other_income_items directly (source of truth
        // in one place). Leaving them populated would double-count
        // items whose labels include "rubs" / "laundry".
        rubs_per_unit_monthly: 0,
        parking_monthly: 0,
        laundry_monthly: 0,
      };
      return merged;
  }, [zoningInputs, buildingProgram, otherIncomeItems, commercialTenants, sitePlanMassings]);

  // Fire AI OpEx + loan-sizing estimates in the background when the UW
  // blob looks empty. Used by the auto-sync loop on the first successful
  // sync so analysts don't have to manually click AI Estimate. Silent
  // (no toasts) — the UW page shows the values when they arrive.
  const maybeAutoRunAiEstimates = useCallback((current: any) => {
    const hasOpex = current.taxes_annual > 0 || current.insurance_annual > 0;
    if (hasOpex) return;
    fetch(`/api/deals/${params.id}/opex-estimate`, { method: "POST" })
      .then(r => r.json())
      .then(json => {
        if (!json.data) return;
        const est = json.data;
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
            opex_item_notes: (est.item_notes && typeof est.item_notes === "object") ? est.item_notes : (cur.opex_item_notes || {}),
          };
          fetch("/api/underwriting", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deal_id: params.id, data: opexMerged }) });
        });
      }).catch(() => {});

    fetch(`/api/deals/${params.id}/loan-size`, { method: "POST" })
      .then(r => r.json())
      .then(json => {
        if (!json.data) return;
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
        });
      }).catch(() => {});
  }, [params.id]);

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

  // Reorder massings via drag-and-drop. Persists the new order to the
  // underwriting.data.site_plan.scenarios array so Site & Zoning and
  // Underwriting pick up the same ordering.
  const reorderMassings = useCallback(async (fromId: string, toId: string) => {
    if (fromId === toId) return;
    const fromIdx = sitePlanMassings.findIndex((m) => m.id === fromId);
    const toIdx = sitePlanMassings.findIndex((m) => m.id === toId);
    if (fromIdx < 0 || toIdx < 0) return;

    // Reorder the local list optimistically
    const next = [...sitePlanMassings];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    setSitePlanMassings(next);

    try {
      const uwRes = await fetch(`/api/underwriting?deal_id=${params.id}`);
      const uwJson = await uwRes.json();
      const current = uwJson.data?.data
        ? (typeof uwJson.data.data === "string" ? JSON.parse(uwJson.data.data) : uwJson.data.data)
        : {};
      const sp = current.site_plan || {};
      const existing: any[] = Array.isArray(sp.scenarios) ? sp.scenarios : [];
      // Re-sort the persisted scenarios array by the new local order.
      // Any scenarios the UI doesn't know about (shouldn't happen, but
      // belt-and-braces) keep their trailing position.
      const orderIndex: Record<string, number> = {};
      next.forEach((m, i) => { orderIndex[m.id] = i; });
      const sorted = [...existing].sort((a, b) => {
        const ai = orderIndex[a.id] ?? 1e6;
        const bi = orderIndex[b.id] ?? 1e6;
        return ai - bi;
      });
      await fetch("/api/underwriting", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deal_id: params.id,
          data: {
            ...current,
            site_plan: { ...sp, scenarios: sorted, updated_at: new Date().toISOString() },
          },
        }),
      });
    } catch {
      toast.error("Failed to save massing order — refresh to see current order");
    }
  }, [params.id, sitePlanMassings]);

  // (The old `snapshotMassingToUw` lived here. Auto-sync now owns the
  // snapshotting inline — see autoSyncProgrammingToUw below — so the
  // function was removed to keep one write path.)

  // Helper: pick the base-case massing (falls back to the first one
  // when nothing is flagged, so baseline UW is never empty).
  const resolveBaseMassing = useCallback(() => {
    return sitePlanMassings.find((m) => m.is_base_case) || sitePlanMassings[0] || null;
  }, [sitePlanMassings]);

  // Auto-sync the entire programming state to Underwriting.
  //
  // Replaces the explicit "Push <Massing> to UW" button. Runs after
  // every successful programming save, silently:
  //   1. Live UW is rebuilt from the BASE-CASE massing's building
  //      stacks (or the first massing when none is flagged). User-
  //      entered rents and affordability are preserved by the
  //      per-unit-group match in computePushedUw.
  //   2. Every massing (including the base case) is snapshotted as a
  //      named UW Scenario. Non-base-case snapshots start from their
  //      previously-saved state (so user-entered rents/OpEx on that
  //      scenario survive), then have the massing's structural fields
  //      refreshed on top.
  //   3. A single PUT writes the updated live UW + scenarios list.
  const autoSyncProgrammingToUw = useCallback(async () => {
    if (sitePlanMassings.length === 0) return;
    try {
      const uwRes = await fetch(`/api/underwriting?deal_id=${params.id}`);
      const uwJson = await uwRes.json();
      const fetched = uwJson.data?.data
        ? (typeof uwJson.data.data === "string" ? JSON.parse(uwJson.data.data) : uwJson.data.data)
        : {};

      const baseMassing = resolveBaseMassing();
      if (!baseMassing) return;

      // 1) Apply base-case buildings to live UW.
      let live: any = { ...fetched };
      const baseBuildings = buildingProgram.scenarios.filter(
        (s) => s.site_plan_scenario_id === baseMassing.id
      );
      for (const s of baseBuildings) {
        live = computePushedUw(s, live);
      }

      // Prune orphan unit_groups whose site_plan_building_id no longer
      // maps to a current massing's building. Without this, a legacy
      // "Building 1" (from an old single-building site plan) or a
      // building that was renamed / deleted keeps showing up in the
      // Revenue table as a phantom header. Untagged groups
      // (site_plan_building_id === null/undefined) are legacy flat-mode
      // rows and are always kept.
      const liveBuildingIds = new Set<string>(
        sitePlanMassings.flatMap((m) => m.buildings.map((b) => b.id))
      );
      live = {
        ...live,
        unit_groups: (live.unit_groups || []).filter((g: any) => {
          const bid = g.site_plan_building_id;
          return !bid || liveBuildingIds.has(bid);
        }),
      };

      // 2) Build updated scenario snapshots for every massing.
      const existingScenarios: any[] = Array.isArray(live.uw_scenarios) ? live.uw_scenarios : [];
      const updatedScenarios: any[] = [];
      for (const mng of sitePlanMassings) {
        const prev = existingScenarios.find((x) => x.name === mng.name);
        // Seed the scenario state from the prior snapshot when present
        // — this is how per-scenario rents/OpEx/affordability survive
        // structural edits. First-time sync seeds from live UW so the
        // scenario starts with sensible defaults.
        let scnState: any = prev?.state ? { ...prev.state } : { ...live };
        delete scnState.uw_scenarios;
        const mngBuildings = buildingProgram.scenarios.filter(
          (s) => s.site_plan_scenario_id === mng.id
        );
        for (const s of mngBuildings) {
          scnState = computePushedUw(s, scnState);
        }
        // Prune orphans inside this scenario too — keep only unit_groups
        // tied to this massing's buildings (or untagged legacy rows).
        const scnBuildingIds = new Set<string>(mng.buildings.map((b) => b.id));
        scnState = {
          ...scnState,
          unit_groups: (scnState.unit_groups || []).filter((g: any) => {
            const bid = g.site_plan_building_id;
            return !bid || scnBuildingIds.has(bid);
          }),
        };
        // Quick structural summary for the saved-scenarios card.
        const summary = mngBuildings.reduce(
          (acc: any, s: any) => {
            const sm = computeMassingSummary(s, zoningInputs);
            return {
              total_gsf: (acc.total_gsf || 0) + sm.total_gsf,
              total_nrsf: (acc.total_nrsf || 0) + sm.total_nrsf,
              total_units: (acc.total_units || 0) + sm.total_units,
              total_parking_spaces_est: (acc.total_parking_spaces_est || 0) + sm.total_parking_spaces_est,
              buildings_count: (acc.buildings_count || 0) + 1,
            };
          },
          {}
        );
        const { uw_scenarios: _ignore, notes: _ignore2, ...cleanState } = scnState;
        updatedScenarios.push({
          id:
            prev?.id ||
            (typeof crypto !== "undefined" && typeof (crypto as any).randomUUID === "function"
              ? (crypto as any).randomUUID()
              : `uws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
          name: mng.name,
          created_at: prev?.created_at || new Date().toISOString(),
          updated_at: new Date().toISOString(),
          site_plan_scenario_id: mng.id,
          is_base_case: mng.id === baseMassing.id,
          state: cleanState,
          building_program: cleanState.building_program || null,
          unit_groups: cleanState.unit_groups || [],
          other_income_items: cleanState.other_income_items || [],
          commercial_tenants: cleanState.commercial_tenants || [],
          summary,
        });
      }

      // 3) Prune stale scenarios whose massings no longer exist.
      const livingMassingIds = new Set(sitePlanMassings.map((m) => m.id));
      const survivingLegacy = existingScenarios.filter(
        (x) => !x.site_plan_scenario_id || livingMassingIds.has(x.site_plan_scenario_id)
      ).filter(
        (x) => !updatedScenarios.some((u) => u.name === x.name)
      );

      const next = { ...live, uw_scenarios: [...updatedScenarios, ...survivingLegacy] };
      await fetch("/api/underwriting", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deal_id: params.id, data: next }),
      });
      maybeAutoRunAiEstimates(fetched);
    } catch {
      // Silent — auto-sync runs on every save; a toast on each failure
      // would be noisy. The explicit Save button's toast still fires.
    }
  }, [params.id, sitePlanMassings, buildingProgram, zoningInputs, computePushedUw, resolveBaseMassing, maybeAutoRunAiEstimates]);

  // Fire Programming→Underwriting auto-sync after every successful
  // save. Replaces the manual "Push <Massing> to UW" button — every
  // massing stays in sync with Underwriting automatically, and each
  // massing is also snapshotted as a named UW Scenario so the
  // analyst can still load alternates from the UW page.
  // Use a ref for the callback so the effect only fires when
  // lastSavedAt actually changes — not every time any of the callback's
  // dependencies (buildingProgram, etc.) shift mid-edit.
  const autoSyncRef = React.useRef(autoSyncProgrammingToUw);
  useEffect(() => { autoSyncRef.current = autoSyncProgrammingToUw; }, [autoSyncProgrammingToUw]);
  useEffect(() => {
    if (lastSavedAt === 0) return;
    autoSyncRef.current();
  }, [lastSavedAt]);

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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-xl font-bold">Programming</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Define what you&apos;re building — massing, unit mix, commercial tenants, and income sources. Every save syncs to Underwriting automatically.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap sm:flex-shrink-0">
          <ViewModeToggle mode={viewMode} onChange={setViewMode} />
          <Button variant="outline" size="sm" onClick={saveAll} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}Save
          </Button>
          <a
            href={`/deals/${params.id}/underwriting`}
            className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors whitespace-nowrap"
            title="Open the Underwriting page — programming changes have already flowed through."
          >
            <ArrowRight className="h-4 w-4 mr-2" /> Go to Underwriting
          </a>
        </div>
      </div>

      {/* Massing tabs — driven 1:1 by site_plan.scenarios. To rename,
          add or delete a Massing the analyst goes back to Site & Zoning;
          this page is read-only on the structure (it just edits the
          floor stacks within each cell).
          Shown even in the single-massing case so the analyst always
          knows which massing they're editing — the chip acts as a
          breadcrumb and an affordance for adding alternates later. */}
      {sitePlanMassings.length > 0 && (
        <MassingTabsRow
          massings={sitePlanMassings}
          activeMassingId={currentMassing?.id ?? null}
          onReorder={reorderMassings}
          onToggleBaseCase={toggleMassingBaseCase}
          onSelect={(m) => {
            setActiveMassingId(m.id);
            const nextBuildingId = m.buildings[0]?.id || null;
            setActiveBuildingId(nextBuildingId);
            const nextScenario = buildingProgram.scenarios.find(
              (s) =>
                s.site_plan_scenario_id === m.id &&
                s.site_plan_building_id === nextBuildingId,
            );
            if (nextScenario && nextScenario.id !== buildingProgram.active_scenario_id) {
              setBuildingProgram((p) => ({ ...p, active_scenario_id: nextScenario.id }));
            }
          }}
        />
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
        <div className="flex items-center justify-end mb-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowVariantsPanel(true)}
            disabled={!activeScenario || (activeScenario.footprint_sf || 0) <= 0}
            className="text-xs h-7 border-amber-500/40 bg-amber-500/5 text-amber-200 hover:bg-amber-500/15"
            title="Generate 9 candidate massing variants (3 heights × 3 unit mixes)"
          >
            <Sparkles className="h-3 w-3 mr-1" />
            Generate Variants
          </Button>
        </div>
        <MassingSection
          program={buildingProgram}
          onChange={p => { setBuildingProgram(p); setDirty(true); }}
          zoning={zoningInputs}
          densityBonuses={densityBonuses}
          footprintReadOnly={!!currentBuilding}
          activeBuildingLabel={currentBuilding?.label ?? null}
        />
        {showVariantsPanel && activeScenario && (
          <ScenarioVariantsPanel
            inputs={{
              footprint_sf: activeScenario.footprint_sf,
              land_sf: zoningInputs.land_sf,
              far_cap: zoningInputs.far,
              height_cap_ft: zoningInputs.height_limit_ft,
              lot_coverage_pct: zoningInputs.lot_coverage_pct,
              base_unit_mix: activeScenario.unit_mix,
            }}
            activeBuildingLabel={currentBuilding?.label || "this building"}
            onClose={() => setShowVariantsPanel(false)}
            onApply={(floors, unit_mix, variant) => {
              setBuildingProgram((prev) => ({
                ...prev,
                scenarios: prev.scenarios.map((s) =>
                  s.id === activeScenario.id
                    ? {
                        ...s,
                        floors,
                        unit_mix,
                        ai_template_label: `Variant: ${variant.label}`,
                      }
                    : s
                ),
              }));
              setDirty(true);
              setShowVariantsPanel(false);
              toast.success(`Applied variant: ${variant.label}`);
            }}
          />
        )}
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
          // Exclude post-split affordable rows so the planner's revenue
          // impact preview reflects the actual market rent, not a rent
          // already pulled down by AMI-capped rows.
          const marketRows = (unitGroups as any[]).filter((g) => !g?.is_affordable);
          if (marketRows.length === 0) return 0;
          const totalUnits = marketRows.reduce((s: number, g: any) => s + (g.unit_count || 0), 0);
          if (totalUnits === 0) return 0;
          const totalRent = marketRows.reduce((s: number, g: any) => s + (g.unit_count || 0) * (g.market_rent_per_unit || 0), 0);
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

// ── Massing tabs row (draggable) ─────────────────────────────────────────────
//
// Extracted into its own component so the DndContext can own the pointer
// sensor state without cluttering the main page render. The row lives
// above the Massing editor and lets the analyst reorder site-plan
// scenarios by dragging the grip handle at the left of each tab.
interface MassingTabsRowProps {
  massings: Array<{ id: string; name: string; is_base_case?: boolean; buildings: Array<{ id: string; label: string }> }>;
  activeMassingId: string | null;
  onSelect: (m: MassingTabsRowProps["massings"][number]) => void;
  onToggleBaseCase: (id: string) => void;
  onReorder: (fromId: string, toId: string) => void;
}

function MassingTabsRow({ massings, activeMassingId, onSelect, onToggleBaseCase, onReorder }: MassingTabsRowProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    onReorder(String(active.id), String(over.id));
  };
  return (
    <div className="flex items-center gap-1 flex-wrap border-b border-border/40 pb-2">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground mr-2">Massing</span>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={massings.map((m) => m.id)} strategy={horizontalListSortingStrategy}>
          <div className="flex items-center gap-1 flex-wrap">
            {massings.map((m) => (
              <SortableMassingTab
                key={m.id}
                massing={m}
                isActive={activeMassingId === m.id}
                onSelect={() => onSelect(m)}
                onToggleBaseCase={() => onToggleBaseCase(m.id)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}

interface SortableMassingTabProps {
  massing: MassingTabsRowProps["massings"][number];
  isActive: boolean;
  onSelect: () => void;
  onToggleBaseCase: () => void;
}

function SortableMassingTab({ massing: m, isActive, onSelect, onToggleBaseCase }: SortableMassingTabProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: m.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  const isBase = !!m.is_base_case;
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-1 pl-1 pr-3 py-1.5 text-xs rounded-md border transition-colors ${
        isActive
          ? "bg-amber-500/15 border-amber-500/40 text-amber-200"
          : "bg-muted/20 border-border/40 text-muted-foreground hover:border-border/60 hover:text-foreground"
      }`}
      title="Drag to reorder · click to select"
    >
      {/* Grip handle for drag */}
      <span {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing opacity-40 hover:opacity-80 px-0.5">
        <GripVertical className="h-3 w-3" />
      </span>
      <button
        type="button"
        onClick={onToggleBaseCase}
        title={isBase ? "Base case — click to un-star" : "Mark as base case"}
        className={`${isBase ? "text-amber-300" : "text-muted-foreground/40 hover:text-amber-300"}`}
      >
        <Star className={`h-3 w-3 ${isBase ? "fill-amber-300" : ""}`} />
      </button>
      <button type="button" onClick={onSelect} className="flex items-center gap-1.5">
        <Layers className="h-3 w-3" />
        <span className="font-medium">{m.name}</span>
        <span className="text-[10px] text-muted-foreground/80">
          {m.buildings.length} {m.buildings.length === 1 ? "building" : "buildings"}
        </span>
      </button>
    </div>
  );
}
