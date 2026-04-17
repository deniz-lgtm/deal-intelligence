"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Supply Pipeline Layer for the Site Plan map.
//
// Pulls aggregated under-construction / planned / proposed projects from every
// market report uploaded for the deal, deduped by name with the newest vintage
// winning. Renders each project as a colored CircleMarker on the same Leaflet
// MapContainer the site plan uses, with a popup showing project name,
// developer, units/SF, expected delivery, source publisher, and distance.
//
// This is the single most important map view for a developer-focused workflow:
// staring at the parcel + seeing what competing supply is coming up nearby is
// how merchant builders think about absorption risk.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useState } from "react";
import { CircleMarker, Popup } from "react-leaflet";

interface PipelineProject {
  project_name?: string | null;
  developer?: string | null;
  units?: number | null;
  sf?: number | null;
  expected_delivery?: string | null;
  submarket?: string | null;
  status?: string | null;
  lat?: number | null;
  lng?: number | null;
  distance_mi?: number | null;
  source_publisher?: string | null;
  source_report_name?: string | null;
  source_as_of_date?: string | null;
}

export interface PipelineTotals {
  project_count: number;
  mapped_count: number;
  total_units: number;
  under_construction_count: number;
  under_construction_units: number;
  planned_count: number;
  planned_units: number;
}

export interface PipelineData {
  mapped: PipelineProject[];
  unmapped: PipelineProject[];
  totals: PipelineTotals;
}

// Color by status so the developer can instantly scan "what's getting delivered
// first" vs "what's still in pre-dev". Matches the Tailwind palette the rest
// of the app uses for consistency.
const STATUS_COLOR: Record<string, string> = {
  under_construction: "#ef4444",   // red — most immediate competition
  recently_delivered: "#8b5cf6",   // violet — just came online
  planned: "#f59e0b",              // amber — scheduled
  proposed: "#64748b",             // slate — speculative
};

function colorFor(status?: string | null): string {
  if (!status) return "#64748b";
  return STATUS_COLOR[status] || "#64748b";
}

interface Props {
  dealId: string;
  // Toggle on/off from the parent. Nothing fetches while disabled.
  enabled: boolean;
  // Radius in miles — the parent controls it via a dropdown.
  radiusMi: number;
  // Parent receives the loaded data so it can render a sidebar list alongside
  // the map. Calls with null when disabled / loading.
  onDataChange?: (data: PipelineData | null) => void;
}

export default function SupplyPipelineLayer({
  dealId,
  enabled,
  radiusMi,
  onDataChange,
}: Props) {
  const [data, setData] = useState<PipelineData | null>(null);

  useEffect(() => {
    if (!enabled) {
      setData(null);
      onDataChange?.(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/deals/${dealId}/pipeline?radius_mi=${radiusMi}`);
        const j = await res.json();
        if (cancelled) return;
        if (j.data) {
          setData(j.data);
          onDataChange?.(j.data);
        }
      } catch (e) {
        console.error("Failed to load pipeline:", e);
      }
    })();
    return () => { cancelled = true; };
  }, [dealId, enabled, radiusMi, onDataChange]);

  const markers = useMemo(() => {
    if (!data) return [];
    return data.mapped.filter((p) => p.lat != null && p.lng != null);
  }, [data]);

  if (!enabled || markers.length === 0) return null;

  return (
    <>
      {markers.map((p, i) => (
        <CircleMarker
          key={`${p.project_name || i}-${p.lat}-${p.lng}`}
          center={[Number(p.lat), Number(p.lng)]}
          radius={8}
          pathOptions={{
            color: "#ffffff",
            weight: 1.5,
            fillColor: colorFor(p.status),
            fillOpacity: 0.9,
          }}
        >
          <Popup>
            <div className="text-xs space-y-1 min-w-[220px]">
              <div className="font-semibold text-sm">
                {p.project_name || "Unnamed project"}
              </div>
              {p.developer && (
                <div className="text-muted-foreground">by {p.developer}</div>
              )}
              <div className="flex flex-wrap gap-2 text-[11px] pt-1">
                {p.units != null && <span>{p.units} units</span>}
                {p.sf != null && <span>{Number(p.sf).toLocaleString()} SF</span>}
                {p.expected_delivery && (
                  <span>→ {p.expected_delivery}</span>
                )}
                {p.distance_mi != null && (
                  <span>{p.distance_mi} mi from site</span>
                )}
              </div>
              {p.status && (
                <div>
                  <span
                    className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium capitalize"
                    style={{
                      backgroundColor: colorFor(p.status) + "33",
                      color: colorFor(p.status),
                    }}
                  >
                    {p.status.replace("_", " ")}
                  </span>
                </div>
              )}
              {p.source_publisher && (
                <div className="text-[10px] text-muted-foreground pt-1 border-t border-border/30 mt-1">
                  source: {p.source_publisher.toUpperCase()}
                  {p.source_as_of_date
                    ? ` · ${new Date(p.source_as_of_date).toLocaleDateString("en-US", { month: "short", year: "numeric" })}`
                    : ""}
                </div>
              )}
            </div>
          </Popup>
        </CircleMarker>
      ))}
    </>
  );
}
