// ── Mapbox / Map Tile Configuration ──────────────────────────────────────────
//
// Shared config for all map components. Uses Mapbox when NEXT_PUBLIC_MAPBOX_TOKEN
// is set, falls back to CARTO dark tiles (free, no key needed).

export type MapStyle = "dark" | "light" | "streets" | "satellite" | "outdoors";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

const MAPBOX_STYLES: Record<MapStyle, { url: string; attribution: string }> = {
  dark: {
    url: `https://api.mapbox.com/styles/v1/mapbox/dark-v11/tiles/{z}/{x}/{y}@2x?access_token=${MAPBOX_TOKEN}`,
    attribution: '&copy; <a href="https://www.mapbox.com/">Mapbox</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  },
  light: {
    url: `https://api.mapbox.com/styles/v1/mapbox/light-v11/tiles/{z}/{x}/{y}@2x?access_token=${MAPBOX_TOKEN}`,
    attribution: '&copy; <a href="https://www.mapbox.com/">Mapbox</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  },
  streets: {
    url: `https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/{z}/{x}/{y}@2x?access_token=${MAPBOX_TOKEN}`,
    attribution: '&copy; <a href="https://www.mapbox.com/">Mapbox</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  },
  satellite: {
    url: `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/tiles/{z}/{x}/{y}@2x?access_token=${MAPBOX_TOKEN}`,
    attribution: '&copy; <a href="https://www.mapbox.com/">Mapbox</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  },
  outdoors: {
    url: `https://api.mapbox.com/styles/v1/mapbox/outdoors-v12/tiles/{z}/{x}/{y}@2x?access_token=${MAPBOX_TOKEN}`,
    attribution: '&copy; <a href="https://www.mapbox.com/">Mapbox</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  },
};

// CARTO fallback (free, no key)
const CARTO_DARK = {
  url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
  subdomains: ["a", "b", "c", "d"],
};

export const MAP_STYLE_OPTIONS: Array<{ value: MapStyle; label: string }> = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  { value: "streets", label: "Streets" },
  { value: "satellite", label: "Satellite" },
  { value: "outdoors", label: "Outdoors" },
];

export function hasMapbox(): boolean {
  return MAPBOX_TOKEN.length > 0 && MAPBOX_TOKEN.startsWith("pk.");
}

export function getTileConfig(style: MapStyle = "dark"): {
  url: string;
  attribution: string;
  subdomains?: string[];
  tileSize?: number;
  zoomOffset?: number;
} {
  if (hasMapbox()) {
    return {
      ...MAPBOX_STYLES[style],
      tileSize: 512,
      zoomOffset: -1,
    };
  }
  // Fallback to CARTO dark
  return CARTO_DARK;
}
