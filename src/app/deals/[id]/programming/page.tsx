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
import { newBuildingProgram, computeMassingSummary } from "@/components/massing/massing-utils";
import type { ZoningInputs } from "@/components/massing/massing-utils";

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

  // Load data
  useEffect(() => {
    Promise.all([
      fetch(`/api/deals/${params.id}`).then(r => r.json()),
      fetch(`/api/underwriting?deal_id=${params.id}`).then(r => r.json()),
    ]).then(([dealRes, uwRes]) => {
      const d = dealRes.data;
      setDeal(d);
      const uw = uwRes.data?.data ? (typeof uwRes.data.data === "string" ? JSON.parse(uwRes.data.data) : uwRes.data.data) : {};

      if (uw.building_program?.scenarios?.length > 0) setBuildingProgram(uw.building_program);
      if (uw.other_income_items?.length > 0) setOtherIncomeItems(uw.other_income_items);
      if (uw.commercial_tenants?.length > 0) setCommercialTenants(uw.commercial_tenants);
      if (uw.unit_groups?.length > 0) setUnitGroups(uw.unit_groups);

      // Build zoning inputs from UW data
      const si = uw.site_info || {};
      const landSF = si.land_sf || (d?.land_acres || 0) * 43560;
      let heightFt = 0;
      const hl = uw.zoning_info?.height_limits || [];
      for (const h of hl) {
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
      setDensityBonuses(uw.zoning_info?.density_bonuses || []);
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

      const merged = {
        ...current,
        building_program: buildingProgram,
        other_income_items: otherIncomeItems,
        commercial_tenants: commercialTenants,
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
  }, [params.id, buildingProgram, otherIncomeItems, commercialTenants]);

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
      const newUnitGroups = mix.length > 0
        ? mix.map((m: any) => ({
            id: uuidv4(), label: m.type_label,
            unit_count: Math.round(totalU * (m.allocation_pct / 100)),
            renovation_count: 0, renovation_cost_per_unit: 0,
            unit_change: "none", unit_change_count: 0,
            bedrooms: m.type_label.includes("Studio") ? 0 : m.type_label.includes("3") ? 3 : m.type_label.includes("2") ? 2 : 1,
            bathrooms: m.type_label.includes("3") ? 2 : 1, sf_per_unit: m.avg_sf,
            current_rent_per_sf: 0, market_rent_per_sf: 0, lease_type: "NNN", expense_reimbursement_per_sf: 0,
            current_rent_per_unit: 0, market_rent_per_unit: 0,
            beds_per_unit: 1, current_rent_per_bed: 0, market_rent_per_bed: 0,
          }))
        : current.unit_groups || [];

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
        // Parking
        parking_reserved_spaces: parkingSpaces,
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
    } catch {
      toast.error("Failed to push to underwriting");
    }
  }, [params.id, zoningInputs, buildingProgram, otherIncomeItems, commercialTenants]);

  if (loading) return <div className="flex items-center justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  // Compute summary for active scenario
  const activeScenario = buildingProgram.scenarios.find(s => s.id === buildingProgram.active_scenario_id) || buildingProgram.scenarios[0];
  const summary = activeScenario ? computeMassingSummary(activeScenario, zoningInputs) : null;
  const totalUnits = unitGroups.reduce((s: number, g: any) => s + (g.unit_count || 0), 0) || summary?.total_units || 0;

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

      {/* ═══════════════════ BUILDING MASSING ═══════════════════ */}
      <Section title="Building Massing" icon={<Layers className="h-4 w-4 text-blue-400" />}>
        <MassingSection
          program={buildingProgram}
          onChange={p => { setBuildingProgram(p); setDirty(true); }}
          zoning={zoningInputs}
          densityBonuses={densityBonuses}
          onPushBaseline={pushToUW}
          onPushScenario={pushToUW}
        />
      </Section>

      {/* ═══════════════════ COMMERCIAL TENANTS ═══════════════════ */}
      <Section title="Commercial Tenants" icon={<Building2 className="h-4 w-4 text-amber-400" />} defaultOpen={commercialTenants.length > 0}>
        <p className="text-xs text-muted-foreground mb-3">Retail, office, and restaurant tenants with lease-specific terms. These roll up into the combined GPR on the underwriting page.</p>
        {commercialTenants.length > 0 && (
          <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse mb-3 min-w-[700px]">
            <thead>
              <tr className="bg-muted/30 border-b">
                <th className="text-left px-2 py-1.5 text-xs font-medium text-muted-foreground">Tenant / Suite</th>
                <th className="text-left px-2 py-1.5 text-xs font-medium text-muted-foreground w-[70px]">Use</th>
                <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[70px]">SF</th>
                <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[75px]">$/SF</th>
                <th className="text-center px-2 py-1.5 text-xs font-medium text-muted-foreground w-[60px]">Lease</th>
                <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[70px]">TI/SF</th>
                <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[55px]">LC%</th>
                <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[55px]">Free</th>
                <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[55px]">Esc%</th>
                <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[80px]">Annual</th>
                <th className="w-[24px]" />
              </tr>
            </thead>
            <tbody>
              {commercialTenants.map(t => {
                const upd = (u: Partial<CommercialTenant>) => { setCommercialTenants(prev => prev.map(ct => ct.id === t.id ? { ...ct, ...u } : ct)); setDirty(true); };
                return (
                  <tr key={t.id} className="border-b hover:bg-muted/10 group">
                    <td className="px-2 py-1.5">
                      <input type="text" value={t.tenant_name} onChange={e => upd({ tenant_name: e.target.value })} placeholder="Tenant name" className="w-full bg-transparent text-sm outline-none" />
                      <input type="text" value={t.suite} onChange={e => upd({ suite: e.target.value })} placeholder="Suite #" className="w-full bg-transparent text-[10px] text-muted-foreground outline-none" />
                    </td>
                    <td className="px-2 py-1.5">
                      <select value={t.use_type} onChange={e => upd({ use_type: e.target.value as any })} className="bg-background text-foreground text-xs outline-none w-full rounded border border-border/40">
                        <option value="retail">Retail</option>
                        <option value="office">Office</option>
                        <option value="restaurant">Restaurant</option>
                        <option value="other">Other</option>
                      </select>
                    </td>
                    <td className="px-2 py-1.5"><input type="number" value={t.sf || ""} onChange={e => upd({ sf: parseFloat(e.target.value) || 0 })} className="w-full bg-transparent text-sm outline-none text-right tabular-nums" /></td>
                    <td className="px-2 py-1.5"><input type="number" step="0.01" value={t.rent_per_sf || ""} onChange={e => upd({ rent_per_sf: parseFloat(e.target.value) || 0 })} className="w-full bg-transparent text-sm outline-none text-right tabular-nums" /></td>
                    <td className="px-2 py-1.5">
                      <select value={t.lease_type} onChange={e => upd({ lease_type: e.target.value as CommercialLeaseType })} className="bg-background text-foreground text-xs outline-none w-full rounded border border-border/40">
                        <option value="NNN">NNN</option>
                        <option value="MG">MG</option>
                        <option value="Gross">Gross</option>
                        <option value="Modified Gross">Mod G</option>
                      </select>
                    </td>
                    <td className="px-2 py-1.5"><input type="number" step="0.01" value={t.ti_allowance_per_sf || ""} onChange={e => upd({ ti_allowance_per_sf: parseFloat(e.target.value) || 0 })} className="w-full bg-transparent text-sm outline-none text-right tabular-nums" /></td>
                    <td className="px-2 py-1.5"><input type="number" step="0.1" value={t.lc_pct || ""} onChange={e => upd({ lc_pct: parseFloat(e.target.value) || 0 })} className="w-full bg-transparent text-sm outline-none text-right tabular-nums" /></td>
                    <td className="px-2 py-1.5"><input type="number" value={t.free_rent_months || ""} onChange={e => upd({ free_rent_months: parseFloat(e.target.value) || 0 })} className="w-full bg-transparent text-sm outline-none text-right tabular-nums" /></td>
                    <td className="px-2 py-1.5"><input type="number" step="0.1" value={t.rent_escalation_pct || ""} onChange={e => upd({ rent_escalation_pct: parseFloat(e.target.value) || 0 })} className="w-full bg-transparent text-sm outline-none text-right tabular-nums" /></td>
                    <td className="px-2 py-1.5 text-right tabular-nums font-medium text-sm">{fc(t.sf * t.rent_per_sf)}</td>
                    <td className="px-1 py-1.5">
                      <button onClick={() => { setCommercialTenants(prev => prev.filter(ct => ct.id !== t.id)); setDirty(true); }} className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100"><Trash2 className="h-3.5 w-3.5" /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t bg-muted/20 font-semibold">
                <td className="px-2 py-2">Total</td>
                <td />
                <td className="px-2 py-2 text-right tabular-nums">{fn(commercialSF)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{commercialSF > 0 ? `$${(commercialGPR / commercialSF).toFixed(2)}` : "—"}</td>
                <td colSpan={5} />
                <td className="px-2 py-2 text-right tabular-nums">{fc(commercialGPR)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
          </div>
        )}
        <Button variant="ghost" size="sm" onClick={() => {
          setCommercialTenants(prev => [...prev, {
            id: uuidv4(), tenant_name: "", suite: "", use_type: "retail", sf: 0,
            rent_per_sf: 0, lease_type: "NNN", cam_reimbursement_pct: 100,
            ti_allowance_per_sf: 0, lc_pct: 6, free_rent_months: 0, rent_escalation_pct: 3,
            lease_start: "", lease_term_years: 10, notes: "",
          }]);
          setDirty(true);
        }}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Add Tenant
        </Button>
      </Section>

      {/* ═══════════════════ OTHER INCOME ═══════════════════ */}
      <Section title="Other Income" icon={<DollarSign className="h-4 w-4 text-green-400" />}>
        <p className="text-xs text-muted-foreground mb-3">Ancillary income sources. Per-unit items multiply by total residential units ({fn(totalUnits)}). Per-space items multiply by parking spaces ({fn(summary?.total_parking_spaces_est || 0)}).</p>
        <table className="w-full text-sm border-collapse mb-3">
          <thead>
            <tr className="bg-muted/30 border-b">
              <th className="text-left px-2 py-1.5 text-xs font-medium text-muted-foreground">Income Source</th>
              <th className="text-center px-2 py-1.5 text-xs font-medium text-muted-foreground w-[110px]">Basis</th>
              <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[90px]">$/Month</th>
              <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[90px]">Annual</th>
              <th className="w-[24px]" />
            </tr>
          </thead>
          <tbody>
            {otherIncomeItems.map(item => {
              const upd = (u: Partial<OtherIncomeItem>) => { setOtherIncomeItems(prev => prev.map(i => i.id === item.id ? { ...i, ...u } : i)); setDirty(true); };
              const multiplier = item.basis === "per_unit" ? totalUnits : item.basis === "per_space" ? (summary?.total_parking_spaces_est || 0) : 1;
              const annual = item.amount * multiplier * 12;
              return (
                <tr key={item.id} className="border-b hover:bg-muted/10 group">
                  <td className="px-2 py-1.5">
                    <input type="text" value={item.label} onChange={e => upd({ label: e.target.value })} className="w-full bg-transparent text-sm outline-none" />
                  </td>
                  <td className="px-2 py-1.5">
                    <select value={item.basis} onChange={e => upd({ basis: e.target.value as any })} className="w-full bg-background text-foreground text-xs outline-none rounded border border-border/40">
                      <option value="per_unit">Per Unit</option>
                      <option value="per_property">Per Property</option>
                      <option value="per_space">Per Space</option>
                    </select>
                  </td>
                  <td className="px-2 py-1.5">
                    <input type="number" value={item.amount || ""} onChange={e => upd({ amount: parseFloat(e.target.value) || 0 })} className="w-full bg-transparent text-sm outline-none text-right tabular-nums" placeholder="0" />
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-medium">{fc(annual)}</td>
                  <td className="px-1 py-1.5">
                    <button onClick={() => { setOtherIncomeItems(prev => prev.filter(i => i.id !== item.id)); setDirty(true); }} className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100"><Trash2 className="h-3.5 w-3.5" /></button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t bg-muted/20 font-semibold">
              <td colSpan={3} className="px-2 py-2 text-right">Total Annual Other Income</td>
              <td className="px-2 py-2 text-right tabular-nums">{fc(otherIncomeAnnual)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
        <div className="flex gap-2 flex-wrap">
          <Button variant="ghost" size="sm" onClick={() => {
            setOtherIncomeItems(prev => [...prev, { id: uuidv4(), label: "New Item", amount: 0, basis: "per_unit", unit_type_filter: "", notes: "" }]);
            setDirty(true);
          }}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Add Item
          </Button>
          {otherIncomeItems.length === 0 && (
            <Button variant="outline" size="sm" onClick={() => {
              const items = COMMON_OTHER_INCOME.filter(c => c.amount > 0).map(c => ({
                id: uuidv4(), label: c.label, amount: c.amount, basis: c.basis, unit_type_filter: "", notes: "",
              }));
              setOtherIncomeItems(items);
              setDirty(true);
            }}>
              <Sparkles className="h-3.5 w-3.5 mr-1" /> Seed Common Items
            </Button>
          )}
        </div>
      </Section>
    </div>
  );
}
