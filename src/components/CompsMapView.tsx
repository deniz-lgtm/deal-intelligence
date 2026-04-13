"use client";

import { useEffect, useMemo } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Circle,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import Link from "next/link";
import "leaflet/dist/leaflet.css";
import { getTileConfig } from "@/lib/map-config";

// The stock Leaflet marker icons don't load correctly under bundlers because
// they reference relative image paths. Override with inline SVG data URIs so
// the markers render without 404s. We also color markers by comp type.

const MARKER_ICONS = {
  sale: createColoredIcon("#eab308"), // amber-500 — matches gradient-gold theme
  rent: createColoredIcon("#3b82f6"), // blue-500
} as const;

// Subject pin is bigger and emerald so it visually dominates the comp pins.
const SUBJECT_ICON = L.divIcon({
  className: "comp-map-marker comp-map-subject",
  html: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="32" height="42" fill="#10b981" stroke="white" stroke-width="2.5">
    <path d="M12 0C7 0 3 4 3 9c0 7 9 15 9 15s9-8 9-15c0-5-4-9-9-9z"/>
    <circle cx="12" cy="9" r="3.5" fill="white"/>
  </svg>`,
  iconSize: [32, 42],
  iconAnchor: [16, 42],
  popupAnchor: [0, -38],
});

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

export interface MapSubject {
  lat: number;
  lng: number;
  name?: string | null;
  address?: string | null;
}

interface Props {
  comps: MapComp[];
  height?: number;
  /** Optional subject deal to pin and (optionally) ring with a radius. */
  subject?: MapSubject | null;
  /** If set, draws a translucent circle of this radius (miles) around the subject. */
  radiusMiles?: number | null;
}

const METERS_PER_MILE = 1609.344;

/**
 * Helper child that refits the map to the markers whenever the comp set
 * changes. react-leaflet's parent <MapContainer> is intentionally not
 * re-rendered with new props, so this lives inside as a child.
 *
 * When a subject is provided we include it in the bounds. When a radius is
 * also set we expand the bounds to encompass the full ring so users always
 * see the search area on first render.
 */
function FitBounds({
  comps,
  subject,
  radiusMiles,
}: {
  comps: MapComp[];
  subject?: MapSubject | null;
  radiusMiles?: number | null;
}) {
  const map = useMap();

  useEffect(() => {
    const points: Array<[number, number]> = comps.map((c) => [c.lat, c.lng]);
    if (subject) points.push([subject.lat, subject.lng]);
    if (points.length === 0) return;

    let bounds = L.latLngBounds(points);

    // Expand bounds to include the full radius circle, if drawn
    if (subject && radiusMiles != null && radiusMiles > 0) {
      const meters = radiusMiles * METERS_PER_MILE;
      const ringBounds = L.latLng(subject.lat, subject.lng).toBounds(meters * 2);
      bounds = bounds.extend(ringBounds);
    }

    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
  }, [map, comps, subject, radiusMiles]);

  return null;
}

export default function CompsMapView({
  comps,
  height = 540,
  subject,
  radiusMiles,
}: Props) {
  // Stable default center (geographic middle of contiguous US) until bounds fit
  const defaultCenter: [number, number] = [39.8283, -98.5795];
  const tiles = getTileConfig("dark");

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
          attribution={tiles.attribution}
          url={tiles.url}
          {...(tiles.subdomains ? { subdomains: tiles.subdomains } : {})}
          {...(tiles.tileSize ? { tileSize: tiles.tileSize } : {})}
          {...(tiles.zoomOffset != null ? { zoomOffset: tiles.zoomOffset } : {})}
        />
        <MarkerClusterGroup
          chunkedLoading
          maxClusterRadius={50}
          showCoverageOnHover
        >
          {markers}
        </MarkerClusterGroup>

        {/* Radius ring around the subject — drawn under the subject pin so the
            pin is always clickable on top. */}
        {subject && radiusMiles != null && radiusMiles > 0 && (
          <Circle
            center={[subject.lat, subject.lng]}
            radius={radiusMiles * METERS_PER_MILE}
            pathOptions={{
              color: "#10b981",
              weight: 1.5,
              fillColor: "#10b981",
              fillOpacity: 0.06,
              dashArray: "4 4",
            }}
          />
        )}

        {/* Subject pin — outside the cluster group so it never disappears
            into a cluster icon. */}
        {subject && (
          <Marker position={[subject.lat, subject.lng]} icon={SUBJECT_ICON}>
            <Popup>
              <div className="space-y-1 text-xs" style={{ minWidth: 180 }}>
                <div className="font-semibold text-foreground text-[13px]">
                  {subject.name || "Subject Property"}
                </div>
                {subject.address && (
                  <div className="text-muted-foreground">{subject.address}</div>
                )}
                <div className="pt-1">
                  <span className="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300">
                    subject
                  </span>
                  {radiusMiles != null && radiusMiles > 0 && (
                    <span className="ml-2 text-[10px] text-muted-foreground">
                      {radiusMiles} mi search
                    </span>
                  )}
                </div>
              </div>
            </Popup>
          </Marker>
        )}

        <FitBounds comps={comps} subject={subject} radiusMiles={radiusMiles} />
      </MapContainer>
    </div>
  );
}
