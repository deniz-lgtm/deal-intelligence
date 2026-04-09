"use client";

import { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import Link from "next/link";
import "leaflet/dist/leaflet.css";

// The stock Leaflet marker icons don't load correctly under bundlers because
// they reference relative image paths. Override with inline SVG data URIs so
// the markers render without 404s. We also color markers by comp type.

const MARKER_ICONS = {
  sale: createColoredIcon("#eab308"), // amber-500 — matches gradient-gold theme
  rent: createColoredIcon("#3b82f6"), // blue-500
} as const;

function createColoredIcon(color: string): L.DivIcon {
  return L.divIcon({
    className: "comp-map-marker",
    html: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="30" fill="${color}" stroke="white" stroke-width="2">
      <path d="M12 0C7 0 3 4 3 9c0 7 9 15 9 15s9-8 9-15c0-5-4-9-9-9z"/>
      <circle cx="12" cy="9" r="3" fill="white"/>
    </svg>`,
    iconSize: [22, 30],
    iconAnchor: [11, 30],
    popupAnchor: [0, -26],
  });
}

export interface MapComp {
  id: string;
  deal_id: string | null;
  source_deal_id: string | null;
  comp_type: "sale" | "rent";
  name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  sale_price: number | null;
  cap_rate: number | null;
  rent_per_unit: number | null;
  rent_per_sf: number | null;
  lat: number;
  lng: number;
}

interface Props {
  comps: MapComp[];
  height?: number;
}

/**
 * Helper child that refits the map to the markers whenever the comp set
 * changes. react-leaflet's parent <MapContainer> is intentionally not
 * re-rendered with new props, so this lives inside as a child.
 */
function FitBounds({ comps }: { comps: MapComp[] }) {
  const map = useMap();

  useEffect(() => {
    if (comps.length === 0) return;
    const bounds = L.latLngBounds(comps.map((c) => [c.lat, c.lng] as [number, number]));
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
  }, [map, comps]);

  return null;
}

export default function CompsMapView({ comps, height = 540 }: Props) {
  // Stable default center (geographic middle of contiguous US) until bounds fit
  const defaultCenter: [number, number] = [39.8283, -98.5795];

  // Memoize marker list so react-leaflet doesn't thrash the DOM
  const markers = useMemo(() => {
    return comps.map((c) => (
      <Marker
        key={c.id}
        position={[c.lat, c.lng]}
        icon={MARKER_ICONS[c.comp_type]}
      >
        <Popup>
          <div className="space-y-1 text-xs" style={{ minWidth: 180 }}>
            <div className="font-semibold text-foreground text-[13px]">
              {c.name || "Unnamed comp"}
            </div>
            <div className="text-muted-foreground">
              {[c.address, c.city, c.state].filter(Boolean).join(", ") || "—"}
            </div>
            <div className="flex items-center gap-2 pt-1">
              <span
                className={`text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded-full ${
                  c.comp_type === "sale"
                    ? "bg-amber-500/20 text-amber-300"
                    : "bg-blue-500/20 text-blue-300"
                }`}
              >
                {c.comp_type}
              </span>
              {c.comp_type === "sale" && c.sale_price != null && (
                <span className="font-medium">${Math.round(c.sale_price).toLocaleString()}</span>
              )}
              {c.comp_type === "sale" && c.cap_rate != null && (
                <span className="text-muted-foreground">
                  {c.cap_rate}% cap
                </span>
              )}
              {c.comp_type === "rent" && c.rent_per_unit != null && (
                <span className="font-medium">
                  ${Math.round(c.rent_per_unit).toLocaleString()}/unit/mo
                </span>
              )}
              {c.comp_type === "rent" &&
                c.rent_per_unit == null &&
                c.rent_per_sf != null && (
                  <span className="font-medium">
                    ${Number(c.rent_per_sf).toFixed(2)}/SF
                  </span>
                )}
            </div>
            {(c.deal_id || c.source_deal_id) && (
              <div className="pt-1 border-t border-border/40">
                <Link
                  href={`/deals/${c.deal_id || c.source_deal_id}`}
                  className="text-primary hover:underline text-[11px]"
                >
                  Open deal →
                </Link>
              </div>
            )}
          </div>
        </Popup>
      </Marker>
    ));
  }, [comps]);

  return (
    <div
      className="border border-border/40 rounded-xl overflow-hidden bg-card"
      style={{ height }}
    >
      <MapContainer
        center={defaultCenter}
        zoom={4}
        style={{ height: "100%", width: "100%" }}
        scrollWheelZoom
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          subdomains={["a", "b", "c", "d"]}
        />
        <MarkerClusterGroup
          chunkedLoading
          maxClusterRadius={50}
          showCoverageOnHover={false}
        >
          {markers}
        </MarkerClusterGroup>
        <FitBounds comps={comps} />
      </MapContainer>
    </div>
  );
}
