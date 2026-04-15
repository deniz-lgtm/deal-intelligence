"use client";

// ─────────────────────────────────────────────────────────────────────────────
// SitePlanMetrics — sidebar that reads a SitePlan value and surfaces the
// analyst-facing numbers: parcel area / acres / perimeter, building
// footprint SF, lot coverage, setback compliance, and a sync button that
// pushes the drawn footprint into the active massing scenario.
//
// Split out of SitePlanGenerator so the host page can lay them out freely
// (map left / metrics right on wide screens, stacked on narrow).
// ─────────────────────────────────────────────────────────────────────────────

import { useMemo } from "react";
import { AlertTriangle, Check, Ruler, Home, Trees, ArrowRight, Info } from "lucide-react";
import type { SitePlan } from "@/lib/types";
import type { SitePlanSetbacks } from "./SitePlanGenerator";
import { polygonAreaSf, polygonPerimeterFt, insetPolygon } from "./site-plan-utils";

interface Props {
  value: SitePlan;
  // Zoning-provided setback values (used for envelope viz + compliance)
  setbacks?: SitePlanSetbacks;
  // Zoning-provided maxes (used for compliance flags)
  zoningLotCoveragePct?: number | null;
  // Land SF from the site-info section — lets us flag when the drawn parcel
  // disagrees with the typed land acreage.
  expectedLandSf?: number | null;
  // Optional callback. When present, a "Sync to massing footprint" button is
  // shown that forwards `building_area_sf` to the programming page.
  onSyncFootprint?: (footprintSf: number) => void;
  // Optional label shown beside the sync button (e.g., current massing scenario name)
  syncTargetLabel?: string;
}

const fn = (n: number) => (n || n === 0 ? Math.round(n).toLocaleString("en-US") : "—");
const fn2 = (n: number) => (n || n === 0 ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "—");

export default function SitePlanMetrics({
  value, setbacks, zoningLotCoveragePct, expectedLandSf, onSyncFootprint, syncTargetLabel,
}: Props) {
  const parcelSF = value.parcel_area_sf;
  const parcelAcres = parcelSF / 43560;
  const parcelPerimeterFt = useMemo(
    () => polygonPerimeterFt(value.parcel_points),
    [value.parcel_points]
  );

  const buildingSF = value.building_area_sf;
  const lotCoveragePct = parcelSF > 0 ? (buildingSF / parcelSF) * 100 : 0;

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
    if (maxSetbackFt <= 0 || value.parcel_points.length < 3) return 0;
    const ring = insetPolygon(value.parcel_points, maxSetbackFt);
    return Math.round(polygonAreaSf(ring));
  }, [value.parcel_points, maxSetbackFt]);

  // Compliance flags
  const coverageCompliant =
    !zoningLotCoveragePct || zoningLotCoveragePct <= 0 || lotCoveragePct <= zoningLotCoveragePct;

  // Does the traced parcel roughly match the typed land_sf? Flag if off >5%.
  const parcelMismatchPct =
    expectedLandSf && expectedLandSf > 0 && parcelSF > 0
      ? ((parcelSF - expectedLandSf) / expectedLandSf) * 100
      : null;

  // Empty state helpers
  const hasParcel = value.parcel_points.length >= 3;
  const hasBuilding = value.building_points.length >= 3;

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
          label="Building"
          primary={hasBuilding ? `${fn(buildingSF)} SF` : "—"}
          secondary={hasBuilding ? "Footprint" : "Draw building on map"}
        />
      </div>

      {/* Coverage */}
      <div className="border border-border/40 rounded-lg p-3 bg-muted/10">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Lot Coverage</span>
          {hasParcel && hasBuilding && (
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
          <span className="text-xl font-bold tabular-nums">{hasParcel && hasBuilding ? `${lotCoveragePct.toFixed(1)}%` : "—"}</span>
          {zoningLotCoveragePct != null && zoningLotCoveragePct > 0 && (
            <span className="text-[10px] text-muted-foreground">max {zoningLotCoveragePct}%</span>
          )}
        </div>
        {/* Progress bar */}
        {hasParcel && hasBuilding && (
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
            <span className="tabular-nums text-right">{value.parcel_points.length}</span>
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

      {/* Sync button */}
      {hasBuilding && onSyncFootprint && (
        <button
          onClick={() => onSyncFootprint(buildingSF)}
          className="w-full border border-primary/30 bg-primary/10 hover:bg-primary/20 rounded-lg p-3 text-left transition-colors group"
        >
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-primary/80">
                Sync to Massing
              </div>
              <div className="text-xs font-medium text-primary">
                Push {fn(buildingSF)} SF footprint
              </div>
              {syncTargetLabel && (
                <div className="text-[10px] text-muted-foreground mt-0.5">→ {syncTargetLabel}</div>
              )}
            </div>
            <ArrowRight className="h-4 w-4 text-primary group-hover:translate-x-0.5 transition-transform" />
          </div>
        </button>
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
