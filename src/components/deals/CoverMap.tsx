"use client";

import { useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { getTileConfig } from "@/lib/map-config";

// Matches the subject pin used on the Comps map so deal location reads
// consistently across views. Inline SVG keeps the marker from depending
// on Leaflet's default PNGs, which break under Next's bundler.
const SUBJECT_ICON = L.divIcon({
  className: "deal-cover-marker",
  html: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="32" height="42" fill="#eab308" stroke="white" stroke-width="2.5">
    <path d="M12 0C7 0 3 4 3 9c0 7 9 15 9 15s9-8 9-15c0-5-4-9-9-9z"/>
    <circle cx="12" cy="9" r="3.5" fill="white"/>
  </svg>`,
  iconSize: [32, 42],
  iconAnchor: [16, 42],
});

export type CoverMapStyle = "map" | "satellite";

interface PersistedView {
  lat: number;
  lng: number;
  zoom: number;
}

interface Props {
  dealId: string;
  lat: number;
  lng: number;
  style: CoverMapStyle;
  className?: string;
}

function loadPersistedView(dealId: string): PersistedView | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(`dealCoverView:${dealId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedView>;
    if (
      typeof parsed.lat === "number" &&
      typeof parsed.lng === "number" &&
      typeof parsed.zoom === "number"
    ) {
      return { lat: parsed.lat, lng: parsed.lng, zoom: parsed.zoom };
    }
    return null;
  } catch {
    return null;
  }
}

// Recenters the map when the deal coordinates change (e.g. the user edits
// the address and the server re-geocodes) but doesn't fight the user's
// manual pan/zoom once they've adjusted the view.
function Recenter({ lat, lng, hasPersistedView }: { lat: number; lng: number; hasPersistedView: boolean }) {
  const map = useMap();
  const lastCoords = useRef<string>(`${lat},${lng}`);
  useEffect(() => {
    const key = `${lat},${lng}`;
    if (key !== lastCoords.current && !hasPersistedView) {
      map.setView([lat, lng], map.getZoom());
      lastCoords.current = key;
    }
  }, [lat, lng, map, hasPersistedView]);
  return null;
}

// Captures pan/zoom events from user interaction and persists to
// localStorage per-deal. DB persistence is deferred; for v1 a user
// loses their custom view when they switch devices.
function ViewPersister({ dealId }: { dealId: string }) {
  useMapEvents({
    moveend: (e) => {
      const map = e.target as L.Map;
      const c = map.getCenter();
      const next: PersistedView = { lat: c.lat, lng: c.lng, zoom: map.getZoom() };
      try {
        localStorage.setItem(`dealCoverView:${dealId}`, JSON.stringify(next));
      } catch {
        // Quota exceeded / private mode — silently skip.
      }
    },
  });
  return null;
}

export default function CoverMap({ dealId, lat, lng, style, className }: Props) {
  const [initialView] = useState<PersistedView>(() =>
    loadPersistedView(dealId) ?? { lat, lng, zoom: 17 }
  );
  const hasPersistedView = initialView.lat !== lat || initialView.lng !== lng;
  const tile = getTileConfig(style === "satellite" ? "satellite" : "streets");

  return (
    <MapContainer
      center={[initialView.lat, initialView.lng]}
      zoom={initialView.zoom}
      scrollWheelZoom
      className={className}
      style={{ height: "100%", width: "100%" }}
      // Give the attribution control a compact dark styling via the
      // surrounding CSS; default top-right zoom control is sufficient.
      attributionControl={false}
    >
      <TileLayer
        url={tile.url}
        attribution={tile.attribution}
        subdomains={tile.subdomains}
        tileSize={tile.tileSize ?? 256}
        zoomOffset={tile.zoomOffset ?? 0}
      />
      <Marker position={[lat, lng]} icon={SUBJECT_ICON} />
      <Recenter lat={lat} lng={lng} hasPersistedView={hasPersistedView} />
      <ViewPersister dealId={dealId} />
    </MapContainer>
  );
}
