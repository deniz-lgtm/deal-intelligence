// ─────────────────────────────────────────────────────────────────────────────
// Site-plan geometry helpers (pure TS — no leaflet deps).
//
// Everything here operates on lat/lng polygons and uses a local tangent-plane
// approximation. That's accurate to well under a foot for parcel-scale
// polygons (a few hundred feet across) which is all we need for programming.
// ─────────────────────────────────────────────────────────────────────────────

import type { SitePlanPoint } from "@/lib/types";

const M_PER_DEG_LAT = 110540;       // meters per degree latitude
const M_PER_DEG_LNG_AT_EQUATOR = 111320;
export const FT_PER_M = 3.28084;
export const SF_PER_M2 = 10.7639;

// ── Coordinate conversion ────────────────────────────────────────────────────

export interface XYPoint {
  x: number; // meters east
  y: number; // meters north
}

export function centroid(points: SitePlanPoint[]): { lat: number; lng: number } {
  if (points.length === 0) return { lat: 0, lng: 0 };
  const lat = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const lng = points.reduce((s, p) => s + p.lng, 0) / points.length;
  return { lat, lng };
}

export function latLngToXY(
  point: SitePlanPoint,
  origin: { lat: number; lng: number }
): XYPoint {
  const cosLat = Math.cos((origin.lat * Math.PI) / 180);
  return {
    x: (point.lng - origin.lng) * M_PER_DEG_LNG_AT_EQUATOR * cosLat,
    y: (point.lat - origin.lat) * M_PER_DEG_LAT,
  };
}

export function xyToLatLng(
  xy: XYPoint,
  origin: { lat: number; lng: number }
): SitePlanPoint {
  const cosLat = Math.cos((origin.lat * Math.PI) / 180);
  return {
    lat: origin.lat + xy.y / M_PER_DEG_LAT,
    lng: origin.lng + xy.x / (M_PER_DEG_LNG_AT_EQUATOR * cosLat),
  };
}

// ── Polygon area (shoelace, in SF) ───────────────────────────────────────────

export function polygonAreaSf(points: SitePlanPoint[]): number {
  if (points.length < 3) return 0;
  const o = centroid(points);
  const xy = points.map((p) => latLngToXY(p, o));
  let signed = 0;
  for (let i = 0; i < xy.length; i++) {
    const j = (i + 1) % xy.length;
    signed += xy[i].x * xy[j].y - xy[j].x * xy[i].y;
  }
  const m2 = Math.abs(signed) / 2;
  return m2 * SF_PER_M2;
}

// ── Polygon perimeter (ft) ───────────────────────────────────────────────────

export function polygonPerimeterFt(points: SitePlanPoint[]): number {
  if (points.length < 2) return 0;
  const o = centroid(points);
  const xy = points.map((p) => latLngToXY(p, o));
  let total = 0;
  for (let i = 0; i < xy.length; i++) {
    const j = (i + 1) % xy.length;
    total += Math.hypot(xy[j].x - xy[i].x, xy[j].y - xy[i].y);
  }
  return total * FT_PER_M;
}

// ── Open polyline length (ft) — for frontage / measure chains ────────────────
// Same as polygonPerimeterFt but without the closing segment.
export function polygonPerimeterFtOpen(points: SitePlanPoint[]): number {
  if (points.length < 2) return 0;
  const o = centroid(points);
  const xy = points.map((p) => latLngToXY(p, o));
  let total = 0;
  for (let i = 0; i < xy.length - 1; i++) {
    total += Math.hypot(xy[i + 1].x - xy[i].x, xy[i + 1].y - xy[i].y);
  }
  return total * FT_PER_M;
}

// ── Segment length in ft (for live drawing dimension labels) ─────────────────

export function segmentLengthFt(a: SitePlanPoint, b: SitePlanPoint): number {
  const o = centroid([a, b]);
  const ax = latLngToXY(a, o);
  const bx = latLngToXY(b, o);
  const m = Math.hypot(bx.x - ax.x, bx.y - ax.y);
  return m * FT_PER_M;
}

// ── Signed area (tells us CCW vs CW) ─────────────────────────────────────────

function signedAreaM2(xy: XYPoint[]): number {
  let signed = 0;
  for (let i = 0; i < xy.length; i++) {
    const j = (i + 1) % xy.length;
    signed += xy[i].x * xy[j].y - xy[j].x * xy[i].y;
  }
  return signed / 2;
}

// ── Inset polygon for setback visualization ──────────────────────────────────
//
// Shrinks a closed polygon inward by `distanceFt`. For each vertex we move
// along the angle bisector of the two adjacent edges. Produces a decent
// approximation of a Minkowski offset for typical parcel shapes (rectangles,
// L-shapes). At very acute corners we clamp the bisector distance to avoid
// the polygon exploding. This is visualization-grade, not survey-grade.
export function insetPolygon(
  points: SitePlanPoint[],
  distanceFt: number
): SitePlanPoint[] {
  if (points.length < 3 || distanceFt <= 0) return points;
  const distM = distanceFt / FT_PER_M;
  const o = centroid(points);
  const xy = points.map((p) => latLngToXY(p, o));

  // Normalize orientation to CCW so inward normal is consistently left.
  const signed = signedAreaM2(xy);
  const ccw = signed > 0;
  const pts = ccw ? xy : [...xy].reverse();

  const N = pts.length;
  const out: XYPoint[] = [];
  for (let i = 0; i < N; i++) {
    const prev = pts[(i - 1 + N) % N];
    const cur = pts[i];
    const next = pts[(i + 1) % N];

    const v1x = cur.x - prev.x;
    const v1y = cur.y - prev.y;
    const v2x = next.x - cur.x;
    const v2y = next.y - cur.y;
    const l1 = Math.hypot(v1x, v1y);
    const l2 = Math.hypot(v2x, v2y);
    if (l1 === 0 || l2 === 0) {
      out.push(cur);
      continue;
    }
    // Inward normals (rotate edge 90° CCW → left-of-direction)
    const n1x = -v1y / l1;
    const n1y = v1x / l1;
    const n2x = -v2y / l2;
    const n2y = v2x / l2;
    // Bisector (sum of inward normals, normalized)
    const bx0 = n1x + n2x;
    const by0 = n1y + n2y;
    const bl = Math.hypot(bx0, by0);
    if (bl === 0) {
      // 180° corner — just offset by one normal
      out.push({ x: cur.x + n1x * distM, y: cur.y + n1y * distM });
      continue;
    }
    const bx = bx0 / bl;
    const by = by0 / bl;
    // cos(half-angle) = dot(n1, bisector)
    const cosHalf = Math.max(n1x * bx + n1y * by, 0.2); // clamp to avoid spikes
    const moveDist = distM / cosHalf;
    out.push({ x: cur.x + bx * moveDist, y: cur.y + by * moveDist });
  }

  const result = out.map((p) => xyToLatLng(p, o));
  return ccw ? result : result.reverse();
}

// ── Snapping ─────────────────────────────────────────────────────────────────

export interface SnapOptions {
  rightAngle: boolean;
  vertex: boolean;
  gridFt: number; // 0 = off
  vertexPixelRadius?: number; // fallback when we have a map ref
}

/** Snap `cursor` to the nearest existing vertex (within `radiusFt`), else null. */
export function snapToNearestVertex(
  cursor: SitePlanPoint,
  others: SitePlanPoint[],
  radiusFt: number
): SitePlanPoint | null {
  if (others.length === 0) return null;
  const o = centroid([cursor, ...others]);
  const cxy = latLngToXY(cursor, o);
  const radiusM = radiusFt / FT_PER_M;
  let best: SitePlanPoint | null = null;
  let bestD = radiusM;
  for (const v of others) {
    const vxy = latLngToXY(v, o);
    const d = Math.hypot(vxy.x - cxy.x, vxy.y - cxy.y);
    if (d < bestD) {
      bestD = d;
      best = v;
    }
  }
  return best;
}

/** Snap the proposed new edge endpoint to right-angle multiples relative to
 *  the previous edge direction. Returns the snapped lat/lng or the original.
 *  tolRad: snap zone (radians). Typical ~8° (0.14 rad). */
export function snapRightAngle(
  prevPrev: SitePlanPoint | null,
  prev: SitePlanPoint,
  cursor: SitePlanPoint,
  tolRad = (10 * Math.PI) / 180
): SitePlanPoint {
  // Anchor for xy conversion.
  const o = centroid([prev, cursor, ...(prevPrev ? [prevPrev] : [])]);
  const pXY = latLngToXY(prev, o);
  const cXY = latLngToXY(cursor, o);
  const dx = cXY.x - pXY.x;
  const dy = cXY.y - pXY.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return cursor;

  // Reference axis: the previous edge direction if we have one, else east (x).
  let refAngle = 0;
  if (prevPrev) {
    const ppXY = latLngToXY(prevPrev, o);
    refAngle = Math.atan2(pXY.y - ppXY.y, pXY.x - ppXY.x);
  }
  const curAngle = Math.atan2(dy, dx);
  const rel = curAngle - refAngle;
  // Normalize to (-π, π]
  const relN = Math.atan2(Math.sin(rel), Math.cos(rel));

  // Candidate snap angles (relative to refAngle). When there's a previous
  // edge, we snap to straight, 45°, 90°, 135°, 180° and their negatives.
  const candidates = [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4, Math.PI, -Math.PI / 4, -Math.PI / 2, -(3 * Math.PI) / 4];
  let bestSnap: number | null = null;
  let bestDelta = tolRad;
  for (const c of candidates) {
    const d = Math.abs(Math.atan2(Math.sin(relN - c), Math.cos(relN - c)));
    if (d < bestDelta) {
      bestDelta = d;
      bestSnap = c;
    }
  }
  if (bestSnap == null) return cursor;

  const snapped = refAngle + bestSnap;
  const nx = pXY.x + Math.cos(snapped) * len;
  const ny = pXY.y + Math.sin(snapped) * len;
  return xyToLatLng({ x: nx, y: ny }, o);
}

/** Grid-snap cursor to nearest gridFt point relative to the first vertex. */
export function snapToGrid(
  cursor: SitePlanPoint,
  origin: SitePlanPoint,
  gridFt: number
): SitePlanPoint {
  if (gridFt <= 0) return cursor;
  const o = { lat: origin.lat, lng: origin.lng };
  const xy = latLngToXY(cursor, o);
  const gridM = gridFt / FT_PER_M;
  const nx = Math.round(xy.x / gridM) * gridM;
  const ny = Math.round(xy.y / gridM) * gridM;
  return xyToLatLng({ x: nx, y: ny }, o);
}

/** Distance (in ft) from `p` to the first vertex, used for "close polygon" snap. */
export function distanceFt(a: SitePlanPoint, b: SitePlanPoint): number {
  const o = centroid([a, b]);
  const ax = latLngToXY(a, o);
  const bx = latLngToXY(b, o);
  return Math.hypot(ax.x - bx.x, ax.y - bx.y) * FT_PER_M;
}

// ── Generate a default rectangular footprint from area + center ──────────────
//
// If the parcel was traced but there's no building yet, we seed a centered
// square footprint sized to the scenario's footprint_sf. Aligns to the
// dominant parcel edge so it "fits" visually.
export function generateCenteredRectangle(
  parcelPoints: SitePlanPoint[],
  targetAreaSf: number,
  rotationDeg = 0
): SitePlanPoint[] {
  if (parcelPoints.length < 3 || targetAreaSf <= 0) return [];
  const o = centroid(parcelPoints);
  const side = Math.sqrt(targetAreaSf) / FT_PER_M; // meters
  const half = side / 2;
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const corners: XYPoint[] = [
    { x: -half, y: -half },
    { x: half, y: -half },
    { x: half, y: half },
    { x: -half, y: half },
  ].map((c) => ({ x: c.x * cos - c.y * sin, y: c.x * sin + c.y * cos }));
  return corners.map((c) => xyToLatLng(c, o));
}

// ── Auto-detect principal edge angle of a polygon (for default building rotation)

export function dominantEdgeAngleDeg(points: SitePlanPoint[]): number {
  if (points.length < 2) return 0;
  const o = centroid(points);
  const xy = points.map((p) => latLngToXY(p, o));
  let maxLen = 0;
  let angle = 0;
  for (let i = 0; i < xy.length; i++) {
    const j = (i + 1) % xy.length;
    const dx = xy[j].x - xy[i].x;
    const dy = xy[j].y - xy[i].y;
    const len = Math.hypot(dx, dy);
    if (len > maxLen) {
      maxLen = len;
      angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    }
  }
  return angle;
}
