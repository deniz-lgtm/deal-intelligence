"use client";

import React, { useState, useCallback } from "react";
import { v4 as uuidv4 } from "uuid";
import {
  Plus, Star, Copy, Trash2, ChevronDown, Layers, AlertTriangle, Check, MoreVertical,
} from "lucide-react";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { BuildingFloor, BuildingProgram, MassingScenario, FloorUseType } from "@/lib/types";
import {
  newFloor, newScenario, newBuildingProgram, computeMassingSummary, autoLabelFloors,
  quickStackPodium5over1, quickStackMidRise3over2, quickStackHighRise, quickStackGardenStyle, quickStackAutoFromZoning,
} from "./massing-utils";
import type { ZoningInputs } from "./massing-utils";
import FloorRow from "./FloorRow";
import MassingSectionCut from "./MassingSectionCut";

const fc = (n: number) => n || n === 0 ? "$" + Math.round(n).toLocaleString("en-US") : "—";
const fn = (n: number) => n || n === 0 ? Math.round(n).toLocaleString("en-US") : "—";

interface Props {
  program: BuildingProgram;
  onChange: (program: BuildingProgram) => void;
  zoning: ZoningInputs;
  onPushBaseline: (scenario: MassingScenario) => void;
  onPushScenario: (scenario: MassingScenario) => void;
}

export default function MassingSection({ program, onChange, zoning, onPushBaseline, onPushScenario }: Props) {
  const [quickStackOpen, setQuickStackOpen] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateTransformations: sortableKeyboardCoordinates }),
  );

  const activeScenario = program.scenarios.find(s => s.id === program.active_scenario_id) || program.scenarios[0];
  if (!activeScenario) return null;

  const summary = computeMassingSummary(activeScenario, zoning);

  const updateScenario = useCallback((id: string, updater: (s: MassingScenario) => MassingScenario) => {
    onChange({
      ...program,
      scenarios: program.scenarios.map(s => s.id === id ? updater(s) : s),
    });
  }, [program, onChange]);

  const updateActiveFloors = useCallback((floors: BuildingFloor[]) => {
    updateScenario(activeScenario.id, s => ({ ...s, floors: autoLabelFloors(floors) }));
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

  const applyQuickStack = useCallback((floors: BuildingFloor[]) => {
    const fp = Math.max(...floors.map(f => f.floor_plate_sf), 0);
    updateScenario(activeScenario.id, s => ({
      ...s,
      floors: floors.map((f, i) => ({ ...f, sort_order: i })),
      footprint_sf: fp,
    }));
    setQuickStackOpen(false);
    toast.success("Quick stack applied");
  }, [activeScenario.id, updateScenario]);

  const addScenario = useCallback(() => {
    const s = newScenario(`Scenario ${program.scenarios.length + 1}`);
    onChange({ ...program, scenarios: [...program.scenarios, s], active_scenario_id: s.id });
  }, [program, onChange]);

  const duplicateScenario = useCallback((id: string) => {
    const source = program.scenarios.find(s => s.id === id);
    if (!source) return;
    const dup: MassingScenario = {
      ...JSON.parse(JSON.stringify(source)),
      id: uuidv4(), name: `${source.name} (copy)`, is_baseline: false, linked_uw_scenario_id: null,
      created_at: new Date().toISOString(),
      floors: source.floors.map(f => ({ ...f, id: uuidv4() })),
    };
    onChange({ ...program, scenarios: [...program.scenarios, dup], active_scenario_id: dup.id });
    setMenuOpenId(null);
  }, [program, onChange]);

  const deleteScenario = useCallback((id: string) => {
    if (program.scenarios.length <= 1) { toast.error("Must have at least one scenario"); return; }
    const remaining = program.scenarios.filter(s => s.id !== id);
    onChange({ ...program, scenarios: remaining, active_scenario_id: remaining[0].id });
    setMenuOpenId(null);
  }, [program, onChange]);

  const setBaseline = useCallback((id: string) => {
    const updated = program.scenarios.map(s => ({ ...s, is_baseline: s.id === id }));
    onChange({ ...program, scenarios: updated });
    const scenario = updated.find(s => s.id === id)!;
    onPushBaseline(scenario);
    toast.success(`"${scenario.name}" set as baseline — pushed to underwriting`);
    setMenuOpenId(null);
  }, [program, onChange, onPushBaseline]);

  const aboveFloors = activeScenario.floors.filter(f => !f.is_below_grade).sort((a, b) => a.sort_order - b.sort_order);
  const belowFloors = activeScenario.floors.filter(f => f.is_below_grade).sort((a, b) => a.sort_order - b.sort_order);

  return (
    <div className="space-y-4">
      {/* ── Scenario Tabs ── */}
      <div className="flex items-center gap-1 flex-wrap">
        {program.scenarios.map(s => (
          <div key={s.id} className="relative">
            <button
              onClick={() => onChange({ ...program, active_scenario_id: s.id })}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${s.id === activeScenario.id ? "bg-primary/20 text-primary border border-primary/30" : "bg-muted/30 text-muted-foreground hover:bg-muted/50"}`}
            >
              {s.is_baseline && <Star className="h-3 w-3 fill-primary text-primary" />}
              {s.name}
            </button>
            <button
              onClick={() => setMenuOpenId(menuOpenId === s.id ? null : s.id)}
              className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-muted flex items-center justify-center opacity-0 group-hover:opacity-100 hover:opacity-100"
              style={{ opacity: menuOpenId === s.id ? 1 : undefined }}
            >
              <MoreVertical className="h-2.5 w-2.5" />
            </button>
            {menuOpenId === s.id && (
              <div className="absolute top-8 left-0 z-50 bg-card border rounded-md shadow-lg py-1 min-w-[160px]">
                <button onClick={() => setBaseline(s.id)} className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted/50 flex items-center gap-2">
                  <Star className="h-3 w-3" /> Set as Baseline
                </button>
                <button onClick={() => { onPushScenario(s); setMenuOpenId(null); }} className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted/50 flex items-center gap-2">
                  <Layers className="h-3 w-3" /> Push to UW as Scenario
                </button>
                <button onClick={() => duplicateScenario(s.id)} className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted/50 flex items-center gap-2">
                  <Copy className="h-3 w-3" /> Duplicate
                </button>
                <button onClick={() => { const name = prompt("Rename scenario:", s.name); if (name) updateScenario(s.id, sc => ({ ...sc, name })); setMenuOpenId(null); }} className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted/50">
                  Rename
                </button>
                {program.scenarios.length > 1 && (
                  <button onClick={() => deleteScenario(s.id)} className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted/50 text-red-400 flex items-center gap-2">
                    <Trash2 className="h-3 w-3" /> Delete
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
        <Button variant="ghost" size="sm" onClick={addScenario} className="text-xs h-7">
          <Plus className="h-3 w-3 mr-1" /> New
        </Button>
        <div className="relative ml-1">
          <Button variant="outline" size="sm" onClick={() => setQuickStackOpen(!quickStackOpen)} className="text-xs h-7">
            Quick Stack <ChevronDown className="h-3 w-3 ml-1" />
          </Button>
          {quickStackOpen && (
            <div className="absolute top-8 left-0 z-50 bg-card border rounded-md shadow-lg py-1 min-w-[240px]">
              {[
                { label: "Podium Residential (5 over 1)", fn: () => quickStackPodium5over1(zoning.land_sf, zoning.lot_coverage_pct || 50) },
                { label: "Mid-Rise (3 over 2)", fn: () => quickStackMidRise3over2(zoning.land_sf, zoning.lot_coverage_pct || 50) },
                { label: "High-Rise Mixed Use", fn: () => quickStackHighRise(zoning.land_sf, zoning.lot_coverage_pct || 50) },
                { label: "Garden-Style Walk-Up", fn: () => quickStackGardenStyle(zoning.land_sf, zoning.lot_coverage_pct || 50) },
                { label: "Auto from Zoning", fn: () => quickStackAutoFromZoning(zoning.land_sf, zoning.far, zoning.lot_coverage_pct || 50, zoning.height_limit_ft) },
              ].map(preset => (
                <button key={preset.label} onClick={() => applyQuickStack(preset.fn())} className="w-full text-left px-3 py-2 text-xs hover:bg-muted/50">
                  {preset.label}
                </button>
              ))}
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

      {/* ── Split Layout: Editor + Section Cut ── */}
      <div className="flex gap-4">
        {/* LEFT — Floor Editor */}
        <div className="flex-1 min-w-0">
          {/* Footprint + Density Bonus */}
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Base Footprint (SF)</label>
              <input type="text" inputMode="decimal"
                value={activeScenario.footprint_sf || ""}
                onChange={e => updateScenario(activeScenario.id, s => ({ ...s, footprint_sf: parseFloat(e.target.value.replace(/,/g, "")) || 0 }))}
                className="w-full border rounded-md px-2 py-1.5 text-sm bg-background outline-none tabular-nums"
                placeholder="0" />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Density Bonus</label>
              <div className="flex gap-2">
                <input type="text" value={activeScenario.density_bonus_applied || ""}
                  onChange={e => updateScenario(activeScenario.id, s => ({ ...s, density_bonus_applied: e.target.value || null }))}
                  className="flex-1 border rounded-md px-2 py-1.5 text-sm bg-background outline-none"
                  placeholder="e.g. SB 35, AB 2011" />
                <input type="text" inputMode="decimal"
                  value={activeScenario.density_bonus_far_increase || ""}
                  onChange={e => updateScenario(activeScenario.id, s => ({ ...s, density_bonus_far_increase: parseFloat(e.target.value) || 0 }))}
                  className="w-[60px] border rounded-md px-2 py-1.5 text-sm bg-background outline-none"
                  placeholder="+FAR" title="FAR increase as decimal (e.g. 0.35 = +35%)" />
              </div>
            </div>
          </div>

          {/* Above Grade Floors */}
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Above Grade</h4>
          <table className="w-full text-xs border-collapse mb-2">
            <thead>
              <tr className="bg-muted/30 border-b">
                <th className="w-[24px]" />
                <th className="text-left px-1 py-1 text-xs font-medium text-muted-foreground">Use</th>
                <th className="text-left px-1 py-1 text-xs font-medium text-muted-foreground w-[90px]">Plate SF</th>
                <th className="text-left px-1 py-1 text-xs font-medium text-muted-foreground w-[70px]">F-t-F</th>
                <th className="text-left px-1 py-1 text-xs font-medium text-muted-foreground w-[55px]">Units</th>
                <th className="text-left px-1 py-1 text-xs font-medium text-muted-foreground w-[55px]">Eff%</th>
                <th className="text-right px-1 py-1 text-xs font-medium text-muted-foreground w-[70px]">NRSF</th>
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
          <table className="w-full text-xs border-collapse mb-2">
            <thead>
              <tr className="bg-muted/30 border-b">
                <th className="w-[24px]" />
                <th className="text-left px-1 py-1 text-xs font-medium text-muted-foreground">Use</th>
                <th className="text-left px-1 py-1 text-xs font-medium text-muted-foreground w-[90px]">Plate SF</th>
                <th className="text-left px-1 py-1 text-xs font-medium text-muted-foreground w-[70px]">F-t-F</th>
                <th className="text-left px-1 py-1 text-xs font-medium text-muted-foreground w-[55px]">Units</th>
                <th className="text-left px-1 py-1 text-xs font-medium text-muted-foreground w-[55px]">Eff%</th>
                <th className="text-right px-1 py-1 text-xs font-medium text-muted-foreground w-[70px]">NRSF</th>
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
          <Button variant="ghost" size="sm" className="text-xs mb-3" onClick={() => addFloor(true)}>
            <Plus className="h-3 w-3 mr-1" /> Add Below Grade
          </Button>

          {/* Summary */}
          <div className="border rounded-md bg-muted/10 p-3 text-sm space-y-1">
            <div className="flex justify-between"><span>Total GSF</span><span className="font-semibold tabular-nums">{fn(summary.total_gsf)}</span></div>
            <div className="flex justify-between"><span>Total NRSF</span><span className="font-semibold tabular-nums">{fn(summary.total_nrsf)}</span></div>
            <div className="flex justify-between"><span>Residential Units</span><span className="font-semibold tabular-nums">{fn(summary.total_units)}</span></div>
            <div className="flex justify-between"><span>Est. Parking Spaces</span><span className="font-semibold tabular-nums">{fn(summary.total_parking_spaces_est)} <span className="text-muted-foreground text-xs">(@ 350 SF/space)</span></span></div>
            <div className="flex justify-between"><span>Building Height</span><span className="font-semibold tabular-nums">{summary.total_height_ft.toFixed(0)} ft ({summary.above_grade_floors} floors)</span></div>
            {summary.below_grade_floors > 0 && <div className="flex justify-between"><span>Below Grade</span><span className="font-semibold tabular-nums">{summary.total_below_grade_ft.toFixed(0)} ft ({summary.below_grade_floors} levels)</span></div>}
            <div className="flex justify-between"><span>Effective FAR</span><span className="font-semibold tabular-nums">{summary.effective_far.toFixed(2)}</span></div>
          </div>
        </div>

        {/* RIGHT — Section Cut SVG */}
        <div className="w-72 lg:w-80 shrink-0 sticky top-4 self-start">
          <div className="border rounded-md bg-card/50 p-2">
            <MassingSectionCut scenario={activeScenario} summary={summary} />
          </div>
        </div>
      </div>

      {/* ── Action Buttons ── */}
      <div className="flex gap-2 pt-2">
        <Button variant="outline" size="sm" onClick={() => setBaseline(activeScenario.id)}>
          <Star className="h-3.5 w-3.5 mr-2" />
          {activeScenario.is_baseline ? "Baseline (active)" : "Set as Baseline"}
        </Button>
        <Button variant="outline" size="sm" onClick={() => onPushScenario(activeScenario)}>
          <Layers className="h-3.5 w-3.5 mr-2" /> Push to UW as Scenario
        </Button>
      </div>
    </div>
  );
}
