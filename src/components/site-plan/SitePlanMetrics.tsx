"use client";

// ─────────────────────────────────────────────────────────────────────────────
// SitePlanMetrics — sidebar that reads a SitePlan value and surfaces the
// analyst-facing numbers: parcel area / acres / perimeter, one row per
// drawn building (with rename / delete / select), total building SF, lot
// coverage, setback compliance, and a "Push to Programming" button that
// replaces the active scenario's base footprint with the drawn total.
//
// Multi-building: the SitePlan now carries a list of buildings. We render
// a row per building with label, area, selector, rename and delete. Legacy
// single-building payloads are migrated on the host page — we don't need
// to touch them here.
// ─────────────────────────────────────────────────────────────────────────────

import { useMemo, useState } from "react";
import {
  AlertTriangle, Check, Ruler, Home, Trees, ArrowRight, Info,
  Pencil, Trash2, Plus,
} from "lucide-react";
import type { SitePlan, SitePlanBuilding, SitePlanScenario } from "@/lib/types";
import type { SitePlanSetbacks } from "./SitePlanGenerator";
import { polygonAreaSf, polygonPerimeterFt, insetPolygon } from "./site-plan-utils";

interface Props {
  value: SitePlan;
  onChange: (next: SitePlan) => void;
  // Zoning-provided setback values (used for envelope viz + compliance)
  setbacks?: SitePlanSetbacks;
  // Zoning-provided maxes (used for compliance flags)
  zoningLotCoveragePct?: number | null;
  // Land SF from the site-info section — lets us flag when the drawn parcel
  // disagrees with the typed land acreage.
  expectedLandSf?: number | null;
  // Push-to-programming handler. When present the "Push to Programming"
  // card renders; it's wired by the host to write the chosen footprint
  // into the active massing scenario and navigate / toast.
  onPushToProgramming?: (footprintSf: number, building: SitePlanBuilding | null) => void;
  // Optional label shown beside the push button (e.g., current scenario name)
  pushTargetLabel?: string;
}

const fn = (n: number) => (n || n === 0 ? Math.round(n).toLocaleString("en-US") : "—");
const fn2 = (n: number) => (n || n === 0 ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "—");

export default function SitePlanMetrics({
  value, onChange, setbacks, zoningLotCoveragePct, expectedLandSf,
  onPushToProgramming, pushTargetLabel,
}: Props) {
  // The metrics sidebar always reflects the currently active scenario.
  // Scenario switches happen via the top-level scenario tab bar rendered
  // by the host page; all this component sees is a new `value` with a
  // different `active_scenario_id`, and everything downstream recomputes.
  const activeScen = (value.scenarios || []).find(
    (s) => s.id === value.active_scenario_id
  ) || null;
  const parcelPoints = activeScen?.parcel_points || [];
  const parcelSF = activeScen?.parcel_area_sf || 0;
  const buildings = activeScen?.buildings || [];
  const activeBuildingId = activeScen?.active_building_id ?? null;

  const parcelAcres = parcelSF / 43560;
  const parcelPerimeterFt = useMemo(
    () => polygonPerimeterFt(parcelPoints),
    [parcelPoints]
  );

  const totalBuildingSf = useMemo(
    () => buildings.reduce((s, b) => s + (b.area_sf || 0), 0),
    [buildings]
  );
  const lotCoveragePct = parcelSF > 0 ? (totalBuildingSf / parcelSF) * 100 : 0;

  // Setback envelope area (SF) — buildable area after applying the most
  // restrictive setback as a uniform inset. Informational only.
  const maxSetbackFt = useMemo(() => {
    if (!setbacks) return 0;
    const vals = [setbacks.front, setbacks.side, setbacks.rear, setbacks.corner]
      .map((v) => (v == null ? 0 : Number(v)))
      .filter((v) => v > 0);
    return vals.length ? Math.max(...vals) : 0;
  }, [setbacks]);

  const envelopeSF = useMemo(() => {
    if (maxSetbackFt <= 0 || parcelPoints.length < 3) return 0;
    const ring = insetPolygon(parcelPoints, maxSetbackFt);
    return Math.round(polygonAreaSf(ring));
  }, [parcelPoints, maxSetbackFt]);

  // Compliance flags
  const coverageCompliant =
    !zoningLotCoveragePct || zoningLotCoveragePct <= 0 || lotCoveragePct <= zoningLotCoveragePct;

  // Does the traced parcel roughly match the typed land_sf? Flag if off >5%.
  const parcelMismatchPct =
    expectedLandSf && expectedLandSf > 0 && parcelSF > 0
      ? ((parcelSF - expectedLandSf) / expectedLandSf) * 100
      : null;

  const hasParcel = parcelPoints.length >= 3;
  const hasBuildings = buildings.length > 0;

  // Inline rename state (one label editor at a time)
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  // Push selector — which building to push to Programming. Defaults to the
  // active building, else the first, else "total".
  const [pushTarget, setPushTarget] = useState<string>("");
  const effectiveTarget =
    pushTarget ||
    (activeBuildingId && buildings.some((b) => b.id === activeBuildingId)
      ? activeBuildingId
      : buildings[0]?.id || "total");

  const pushSf =
    effectiveTarget === "total"
      ? totalBuildingSf
      : buildings.find(b => b.id === effectiveTarget)?.area_sf || 0;
  const pushBuilding =
    effectiveTarget === "total"
      ? null
      : buildings.find(b => b.id === effectiveTarget) || null;

  // Mutation helpers — every write funnels through updateActiveScen so
  // only the active scenario's copy of the buildings list changes. Other
  // scenarios are untouched.
  const updateActiveScen = (
    mutator: (scen: SitePlanScenario) => SitePlanScenario
  ) => {
    if (!activeScen) return;
    const next = (value.scenarios || []).map((s) =>
      s.id === activeScen.id ? mutator(s) : s
    );
    onChange({ ...value, scenarios: next, updated_at: new Date().toISOString() });
  };

  const setActive = (id: string | null) =>
    updateActiveScen((scen) => ({ ...scen, active_building_id: id }));

  const renameBuilding = (id: string, label: string) =>
    updateActiveScen((scen) => ({
      ...scen,
      buildings: scen.buildings.map((b) => (b.id === id ? { ...b, label } : b)),
    }));

  const deleteBuilding = (id: string) =>
    updateActiveScen((scen) => ({
      ...scen,
      buildings: scen.buildings.filter((b) => b.id !== id),
      active_building_id: scen.active_building_id === id ? null : scen.active_building_id,
    }));

  return (
    <div className="space-y-3">
      {/* Headline tiles */}
      <div className="grid grid-cols-2 gap-2">
        <MetricTile
          icon={<Trees className="h-3.5 w-3.5 text-red-400" />}
          label="Parcel"
          primary={hasParcel ? `${fn(parcelSF)} SF` : "—"}
          secondary={hasParcel ? `${fn2(parcelAcres)} AC` : "Trace parcel on map"}
        />
        <MetricTile
          icon={<Home className="h-3.5 w-3.5 text-blue-400" />}
          label={buildings.length > 1 ? `${buildings.length} Buildings` : "Building"}
          primary={hasBuildings ? `${fn(totalBuildingSf)} SF` : "—"}
          secondary={hasBuildings ? "Total footprint" : "Draw building on map"}
        />
      </div>

      {/* Buildings list — one row per drawn building, with select / rename / delete. */}
      {hasBuildings && (
        <div className="border border-border/40 rounded-lg p-2 bg-muted/10">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5 px-1 flex items-center justify-between">
            <span>Buildings</span>
            <span className="text-[10px] text-muted-foreground/80 normal-case tracking-normal">
              Use the Building tool to add more
            </span>
          </div>
          <div className="space-y-1">
            {buildings.map((b) => {
              const isActive = b.id === activeBuildingId;
              const isRenaming = renamingId === b.id;
              return (
                <div
                  key={b.id}
                  className={`flex items-center gap-1.5 rounded-md px-2 py-1 border transition-colors ${
                    isActive
                      ? "bg-blue-500/10 border-blue-500/30"
                      : "bg-background/30 border-border/30 hover:border-border/60"
                  }`}
                >
                  <button
                    onClick={() => setActive(isActive ? null : b.id)}
                    className="h-2 w-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: isActive ? "#3b82f6" : "#64748b" }}
                    title={isActive ? "Active" : "Click to activate"}
                  />
                  {isRenaming ? (
                    <input
                      autoFocus
                      value={renameDraft}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onBlur={() => {
                        if (renameDraft.trim()) renameBuilding(b.id, renameDraft.trim());
                        setRenamingId(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          if (renameDraft.trim()) renameBuilding(b.id, renameDraft.trim());
                          setRenamingId(null);
                        } else if (e.key === "Escape") {
                          setRenamingId(null);
                        }
                      }}
                      className="flex-1 text-xs bg-transparent outline-none border-b border-border/60"
                    />
                  ) : (
                    <button
                      onClick={() => setActive(b.id)}
                      className="flex-1 text-left text-xs truncate"
                    >
                      {b.label}
                    </button>
                  )}
                  <span className="text-[10px] tabular-nums text-muted-foreground flex-shrink-0">
                    {b.area_sf.toLocaleString()} SF
                  </span>
                  {!isRenaming && (
                    <button
                      onClick={() => {
                        setRenameDraft(b.label);
                        setRenamingId(b.id);
                      }}
                      className="text-muted-foreground/60 hover:text-foreground p-0.5"
                      title="Rename"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  )}
                  <button
                    onClick={() => deleteBuilding(b.id)}
                    className="text-muted-foreground/60 hover:text-red-400 p-0.5"
                    title="Delete building"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Coverage */}
      <div className="border border-border/40 rounded-lg p-3 bg-muted/10">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Lot Coverage</span>
          {hasParcel && hasBuildings && (
            coverageCompliant ? (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded bg-emerald-500/15 text-emerald-300">
                <Check className="h-3 w-3" /> OK
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded bg-amber-500/15 text-amber-300">
                <AlertTriangle className="h-3 w-3" /> Over
              </span>
            )
          )}
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-xl font-bold tabular-nums">{hasParcel && hasBuildings ? `${lotCoveragePct.toFixed(1)}%` : "—"}</span>
          {zoningLotCoveragePct != null && zoningLotCoveragePct > 0 && (
            <span className="text-[10px] text-muted-foreground">max {zoningLotCoveragePct}%</span>
          )}
        </div>
        {hasParcel && hasBuildings && (
          <div className="mt-2 h-1.5 rounded-full bg-muted/40 overflow-hidden">
            <div
              className={`h-full ${coverageCompliant ? "bg-emerald-400/70" : "bg-amber-400/70"}`}
              style={{
                width: `${Math.min(
                  100,
                  zoningLotCoveragePct && zoningLotCoveragePct > 0
                    ? (lotCoveragePct / zoningLotCoveragePct) * 100
                    : lotCoveragePct
                )}%`,
              }}
            />
          </div>
        )}
      </div>

      {/* Setbacks */}
      {setbacks && (
        <div className="border border-border/40 rounded-lg p-3 bg-muted/10">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
              <Ruler className="h-3 w-3" /> Setbacks
            </span>
            {maxSetbackFt > 0 && hasParcel && (
              <span className="text-[10px] text-amber-300">
                Envelope {fn(envelopeSF)} SF
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <SetbackRow label="Front" value={setbacks.front} />
            <SetbackRow label="Side" value={setbacks.side} />
            <SetbackRow label="Rear" value={setbacks.rear} />
            {setbacks.corner != null && <SetbackRow label="Corner" value={setbacks.corner} />}
          </div>
          {maxSetbackFt > 0 && hasParcel && (
            <p className="text-[10px] text-muted-foreground mt-2 leading-relaxed">
              <Info className="h-3 w-3 inline mr-1 -mt-0.5" />
              Envelope shown on map uses the tightest side ({maxSetbackFt} ft) as a
              uniform inset — conservative approximation of the per-side requirements.
            </p>
          )}
        </div>
      )}

      {/* Parcel geometry */}
      {hasParcel && (
        <div className="border border-border/40 rounded-lg p-3 bg-muted/10">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">Parcel Geometry</div>
          <div className="grid grid-cols-2 gap-y-1 gap-x-3 text-xs">
            <span className="text-muted-foreground">Vertices</span>
            <span className="tabular-nums text-right">{parcelPoints.length}</span>
            <span className="text-muted-foreground">Perimeter</span>
            <span className="tabular-nums text-right">{fn(parcelPerimeterFt)} ft</span>
          </div>
          {parcelMismatchPct != null && Math.abs(parcelMismatchPct) > 5 && (
            <p className="text-[10px] text-amber-300 mt-2">
              <AlertTriangle className="h-3 w-3 inline mr-1 -mt-0.5" />
              Traced parcel is {parcelMismatchPct > 0 ? "+" : ""}
              {parcelMismatchPct.toFixed(0)}% vs site info ({fn(expectedLandSf || 0)} SF).
            </p>
          )}
        </div>
      )}

      {/* Push to Programming */}
      {hasBuildings && onPushToProgramming && (
        <div className="border border-primary/30 bg-primary/5 rounded-lg p-3">
          <div className="text-[10px] uppercase tracking-wide text-primary/80 mb-2">
            Push to Programming
          </div>
          {/* Target selector — one row per building + "Total" when there's more than one. */}
          {buildings.length > 1 && (
            <select
              value={effectiveTarget}
              onChange={(e) => setPushTarget(e.target.value)}
              className="w-full mb-2 text-xs bg-background text-foreground border border-border/60 rounded px-2 py-1 outline-none"
            >
              {buildings.map((b) => (
                <option key={b.id} value={b.id} className="bg-background text-foreground">
                  {b.label} — {b.area_sf.toLocaleString()} SF
                </option>
              ))}
              <option value="total" className="bg-background text-foreground">
                Total of all buildings — {totalBuildingSf.toLocaleString()} SF
              </option>
            </select>
          )}
          <button
            onClick={() => onPushToProgramming(pushSf, pushBuilding)}
            disabled={pushSf <= 0}
            className="w-full flex items-center justify-between gap-2 rounded-md bg-primary/10 hover:bg-primary/20 disabled:opacity-50 disabled:cursor-not-allowed px-3 py-2 group transition-colors"
          >
            <div className="text-left">
              <div className="text-xs font-medium text-primary">
                Replace base footprint · {fn(pushSf)} SF
              </div>
              {pushTargetLabel && (
                <div className="text-[10px] text-muted-foreground mt-0.5">→ {pushTargetLabel}</div>
              )}
            </div>
            <ArrowRight className="h-4 w-4 text-primary group-hover:translate-x-0.5 transition-transform flex-shrink-0" />
          </button>
        </div>
      )}
    </div>
  );
}

// ── Small sub-components ─────────────────────────────────────────────────────

function MetricTile({
  icon, label, primary, secondary,
}: { icon: React.ReactNode; label: string; primary: string; secondary?: string }) {
  return (
    <div className="border border-border/40 rounded-lg p-3 bg-muted/10">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-lg font-bold tabular-nums leading-tight">{primary}</div>
      {secondary && <div className="text-[10px] text-muted-foreground mt-0.5 truncate">{secondary}</div>}
    </div>
  );
}

function SetbackRow({ label, value }: { label: string; value: number | null | undefined }) {
  return (
    <div className="flex items-center justify-between border border-border/30 rounded-md px-2 py-1 bg-background/40">
      <span className="text-muted-foreground text-[11px]">{label}</span>
      <span className="tabular-nums text-[11px]">{value != null && value > 0 ? `${value} ft` : "—"}</span>
    </div>
  );
}
