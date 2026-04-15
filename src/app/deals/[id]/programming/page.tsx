"use client";

import React, { useState, useEffect, useCallback } from "react";
import { v4 as uuidv4 } from "uuid";
import {
  Loader2, Save, Plus, Trash2, Layers, Building2, Car, DollarSign,
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

// ── Main Page ────────────────────────────────────────────────────────────────
export default function ProgrammingPage({ params }: { params: { id: string } }) {
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
  const [unitGroups, setUnitGroups] = useState<any[]>([]);
  const [affordabilityConfig, setAffordabilityConfig] = useState<any>(null);
  const [taxesAnnual, setTaxesAnnual] = useState(0);
  // Buildings drawn on the Site & Zoning page site plan. Each {id, label,
  // area_sf} lets a massing scenario reference one specific building via
  // site_plan_building_id. Empty array means no drawn site plan — the
  // typed-footprint workflow is preserved.
  const [sitePlanBuildings, setSitePlanBuildings] = useState<
    Array<{ id: string; label: string; area_sf: number }>
  >([]);

  // Load data
  useEffect(() => {
    Promise.all([
      fetch(`/api/deals/${params.id}`).then(r => r.json()),
      fetch(`/api/underwriting?deal_id=${params.id}`).then(r => r.json()),
    ]).then(([dealRes, uwRes]) => {
      const d = dealRes.data;
      setDeal(d);
      const uw = uwRes.data?.data ? (typeof uwRes.data.data === "string" ? JSON.parse(uwRes.data.data) : uwRes.data.data) : {};

      // Site plan drawn on the Site & Zoning page. Extract the building
      // list (handles both the new `buildings[]` shape and the legacy
      // `{building_points, building_area_sf}` single-building shape for
      // reading — writes always go through the site-zoning page which
      // normalizes to the new shape).
      const rawPlan = uw.site_plan as any;
      let bList: Array<{ id: string; label: string; area_sf: number; points?: unknown }> = [];
      if (rawPlan && Array.isArray(rawPlan.buildings) && rawPlan.buildings.length > 0) {
        bList = rawPlan.buildings.map((b: any) => ({
          id: b.id,
          label: b.label,
          area_sf: Math.round(Number(b.area_sf) || 0),
        }));
      } else if (
        rawPlan &&
        Array.isArray(rawPlan.building_points) &&
        rawPlan.building_points.length >= 3
      ) {
        bList = [{
          id: "legacy",
          label: "Building 1",
          area_sf: Math.round(Number(rawPlan.building_area_sf) || 0),
        }];
      }
      setSitePlanBuildings(bList);

      // Default seed footprint — the scenario's linked building if set,
      // else the first building, else the legacy sum. Keeps existing
      // behaviour (first-time hydration only when scenario is unsized).
      const defaultSeedSf = bList[0]?.area_sf || 0;

      if (uw.building_program?.scenarios?.length > 0) {
        const prog = uw.building_program as BuildingProgram;
        const activeId = prog.active_scenario_id || prog.scenarios[0]?.id;
        prog.scenarios = prog.scenarios.map(s => {
          if (s.id !== activeId) return s;
          // If the scenario is linked to a specific building, prefer that
          // building's current area; otherwise only seed when unsized.
          const linkedB = s.site_plan_building_id
            ? bList.find(b => b.id === s.site_plan_building_id)
            : null;
          if (linkedB) return { ...s, footprint_sf: linkedB.area_sf };
          if ((!s.footprint_sf || s.footprint_sf === 0) && defaultSeedSf > 0) {
            return { ...s, footprint_sf: defaultSeedSf };
          }
          return s;
        });
        setBuildingProgram(prog);
      } else if (defaultSeedSf > 0) {
        // No saved program yet but we have a drawn footprint → start the
        // default Base Case scenario with it pre-filled.
        const fresh = newBuildingProgram();
        fresh.scenarios[0].footprint_sf = defaultSeedSf;
        fresh.scenarios[0].site_plan_building_id = bList[0]?.id || null;
        setBuildingProgram(fresh);
      }
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
      const buildingLabel =
        (buildingId && sitePlanBuildings.find(b => b.id === buildingId)?.label) || "";
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
  }, [params.id, zoningInputs, buildingProgram, otherIncomeItems, commercialTenants, sitePlanBuildings]);

  if (loading) return <div className="flex items-center justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  // Compute summary for active scenario
  const activeScenario = buildingProgram.scenarios.find(s => s.id === buildingProgram.active_scenario_id) || buildingProgram.scenarios[0];
  const summary = activeScenario ? computeMassingSummary(activeScenario, zoningInputs) : null;
  const totalUnits = unitGroups.reduce((s: number, g: any) => s + (g.unit_count || 0), 0) || summary?.total_units || 0;

  // Multi-building UX: when the site plan has more than one building, we
  // pivot the page into "tabs" where each tab is a dedicated massing
  // scenario for one building. Clicking a tab either switches to the
  // existing scenario for that building, or fabricates a fresh scenario
  // seeded with that building's footprint and links it back via
  // site_plan_building_id. Legacy single-building decks remain unchanged.
  const selectBuilding = (buildingId: string) => {
    const existing = buildingProgram.scenarios.find(
      s => s.site_plan_building_id === buildingId
    );
    if (existing) {
      setBuildingProgram({ ...buildingProgram, active_scenario_id: existing.id });
      setDirty(true);
      return;
    }
    const b = sitePlanBuildings.find(x => x.id === buildingId);
    if (!b) return;
    const fresh = newScenario(b.label);
    fresh.site_plan_building_id = b.id;
    fresh.footprint_sf = b.area_sf;
    setBuildingProgram({
      ...buildingProgram,
      scenarios: [...buildingProgram.scenarios, fresh],
      active_scenario_id: fresh.id,
    });
    setDirty(true);
  };

  // Small display helper: returns the SitePlanBuilding linked to the
  // current active scenario, or null for scenarios not tied to a building.
  const activeBuildingId = activeScenario?.site_plan_building_id ?? null;
  const hasMultipleBuildings = sitePlanBuildings.length > 1;

  // Project totals — summed across every scenario that is linked to a
  // site-plan building. Used by the second summary strip when multi-
  // building so the analyst can see the whole project at a glance
  // without switching tabs. Not summed for non-linked scenarios (those
  // are alternatives, not concurrent buildings).
  const projectTotals = hasMultipleBuildings
    ? buildingProgram.scenarios
        .filter(s => s.site_plan_building_id)
        .reduce(
          (acc, s) => {
            const sum = computeMassingSummary(s, zoningInputs);
            return {
              total_gsf: acc.total_gsf + sum.total_gsf,
              total_nrsf: acc.total_nrsf + sum.total_nrsf,
              total_units: acc.total_units + sum.total_units,
              total_parking_spaces_est: acc.total_parking_spaces_est + sum.total_parking_spaces_est,
              max_height_ft: Math.max(acc.max_height_ft, sum.total_height_ft),
              buildings_count: acc.buildings_count + 1,
            };
          },
          { total_gsf: 0, total_nrsf: 0, total_units: 0, total_parking_spaces_est: 0, max_height_ft: 0, buildings_count: 0 }
        )
    : null;

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
          <Button variant="outline" size="sm" onClick={saveAll} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}Save
          </Button>
          {activeScenario && (
            <Button size="sm" onClick={() => pushToUW(activeScenario)} className="bg-primary hover:bg-primary/90">
              <ArrowRight className="h-4 w-4 mr-2" /> Push to Underwriting
            </Button>
          )}
        </div>
      </div>

      {/* Building tabs — only when the site plan has >1 building. Each
          tab is a distinct massing scenario linked via
          site_plan_building_id. Clicking a tab that has no scenario yet
          creates one seeded with the building's footprint. */}
      {hasMultipleBuildings && (
        <div className="flex items-center gap-1 flex-wrap border-b border-border/40 pb-2">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground mr-2">
            Building
          </span>
          {sitePlanBuildings.map((b) => {
            const linked = buildingProgram.scenarios.find(
              s => s.site_plan_building_id === b.id
            );
            const isActive = activeBuildingId === b.id;
            return (
              <button
                key={b.id}
                onClick={() => selectBuilding(b.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border transition-colors ${
                  isActive
                    ? "bg-blue-500/15 border-blue-500/40 text-blue-200"
                    : "bg-muted/20 border-border/40 text-muted-foreground hover:border-border/60 hover:text-foreground"
                }`}
                title={
                  linked
                    ? `Massing scenario: ${linked.name}`
                    : "No scenario yet — click to create one for this building"
                }
              >
                <Building2 className="h-3 w-3" />
                <span className="font-medium">{b.label}</span>
                <span className="text-[10px] text-muted-foreground/80">
                  {b.area_sf.toLocaleString()} SF
                </span>
                {!linked && (
                  <Plus className="h-3 w-3 text-muted-foreground/60" />
                )}
              </button>
            );
          })}
          {/* Unlinked scenarios still get their own tab at the end so
              the analyst can reach as-of-right / bonus alternatives if
              they've been configured that way. */}
          {buildingProgram.scenarios
            .filter(s => !s.site_plan_building_id)
            .map((s) => {
              const isActive = activeScenario?.id === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => {
                    setBuildingProgram({ ...buildingProgram, active_scenario_id: s.id });
                    setDirty(true);
                  }}
                  className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${
                    isActive
                      ? "bg-muted/40 border-border/60 text-foreground"
                      : "bg-muted/10 border-border/30 text-muted-foreground hover:text-foreground"
                  }`}
                  title="Scenario not linked to a site-plan building"
                >
                  {s.name}
                </button>
              );
            })}
        </div>
      )}

      {/* Summary Bar */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="border rounded-lg p-3 bg-card">
            <p className="text-[10px] text-muted-foreground uppercase">Total GSF</p>
            <p className="text-lg font-bold tabular-nums">{fn(summary.total_gsf)}</p>
          </div>
          <div className="border rounded-lg p-3 bg-card">
            <p className="text-[10px] text-muted-foreground uppercase">Total NRSF</p>
            <p className="text-lg font-bold tabular-nums">{fn(summary.total_nrsf)}</p>
          </div>
          <div className="border rounded-lg p-3 bg-card">
            <p className="text-[10px] text-muted-foreground uppercase">Res. Units</p>
            <p className="text-lg font-bold tabular-nums">{fn(summary.total_units)}</p>
          </div>
          <div className="border rounded-lg p-3 bg-card">
            <p className="text-[10px] text-muted-foreground uppercase">Parking</p>
            <p className="text-lg font-bold tabular-nums">{fn(summary.total_parking_spaces_est)}</p>
          </div>
          <div className="border rounded-lg p-3 bg-card">
            <p className="text-[10px] text-muted-foreground uppercase">Height</p>
            <p className="text-lg font-bold tabular-nums">{summary.total_height_ft.toFixed(0)} ft</p>
          </div>
        </div>
      )}

      {/* Project totals — sums across every scenario linked to a site-plan
          building. Only renders in multi-building projects, and only
          when at least one building has a real scenario attached. Lets
          the analyst sanity-check project-wide numbers without leaving
          the current building tab. */}
      {projectTotals && projectTotals.buildings_count > 0 && (
        <div className="border border-primary/25 bg-primary/5 rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] uppercase tracking-wide text-primary/80 font-medium">
              Project Totals — {projectTotals.buildings_count} building{projectTotals.buildings_count > 1 ? "s" : ""}
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div>
              <p className="text-[10px] text-muted-foreground uppercase">Total GSF</p>
              <p className="text-lg font-bold tabular-nums">{fn(projectTotals.total_gsf)}</p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase">Total NRSF</p>
              <p className="text-lg font-bold tabular-nums">{fn(projectTotals.total_nrsf)}</p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase">Res. Units</p>
              <p className="text-lg font-bold tabular-nums">{fn(projectTotals.total_units)}</p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase">Parking</p>
              <p className="text-lg font-bold tabular-nums">{fn(projectTotals.total_parking_spaces_est)}</p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase">Max Height</p>
              <p className="text-lg font-bold tabular-nums">{projectTotals.max_height_ft.toFixed(0)} ft</p>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════ BUILDING MASSING ═══════════════════ */}
      <Section
        title={(() => {
          // Scope the section title to the active building when multi-
          // building so the analyst has a clear "I am editing Building
          // 2" anchor as they move between tabs.
          if (!hasMultipleBuildings) return "Building Massing";
          const linked = sitePlanBuildings.find(b => b.id === activeBuildingId);
          return linked ? `Building Massing — ${linked.label}` : "Building Massing";
        })()}
        icon={<Layers className="h-4 w-4 text-blue-400" />}
      >
        <MassingSection
          program={buildingProgram}
          onChange={p => { setBuildingProgram(p); setDirty(true); }}
          zoning={zoningInputs}
          densityBonuses={densityBonuses}
          sitePlanBuildings={sitePlanBuildings}
          onPushBaseline={pushToUW}
          onPushScenario={pushToUW}
        />
      </Section>

      {/* ═══════════════════ AFFORDABILITY ═══════════════════ */}
      <AffordabilityPlanner
        dealId={params.id}
        totalUnits={(() => {
          // Compute total units from active massing scenario or UW unit groups
          const activeScenario = buildingProgram.scenarios.find(s => s.id === buildingProgram.active_scenario_id);
          if (activeScenario) {
            const summary = computeMassingSummary(activeScenario, zoningInputs);
            return summary.total_units || unitGroups.reduce((s: number, g: any) => s + (g.unit_count || 0), 0);
          }
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
        onConfigChange={(cfg) => { setAffordabilityConfig(cfg); setDirty(true); }}
      />

      {/* Commercial Tenants and Other Income are now on the Underwriting page under Revenue */}
    </div>
  );
}
