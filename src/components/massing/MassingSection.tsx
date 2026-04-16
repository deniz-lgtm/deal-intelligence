"use client";

import React, { useState, useCallback } from "react";
import { v4 as uuidv4 } from "uuid";
import {
  Plus, Trash2, ChevronDown, AlertTriangle, Check, Sparkles, Lock,
} from "lucide-react";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { BuildingFloor, BuildingProgram, MassingScenario, FloorUseType, UnitMixEntry } from "@/lib/types";
import {
  newFloor, computeMassingSummary, autoLabelFloors, seedUnitMix,
  quickStackPodium5over1, quickStackMidRise3over2, quickStackHighRise, quickStackGardenStyle, quickStackAutoFromZoning,
} from "./massing-utils";
import type { ZoningInputs } from "./massing-utils";
import FloorRow from "./FloorRow";
import MassingSectionCut from "./MassingSectionCut";

const fc = (n: number) => n || n === 0 ? "$" + Math.round(n).toLocaleString("en-US") : "—";
const fn = (n: number) => n || n === 0 ? Math.round(n).toLocaleString("en-US") : "—";

interface DensityBonusOption {
  source: string;
  description: string;
  additional_density: string;
}

interface Props {
  program: BuildingProgram;
  onChange: (program: BuildingProgram) => void;
  zoning: ZoningInputs;
  densityBonuses?: DensityBonusOption[];
  // When true, the Base Footprint input is shown read-only (sourced from
  // the Site Plan). Programming sets this whenever the active scenario
  // is linked to a site-plan building; analysts must edit the footprint
  // there, not here.
  footprintReadOnly?: boolean;
  // Optional building label shown next to the read-only footprint input
  // so the analyst sees "Building 2 · 12,500 SF (from Site Plan)" rather
  // than just a number with no context.
  activeBuildingLabel?: string | null;
}

export default function MassingSection({
  program, onChange, zoning, densityBonuses = [], footprintReadOnly = false, activeBuildingLabel = null,
}: Props) {
  const [quickStackOpen, setQuickStackOpen] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const activeScenarioRaw = program.scenarios.find(s => s.id === program.active_scenario_id) || program.scenarios[0];
  if (!activeScenarioRaw) return null;
  // Defensive normalization — legacy rows that pre-date the Massings
  // refactor sometimes lack floors/unit_mix as arrays. Treating them as
  // arrays crashes the render; treating them as missing shows an empty
  // editor which the analyst can fill.
  const activeScenario: typeof activeScenarioRaw = {
    ...activeScenarioRaw,
    floors: Array.isArray(activeScenarioRaw.floors) ? activeScenarioRaw.floors : [],
    unit_mix: Array.isArray(activeScenarioRaw.unit_mix) ? activeScenarioRaw.unit_mix : [],
  };

  const summary = computeMassingSummary(activeScenario, zoning);

  const updateScenario = useCallback((id: string, updater: (s: MassingScenario) => MassingScenario) => {
    onChange({
      ...program,
      scenarios: program.scenarios.map(s => s.id === id ? updater(s) : s),
    });
  }, [program, onChange]);

  const updateActiveFloors = useCallback((floors: BuildingFloor[]) => {
    // Manual floor edits supersede the AI template, so clear the badge.
    // Re-applying a preset will set it again.
    updateScenario(activeScenario.id, s => ({
      ...s,
      floors: autoLabelFloors(floors),
      ai_template_label: null,
    }));
  }, [activeScenario.id, updateScenario]);

  const updateFloor = useCallback((floorId: string, updates: Partial<BuildingFloor>) => {
    updateActiveFloors(activeScenario.floors.map(f => f.id === floorId ? { ...f, ...updates } : f));
  }, [activeScenario.floors, updateActiveFloors]);

  const deleteFloor = useCallback((floorId: string) => {
    updateActiveFloors(activeScenario.floors.filter(f => f.id !== floorId));
  }, [activeScenario.floors, updateActiveFloors]);

  const addFloor = useCallback((is_below_grade: boolean) => {
    const f = newFloor(is_below_grade ? "parking" : "residential", activeScenario.footprint_sf || 10000, undefined, is_below_grade, is_below_grade ? 0 : 0);
    const floors = [...activeScenario.floors, { ...f, sort_order: activeScenario.floors.length }];
    updateActiveFloors(floors);
  }, [activeScenario, updateActiveFloors]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = activeScenario.floors.findIndex(f => f.id === active.id);
    const newIdx = activeScenario.floors.findIndex(f => f.id === over.id);
    const reordered = arrayMove(activeScenario.floors, oldIdx, newIdx).map((f, i) => ({ ...f, sort_order: i }));
    updateActiveFloors(reordered);
  }, [activeScenario.floors, updateActiveFloors]);

  const applyQuickStack = useCallback((floors: BuildingFloor[], templateLabel: string) => {
    const fp = Math.max(...floors.map(f => f.floor_plate_sf), 0);
    updateScenario(activeScenario.id, s => ({
      ...s,
      floors: floors.map((f, i) => ({ ...f, sort_order: i })),
      footprint_sf: fp,
      ai_template_label: templateLabel,
    }));
    setQuickStackOpen(false);
    toast.success(`AI generated: ${templateLabel}`);
  }, [activeScenario.id, updateScenario]);

  // Scenario add / duplicate / delete / baseline live on the page now
  // (driven by site_plan.scenarios). MassingSection only edits the
  // active row.

  // Display above-grade floors top-down (highest floor first in list, ground floor last = closest to grade)
  const aboveFloors = activeScenario.floors.filter(f => !f.is_below_grade).sort((a, b) => b.sort_order - a.sort_order);
  const belowFloors = activeScenario.floors.filter(f => f.is_below_grade).sort((a, b) => a.sort_order - b.sort_order);

  return (
    <div className="space-y-4">
      {/* ── Toolbar ──
          Massing/building selection is handled at the page level (driven
          by the site plan), so this row is just the AI Generate
          control. The yellow accent flags it as the "press me next" CTA
          for empty scenarios. */}
      <div className="flex items-center gap-1 flex-wrap">
        <div className="relative ml-0">
          {/* AI Generate dropdown — yellow-accented to flag it as the
              "press me next" call-to-action when a scenario has just
              been created. After a preset is applied the button shows
              "AI: <template>" so the analyst sees what produced the
              current stack. Manual floor edits clear the badge so the
              label only shows when the AI output is still authoritative. */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setQuickStackOpen(!quickStackOpen)}
            className="text-xs h-7 border-amber-500/50 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20 hover:border-amber-500/70"
          >
            <Sparkles className="h-3 w-3 mr-1" />
            {activeScenario.ai_template_label
              ? `AI: ${activeScenario.ai_template_label}`
              : "AI Generate"}
            <ChevronDown className="h-3 w-3 ml-1" />
          </Button>
          {quickStackOpen && (
            <div className="absolute top-8 left-0 z-50 bg-card border rounded-md shadow-lg py-1 min-w-[260px]">
              {[
                { label: "Podium 5-over-1", fn: () => quickStackPodium5over1(zoning.land_sf, zoning.lot_coverage_pct || 50) },
                { label: "Mid-Rise 3-over-2", fn: () => quickStackMidRise3over2(zoning.land_sf, zoning.lot_coverage_pct || 50) },
                { label: "High-Rise Mixed Use", fn: () => quickStackHighRise(zoning.land_sf, zoning.lot_coverage_pct || 50) },
                { label: "Garden-Style Walk-Up", fn: () => quickStackGardenStyle(zoning.land_sf, zoning.lot_coverage_pct || 50) },
                { label: "Auto from Zoning", fn: () => quickStackAutoFromZoning(zoning.land_sf, zoning.far, zoning.lot_coverage_pct || 50, zoning.height_limit_ft) },
              ].map(preset => {
                const isCurrent = preset.label === activeScenario.ai_template_label;
                return (
                  <button
                    key={preset.label}
                    onClick={() => applyQuickStack(preset.fn(), preset.label)}
                    className={`w-full text-left px-3 py-2 text-xs hover:bg-muted/50 ${
                      isCurrent ? "text-amber-300 bg-amber-500/5" : ""
                    }`}
                  >
                    {preset.label}{isCurrent ? "  ·  current" : ""}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Zoning Compliance Banner ── */}
      <div className="flex items-center gap-3 text-xs">
        {summary.max_allowed_height_ft > 0 && (
          <span className={`flex items-center gap-1 px-2 py-1 rounded ${summary.height_compliant ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"}`}>
            {summary.height_compliant ? <Check className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
            Height: {summary.total_height_ft.toFixed(0)}/{summary.max_allowed_height_ft.toFixed(0)}ft
          </span>
        )}
        {summary.max_allowed_far > 0 && (
          <span className={`flex items-center gap-1 px-2 py-1 rounded ${summary.far_compliant ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"}`}>
            {summary.far_compliant ? <Check className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
            FAR: {summary.effective_far.toFixed(2)}/{summary.max_allowed_far.toFixed(2)}
          </span>
        )}
        {zoning.lot_coverage_pct > 0 && (
          <span className={`flex items-center gap-1 px-2 py-1 rounded ${summary.lot_coverage_compliant ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"}`}>
            {summary.lot_coverage_compliant ? <Check className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
            Coverage: {summary.effective_lot_coverage_pct.toFixed(0)}/{zoning.lot_coverage_pct}%
          </span>
        )}
      </div>

      {/* ── Unit Mix Allocation ── (moved above the floor editor so the
          analyst sets the residential program first; the floor editor's
          per-floor unit counts auto-distribute from the mix totals) */}
      {summary.total_units > 0 || (summary.nrsf_by_use.residential || 0) > 0 ? (() => {
        const mix = activeScenario.unit_mix || [];
        const resNRSF = summary.nrsf_by_use.residential || 0;
        const totalAllocPct = mix.reduce((s, m) => s + m.allocation_pct, 0);
        const weightedAvgSF = mix.length > 0
          ? mix.reduce((s, m) => s + m.avg_sf * (m.allocation_pct / 100), 0)
          : 0;
        const totalUnitsFromMix = weightedAvgSF > 0 ? Math.floor(resNRSF / weightedAvgSF) : 0;

        const updMix = (id: string, upd: Partial<UnitMixEntry>) => {
          updateScenario(activeScenario.id, s => ({
            ...s,
            unit_mix: (s.unit_mix || []).map(m => m.id === id ? { ...m, ...upd } : m),
          }));
        };
        const addMixType = () => {
          updateScenario(activeScenario.id, s => ({
            ...s,
            unit_mix: [...(s.unit_mix || []), { id: uuidv4(), type_label: "New Type", allocation_pct: 0, avg_sf: 600 }],
          }));
        };
        const delMixType = (id: string) => {
          updateScenario(activeScenario.id, s => ({
            ...s,
            unit_mix: (s.unit_mix || []).filter(m => m.id !== id),
          }));
        };

        return (
          <div className="border border-border/40 rounded-lg p-3 bg-muted/5">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Unit Mix Allocation</h4>
            <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse mb-2 min-w-[480px]">
              <thead>
                <tr className="bg-muted/30 border-b">
                  <th className="text-left px-2 py-1.5 text-xs font-medium text-muted-foreground">Unit Type</th>
                  <th className="text-center px-2 py-1.5 text-xs font-medium text-muted-foreground w-[80px]">Allocation</th>
                  <th className="text-center px-2 py-1.5 text-xs font-medium text-muted-foreground w-[80px]">Avg SF</th>
                  <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[70px]">Units</th>
                  <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[80px]">Total SF</th>
                  <th className="w-[24px]" />
                </tr>
              </thead>
              <tbody>
                {mix.map(m => {
                  const unitCount = totalUnitsFromMix > 0 ? Math.round(totalUnitsFromMix * (m.allocation_pct / 100)) : 0;
                  const totalSF = unitCount * m.avg_sf;
                  return (
                    <tr key={m.id} className="border-b hover:bg-muted/10 group">
                      <td className="px-2 py-1.5">
                        <input type="text" value={m.type_label} onChange={e => updMix(m.id, { type_label: e.target.value })} className="bg-transparent text-xs outline-none w-full font-medium" />
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="flex items-center justify-center border rounded bg-background overflow-hidden w-[70px] mx-auto">
                          <input type="text" inputMode="decimal" value={m.allocation_pct || ""}
                            onChange={e => updMix(m.id, { allocation_pct: parseFloat(e.target.value) || 0 })}
                            className="w-full px-1.5 py-1 text-xs outline-none bg-transparent text-blue-300 tabular-nums text-center" placeholder="0" />
                          <span className="px-1 text-xs text-muted-foreground bg-muted border-l">%</span>
                        </div>
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="flex items-center justify-center border rounded bg-background overflow-hidden w-[70px] mx-auto">
                          <input type="text" inputMode="decimal" value={m.avg_sf || ""}
                            onChange={e => updMix(m.id, { avg_sf: parseFloat(e.target.value) || 0 })}
                            className="w-full px-1.5 py-1 text-xs outline-none bg-transparent text-blue-300 tabular-nums text-center" placeholder="0" />
                        </div>
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums font-medium">{unitCount}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">{totalSF.toLocaleString()}</td>
                      <td className="px-1 py-1.5">
                        <button onClick={() => delMixType(m.id)} className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100"><Trash2 className="h-3 w-3" /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t bg-muted/20 font-semibold text-xs">
                  <td className="px-2 py-1.5">Total</td>
                  <td className={`px-2 py-1.5 text-center tabular-nums ${Math.abs(totalAllocPct - 100) > 0.1 ? "text-red-400" : "text-emerald-400"}`}>{totalAllocPct.toFixed(0)}%</td>
                  <td className="px-2 py-1.5 text-center tabular-nums text-muted-foreground">{weightedAvgSF > 0 ? Math.round(weightedAvgSF) : "—"}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{totalUnitsFromMix}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fn(resNRSF)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
            </div>
            {Math.abs(totalAllocPct - 100) > 0.1 && <p className="text-xs text-red-400 mb-1">Allocation must equal 100% (currently {totalAllocPct.toFixed(0)}%)</p>}
            <div className="flex gap-2 flex-wrap">
              <Button variant="ghost" size="sm" className="text-xs" onClick={addMixType}>
                <Plus className="h-3 w-3 mr-1" /> Add Unit Type
              </Button>
              {mix.length === 0 && (
                <Button variant="ghost" size="sm" className="text-xs" onClick={() => updateScenario(activeScenario.id, s => ({ ...s, unit_mix: seedUnitMix() }))}>
                  Seed Default Mix
                </Button>
              )}
              {totalUnitsFromMix > 0 && (
                <Button variant="outline" size="sm" className="text-xs" onClick={() => {
                  const resFloors = activeScenario.floors.filter(f => !f.is_below_grade && f.use_type === "residential");
                  if (resFloors.length === 0) return;
                  const unitsPerFloor = Math.floor(totalUnitsFromMix / resFloors.length);
                  const remainder = totalUnitsFromMix - unitsPerFloor * resFloors.length;
                  const updatedFloors = activeScenario.floors.map(f => {
                    if (f.use_type !== "residential" || f.is_below_grade) return f;
                    const idx = resFloors.findIndex(rf => rf.id === f.id);
                    return { ...f, units_on_floor: unitsPerFloor + (idx < remainder ? 1 : 0) };
                  });
                  updateActiveFloors(updatedFloors);
                  toast.success(`Distributed ${totalUnitsFromMix} units across ${resFloors.length} floors`);
                }}>
                  Auto-distribute {totalUnitsFromMix} units to floors
                </Button>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">Units computed from residential NRSF ({fn(resNRSF)} SF) ÷ weighted avg unit size ({Math.round(weightedAvgSF)} SF)</p>
          </div>
        );
      })() : null}

      {/* ── Split Layout: Editor + Section Cut ── */}
      <div className="flex flex-col lg:flex-row gap-4">
        {/* LEFT — Floor Editor */}
        <div className="flex-1 min-w-0">
          {/* Footprint + Density Bonus */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1 flex items-center justify-between gap-2">
                <span>Base Footprint (SF)</span>
                {footprintReadOnly && (
                  <span
                    className="inline-flex items-center gap-1 text-[9px] font-semibold tracking-wide uppercase text-amber-300"
                    title="Footprint is sourced from the Site Plan — go to Site & Zoning to resize the building."
                  >
                    <Lock className="h-2.5 w-2.5" /> from Site Plan
                  </span>
                )}
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={activeScenario.footprint_sf || ""}
                onChange={(e) => {
                  if (footprintReadOnly) return;
                  updateScenario(activeScenario.id, (s) => ({
                    ...s,
                    footprint_sf: parseFloat(e.target.value.replace(/,/g, "")) || 0,
                  }));
                }}
                readOnly={footprintReadOnly}
                disabled={footprintReadOnly}
                className={`w-full border rounded-md px-2 py-1.5 text-sm outline-none tabular-nums ${
                  footprintReadOnly
                    ? "bg-muted/30 text-muted-foreground cursor-not-allowed"
                    : "bg-background"
                }`}
                placeholder="0"
              />
              {footprintReadOnly && activeBuildingLabel && (
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {activeBuildingLabel} · edit the footprint on the Site Plan
                </p>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Parking SF / Space</label>
              <input type="text" inputMode="decimal"
                value={activeScenario.parking_sf_per_space || 350}
                onChange={e => updateScenario(activeScenario.id, s => ({ ...s, parking_sf_per_space: parseFloat(e.target.value) || 350 }))}
                className="w-full border rounded-md px-2 py-1.5 text-sm bg-background outline-none tabular-nums"
                placeholder="350" />
              <p className="text-[10px] text-muted-foreground mt-0.5">Surface ~325 · Structured ~350 · Underground ~375</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Density Bonus (from Zoning)</label>
              <select
                value={activeScenario.density_bonus_applied || ""}
                onChange={e => {
                  const val = e.target.value;
                  if (!val) {
                    updateScenario(activeScenario.id, s => ({ ...s, density_bonus_applied: null, density_bonus_far_increase: 0, density_bonus_height_increase_ft: 0 }));
                  } else {
                    const bonus = densityBonuses.find(b => b.source === val);
                    // Try to parse FAR increase from additional_density (e.g. "+35%" or "+0.5 FAR")
                    const pctMatch = bonus?.additional_density?.match(/\+?(\d+(?:\.\d+)?)\s*%/);
                    const farIncrease = pctMatch ? parseFloat(pctMatch[1]) / 100 : 0;
                    updateScenario(activeScenario.id, s => ({ ...s, density_bonus_applied: val, density_bonus_far_increase: farIncrease }));
                  }
                }}
                className="w-full border rounded-md px-2 py-1.5 text-sm bg-background text-foreground outline-none"
              >
                <option value="" className="bg-background text-foreground">None</option>
                {densityBonuses.map((b, i) => (
                  <option key={i} value={b.source} className="bg-background text-foreground">{b.source} — {b.description} ({b.additional_density})</option>
                ))}
                <option value="__custom" className="bg-background text-foreground">Custom...</option>
              </select>
              {activeScenario.density_bonus_applied === "__custom" && (
                <div className="flex gap-2 mt-1">
                  <input type="text" value="" onChange={e => updateScenario(activeScenario.id, s => ({ ...s, density_bonus_applied: e.target.value || null }))}
                    className="flex-1 border rounded-md px-2 py-1.5 text-sm bg-background outline-none" placeholder="Bonus name" />
                  <input type="text" inputMode="decimal" value={activeScenario.density_bonus_far_increase || ""}
                    onChange={e => updateScenario(activeScenario.id, s => ({ ...s, density_bonus_far_increase: parseFloat(e.target.value) || 0 }))}
                    className="w-[70px] border rounded-md px-2 py-1.5 text-sm bg-background outline-none" placeholder="+FAR" />
                </div>
              )}
              {activeScenario.density_bonus_applied && activeScenario.density_bonus_applied !== "__custom" && activeScenario.density_bonus_far_increase > 0 && (
                <p className="text-[10px] text-emerald-400 mt-1">+{(activeScenario.density_bonus_far_increase * 100).toFixed(0)}% FAR increase applied</p>
              )}
            </div>
          </div>

          {/* Above Grade Floors */}
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Above Grade</h4>
          <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse mb-2 min-w-[580px]">
            <thead>
              <tr className="bg-muted/30 border-b">
                <th className="w-[24px]" />
                <th className="text-center px-1 py-1 text-xs font-medium text-muted-foreground w-[32px]">#</th>
                <th className="text-left px-1 py-1 text-xs font-medium text-muted-foreground">Use</th>
                <th className="text-left px-1 py-1 text-xs font-medium text-muted-foreground w-[85px]">Plate SF</th>
                <th className="text-left px-1 py-1 text-xs font-medium text-muted-foreground w-[65px]">F-t-F</th>
                <th className="text-left px-1 py-1 text-xs font-medium text-muted-foreground w-[50px]">Units</th>
                <th className="text-left px-1 py-1 text-xs font-medium text-muted-foreground w-[50px]">Eff%</th>
                <th className="text-right px-1 py-1 text-xs font-medium text-muted-foreground w-[65px]">NRSF</th>
                <th className="w-[24px]" />
              </tr>
            </thead>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={aboveFloors.map(f => f.id)} strategy={verticalListSortingStrategy}>
                <tbody>
                  {aboveFloors.map(f => (
                    <FloorRow key={f.id} floor={f} onChange={upd => updateFloor(f.id, upd)} onDelete={() => deleteFloor(f.id)} />
                  ))}
                </tbody>
              </SortableContext>
            </DndContext>
          </table>
          </div>
          <Button variant="ghost" size="sm" className="text-xs mb-3" onClick={() => addFloor(false)}>
            <Plus className="h-3 w-3 mr-1" /> Add Floor
          </Button>

          {/* Grade Divider */}
          <div className="flex items-center gap-2 my-2">
            <div className="flex-1 h-px bg-emerald-500/50" />
            <span className="text-[10px] text-emerald-500 font-semibold uppercase tracking-widest">Grade</span>
            <div className="flex-1 h-px bg-emerald-500/50" />
          </div>

          {/* Below Grade Floors */}
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Below Grade</h4>
          <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse mb-2 min-w-[580px]">
            <thead>
              <tr className="bg-muted/30 border-b">
                <th className="w-[24px]" />
                <th className="text-center px-1 py-1 text-xs font-medium text-muted-foreground w-[32px]">#</th>
                <th className="text-left px-1 py-1 text-xs font-medium text-muted-foreground">Use</th>
                <th className="text-left px-1 py-1 text-xs font-medium text-muted-foreground w-[85px]">Plate SF</th>
                <th className="text-left px-1 py-1 text-xs font-medium text-muted-foreground w-[65px]">F-t-F</th>
                <th className="text-left px-1 py-1 text-xs font-medium text-muted-foreground w-[50px]">Units</th>
                <th className="text-left px-1 py-1 text-xs font-medium text-muted-foreground w-[50px]">Eff%</th>
                <th className="text-right px-1 py-1 text-xs font-medium text-muted-foreground w-[65px]">NRSF</th>
                <th className="w-[24px]" />
              </tr>
            </thead>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={belowFloors.map(f => f.id)} strategy={verticalListSortingStrategy}>
                <tbody>
                  {belowFloors.map(f => (
                    <FloorRow key={f.id} floor={f} onChange={upd => updateFloor(f.id, upd)} onDelete={() => deleteFloor(f.id)} />
                  ))}
                </tbody>
              </SortableContext>
            </DndContext>
          </table>
          </div>
          <Button variant="ghost" size="sm" className="text-xs mb-3" onClick={() => addFloor(true)}>
            <Plus className="h-3 w-3 mr-1" /> Add Below Grade
          </Button>

          {/* Summary */}
          <div className="border rounded-md bg-muted/10 p-3 text-sm space-y-1">
            <div className="flex justify-between"><span>Total GSF</span><span className="font-semibold tabular-nums">{fn(summary.total_gsf)}</span></div>
            <div className="flex justify-between"><span>Total NRSF</span><span className="font-semibold tabular-nums">{fn(summary.total_nrsf)}</span></div>
            <div className="flex justify-between"><span>Residential Units</span><span className="font-semibold tabular-nums">{fn(summary.total_units)}</span></div>
            <div className="flex justify-between"><span>Est. Parking Spaces</span><span className="font-semibold tabular-nums">{fn(summary.total_parking_spaces_est)} <span className="text-muted-foreground text-xs">(@ {activeScenario.parking_sf_per_space || 350} SF/space)</span></span></div>
            <div className="flex justify-between"><span>Building Height</span><span className="font-semibold tabular-nums">{Math.round(summary.total_height_ft).toLocaleString()} ft ({summary.above_grade_floors} floors)</span></div>
            {summary.below_grade_floors > 0 && <div className="flex justify-between"><span>Below Grade</span><span className="font-semibold tabular-nums">{Math.round(summary.total_below_grade_ft).toLocaleString()} ft ({summary.below_grade_floors} levels)</span></div>}
            <div className="flex justify-between"><span>Effective FAR</span><span className="font-semibold tabular-nums">{summary.effective_far.toFixed(2)}</span></div>
          </div>
        </div>

        {/* RIGHT — Section Cut SVG */}
        <div className="w-full lg:w-96 xl:w-[28rem] shrink-0 lg:sticky lg:top-4 lg:self-start">
          <div className="border rounded-md bg-card/50 p-2">
            <MassingSectionCut scenario={activeScenario} summary={summary} />
          </div>
        </div>
      </div>

      {/* The "Push <Massing> to UW" button now lives in the page header
          (Programming pushes the whole massing — all building stacks —
          and snapshots it as a UW Scenario in one action). No per-stack
          push button here anymore. */}
    </div>
  );
}
