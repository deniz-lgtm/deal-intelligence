"use client";

import { useMemo } from "react";
import Link from "next/link";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import "leaflet/dist/leaflet.css";
import { getTileConfig } from "@/lib/map-config";
import { classifyDealPhase } from "@/lib/phase-classification";
import { DEAL_STAGE_LABELS, type DealPhase } from "@/lib/types";
import type { WidgetRenderProps } from "../types";

const PHASE_COLOR: Record<DealPhase | "none", string> = {
  acquisition: "#6366f1",
  development: "#f59e0b",
  construction: "#10b981",
  none: "#71717a",
};

function pinIcon(color: string): L.DivIcon {
  return L.divIcon({
    className: "deal-map-marker",
    html: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="32" fill="${color}" stroke="white" stroke-width="2.5"><path d="M12 0C7 0 3 4 3 9c0 7 9 15 9 15s9-8 9-15c0-5-4-9-9-9z"/><circle cx="12" cy="9" r="3" fill="white"/></svg>`,
    iconSize: [24, 32],
    iconAnchor: [12, 32],
    popupAnchor: [0, -28],
  });
}

const PIN_ICONS = {
  acquisition: pinIcon(PHASE_COLOR.acquisition),
  development: pinIcon(PHASE_COLOR.development),
  construction: pinIcon(PHASE_COLOR.construction),
  none: pinIcon(PHASE_COLOR.none),
} as const;

function FitToBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  useMemo(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], 11);
      return;
    }
    const bounds = L.latLngBounds(points);
    map.fitBounds(bounds, { padding: [24, 24], maxZoom: 12 });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points.length]);
  return null;
}

export function DealMapWidget({ data }: WidgetRenderProps) {
  const deals = data.deals.filter((d) => d.lat != null && d.lng != null);
  const tile = getTileConfig("dark");

  const points = useMemo(
    () => deals.map((d) => [Number(d.lat), Number(d.lng)] as [number, number]),
    [deals],
  );

  if (deals.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-xs text-muted-foreground">
        No geocoded deals yet. Deals with an address will appear here once the geocoder runs.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 px-4 py-3">
        <span className="font-nameplate text-base tracking-tight">Deal Locations</span>
        <div className="flex items-center gap-2.5 text-2xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full" style={{ background: PHASE_COLOR.acquisition }} /> Acq
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full" style={{ background: PHASE_COLOR.development }} /> Dev
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full" style={{ background: PHASE_COLOR.construction }} /> Con
          </span>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded-b-xl">
        <MapContainer
          center={points[0]}
          zoom={10}
          scrollWheelZoom
          style={{ height: "100%", width: "100%" }}
          zoomControl={false}
        >
          <TileLayer
            url={tile.url}
            attribution={tile.attribution}
            subdomains={tile.subdomains}
            tileSize={tile.tileSize}
            zoomOffset={tile.zoomOffset}
          />
          <MarkerClusterGroup chunkedLoading showCoverageOnHover={false}>
            {deals.map((d) => {
              const phase = classifyDealPhase(d).primary;
              const phaseKey = (phase ?? "none") as keyof typeof PIN_ICONS;
              const icon = PIN_ICONS[phaseKey] ?? PIN_ICONS.none;
              return (
                <Marker key={d.id} position={[Number(d.lat), Number(d.lng)]} icon={icon}>
                  <Popup>
                    <div className="text-xs">
                      <Link
                        href={`/deals/${d.id}`}
                        className="font-medium text-foreground hover:underline"
                      >
                        {d.name}
                      </Link>
                      <div className="mt-0.5 text-muted-foreground">
                        {d.address ? `${d.address}, ` : ""}
                        {d.city ?? "—"}
                      </div>
                      <div className="mt-1 text-muted-foreground">
                        {DEAL_STAGE_LABELS[d.status]}
                      </div>
                    </div>
                  </Popup>
                </Marker>
              );
            })}
          </MarkerClusterGroup>
          <FitToBounds points={points} />
        </MapContainer>
      </div>
    </div>
  );
}
