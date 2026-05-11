/**
 * Shared area-schedule computation. Used by:
 *   - the right-inspector panel in the floor plan editor
 *   - the architect-package PDF renderer (server-side)
 *
 * Input is the editor's flat `els[]` array; output is the standard
 * architectural deliverable: per-room rows with dimensions + area,
 * a grouped summary by label, and a grand total.
 *
 * Coordinate system reminder: the editor stores positions in pixels at
 * 12 px per foot (PX_PER_FT). All conversions live here so the caller
 * doesn't have to know the scale.
 */

export const PX_PER_FT = 12;

export interface PlanElementLike {
  type: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  label?: string;
}

export interface AreaScheduleRow {
  id: string;
  label: string;
  /** width in feet */
  widthFt: number;
  /** height in feet */
  heightFt: number;
  /** area in ft² */
  areaFt2: number;
}

export interface AreaScheduleGroup {
  label: string;
  count: number;
  totalFt2: number;
}

export interface AreaSchedule {
  rows: AreaScheduleRow[];
  groups: AreaScheduleGroup[];
  totalFt2: number;
  /** Side length in ft of the smallest axis-aligned bounding box that
   *  contains all rooms — used as a sanity-check denominator for an
   *  "efficiency" ratio when the user hasn't entered a gross SF. */
  bboxFt2: number | null;
}

function isRoom(el: PlanElementLike): el is Required<Pick<PlanElementLike, "type" | "x" | "y" | "w" | "h" | "label">> {
  return el.type === "room"
    && typeof el.x === "number"
    && typeof el.y === "number"
    && typeof el.w === "number"
    && typeof el.h === "number"
    && typeof el.label === "string";
}

export function computeAreaSchedule(
  els: PlanElementLike[],
): AreaSchedule {
  const rooms = els.filter(isRoom);

  const rows: AreaScheduleRow[] = rooms.map((r, idx) => {
    const widthFt = r.w / PX_PER_FT;
    const heightFt = r.h / PX_PER_FT;
    return {
      // Synthetic ID — the editor's el.id isn't on PlanElementLike here.
      // It's fine; consumers only need it as a React key / table row key.
      id: `room-${idx}`,
      label: r.label || "Room",
      widthFt: roundTo(widthFt, 1),
      heightFt: roundTo(heightFt, 1),
      areaFt2: roundTo(widthFt * heightFt, 1),
    };
  });

  const groupMap = new Map<string, AreaScheduleGroup>();
  for (const row of rows) {
    const cur = groupMap.get(row.label);
    if (cur) {
      cur.count += 1;
      cur.totalFt2 = roundTo(cur.totalFt2 + row.areaFt2, 1);
    } else {
      groupMap.set(row.label, { label: row.label, count: 1, totalFt2: row.areaFt2 });
    }
  }
  const groups = Array.from(groupMap.values()).sort((a, b) => b.totalFt2 - a.totalFt2);

  const totalFt2 = roundTo(rows.reduce((s, r) => s + r.areaFt2, 0), 1);

  // Bounding box of all rooms (useful for an "efficiency vs envelope" view).
  let bboxFt2: number | null = null;
  if (rooms.length > 0) {
    const xs1 = rooms.map((r) => r.x);
    const ys1 = rooms.map((r) => r.y);
    const xs2 = rooms.map((r) => r.x + r.w);
    const ys2 = rooms.map((r) => r.y + r.h);
    const w = Math.max(...xs2) - Math.min(...xs1);
    const h = Math.max(...ys2) - Math.min(...ys1);
    bboxFt2 = roundTo((w / PX_PER_FT) * (h / PX_PER_FT), 1);
  }

  return { rows, groups, totalFt2, bboxFt2 };
}

function roundTo(n: number, digits: number): number {
  const m = Math.pow(10, digits);
  return Math.round(n * m) / m;
}

/**
 * Infer a BR / BA count from the room labels in a schedule. We look at
 * labels (case-insensitive):
 *   - bedrooms: any label that mentions "bed" or "bdrm" (Bedroom, Master
 *     Bedroom, Bdrm 2, etc.) — does NOT match "Bedroom Closet" which lacks
 *     a digit/standalone word; we keep it simple and just count rooms.
 *   - full bathroom: "bath" / "bathroom" / "WC"
 *   - half bathroom: "half bath" / "powder" → counts as 0.5
 *
 * Returns nulls when nothing matches so callers can choose to hide the
 * inferred badge rather than showing "0 BR / 0 BA".
 */
export function inferBedroomBathroom(
  rows: AreaScheduleRow[],
): { bedrooms: number | null; bathrooms: number | null } {
  let bedrooms = 0;
  let bathrooms = 0;
  let matchedAny = false;

  for (const row of rows) {
    const label = row.label.toLowerCase();
    if (/\bbed(room)?\b|\bbdrm\b|\bmaster\b/.test(label) && !/closet|wic|walk\s*-?in/.test(label)) {
      bedrooms += 1;
      matchedAny = true;
      continue;
    }
    if (/\bhalf\s*bath\b|\bpowder\b/.test(label)) {
      bathrooms += 0.5;
      matchedAny = true;
      continue;
    }
    if (/\bbath(room)?\b|\bwc\b|\bensuite\b/.test(label)) {
      bathrooms += 1;
      matchedAny = true;
      continue;
    }
  }

  if (!matchedAny) return { bedrooms: null, bathrooms: null };
  return {
    bedrooms: bedrooms > 0 ? bedrooms : null,
    bathrooms: bathrooms > 0 ? roundTo(bathrooms, 1) : null,
  };
}

/** Render the inferred BR/BA as a compact human label, or null if nothing
 *  could be inferred. e.g. "2 BR / 2 BA", "Studio / 1 BA", "3 BR". */
export function formatBedroomBathroom(
  inferred: { bedrooms: number | null; bathrooms: number | null },
): string | null {
  const { bedrooms, bathrooms } = inferred;
  if (bedrooms === null && bathrooms === null) return null;
  const brPart = bedrooms === null ? null : bedrooms === 0 ? "Studio" : `${bedrooms} BR`;
  const baPart = bathrooms === null ? null : `${bathrooms} BA`;
  return [brPart, baPart].filter(Boolean).join(" / ");
}
