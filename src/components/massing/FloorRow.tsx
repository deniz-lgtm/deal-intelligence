"use client";

import React from "react";
import { v4 as uuidv4 } from "uuid";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Trash2, Plus, X } from "lucide-react";
import type { BuildingFloor, FloorUseType, FloorAdditionalUse } from "@/lib/types";
import { FLOOR_USE_TYPE_LABELS, FLOOR_USE_COLORS, FLOOR_HEIGHT_DEFAULTS, PARKING_ABOVE_GRADE_HEIGHT } from "@/lib/types";
import { primarySF, efficiencyForUse } from "./massing-utils";

interface FloorRowProps {
  floor: BuildingFloor;
  onChange: (updates: Partial<BuildingFloor>) => void;
  onDelete: () => void;
  // Max allowed plate SF — sourced from the scenario's footprint. Any
  // edit that would push plate_sf above this value is clamped so the
  // massing stays within the drawn footprint.
  maxPlate?: number;
}

function CellInput({ value, onChange, prefix, suffix, decimals = 0, width = "w-[80px]" }: {
  value: number; onChange: (v: number) => void;
  prefix?: string; suffix?: string; decimals?: number; width?: string;
}) {
  const fmt = (v: number) => v === 0 ? "" : v.toLocaleString("en-US", { maximumFractionDigits: decimals });
  const [raw, setRaw] = React.useState(fmt(value));
  React.useEffect(() => { setRaw(fmt(value)); }, [value]);
  return (
    <div className={`flex items-center border rounded bg-background overflow-hidden ${width}`}>
      {prefix && <span className="px-1 text-xs text-muted-foreground bg-muted border-r">{prefix}</span>}
      <input type="text" inputMode="decimal" value={raw}
        onChange={e => setRaw(e.target.value)}
        onBlur={() => { const v = parseFloat(raw.replace(/,/g, "")) || 0; onChange(v); setRaw(fmt(v)); }}
        className="flex-1 px-1.5 py-1 text-xs outline-none bg-transparent text-blue-300 tabular-nums" placeholder="0" />
      {suffix && <span className="px-1 text-xs text-muted-foreground bg-muted border-l">{suffix}</span>}
    </div>
  );
}

export default function FloorRow({ floor, onChange, onDelete, maxPlate }: FloorRowProps) {
  const clampPlate = (v: number) =>
    maxPlate && maxPlate > 0 ? Math.min(v, maxPlate) : v;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: floor.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  const isRes = floor.use_type === "residential";
  const color = FLOOR_USE_COLORS[floor.use_type];
  const additional: FloorAdditionalUse[] = floor.additional_uses || [];
  const primary_sf = primarySF(floor);

  const addUse = () => {
    // Default new use to 20% of current plate, use type unused by floor yet
    const existingUses = new Set<FloorUseType>([floor.use_type, ...additional.map(u => u.use_type)]);
    const defaultType: FloorUseType = (Object.keys(FLOOR_USE_TYPE_LABELS) as FloorUseType[])
      .find(t => !existingUses.has(t)) || "retail";
    const defaultSf = Math.round(floor.floor_plate_sf * 0.2);
    onChange({
      additional_uses: [...additional, { id: uuidv4(), use_type: defaultType, sf: defaultSf }],
    });
  };

  const updateUse = (id: string, upd: Partial<FloorAdditionalUse>) => {
    onChange({ additional_uses: additional.map(u => u.id === id ? { ...u, ...upd } : u) });
  };

  const removeUse = (id: string) => {
    onChange({ additional_uses: additional.filter(u => u.id !== id) });
  };

  // Over-allocation warning (sum of additional > plate)
  const additionalTotal = additional.reduce((s, u) => s + u.sf, 0);
  const overAllocated = additionalTotal > floor.floor_plate_sf;

  return (
    <>
      <tr ref={setNodeRef} style={style} className="border-b hover:bg-muted/10 group">
        <td className="w-[24px] px-0.5 py-1" {...attributes} {...listeners}>
          <GripVertical className="h-3.5 w-3.5 text-muted-foreground cursor-grab" />
        </td>
        <td className="px-1 py-1 text-[10px] text-muted-foreground tabular-nums w-[32px]">
          {floor.label?.split("—")[0]?.trim() || ""}
        </td>
        <td className="px-1 py-1">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: color.fill }} />
            <select value={floor.use_type} onChange={e => {
              const t = e.target.value as FloorUseType;
              onChange({
                use_type: t,
                floor_to_floor_ft: floor.is_below_grade && t === "parking" ? FLOOR_HEIGHT_DEFAULTS.parking : !floor.is_below_grade && t === "parking" ? PARKING_ABOVE_GRADE_HEIGHT : FLOOR_HEIGHT_DEFAULTS[t],
                efficiency_pct: efficiencyForUse(t),
                units_on_floor: t === "residential" ? floor.units_on_floor : 0,
              });
            }} className="bg-background text-xs text-foreground outline-none w-[90px] rounded border border-border/40">
              {(Object.keys(FLOOR_USE_TYPE_LABELS) as FloorUseType[]).map(t => (
                <option key={t} value={t}>{FLOOR_USE_TYPE_LABELS[t]}</option>
              ))}
            </select>
            <button onClick={addUse}
              className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity"
              title="Add another use on this floor">
              <Plus className="h-3 w-3 text-muted-foreground" />
            </button>
          </div>
        </td>
        <td className="px-1 py-1">
          {additional.length > 0 ? (
            <CellInput
              value={primary_sf}
              onChange={v => {
                // User edits the PRIMARY use's SF. Total plate = primary + Σ additional.
                const newPlate = clampPlate(v + additionalTotal);
                onChange({ floor_plate_sf: newPlate });
              }}
              width="w-[85px]"
            />
          ) : (
            <CellInput value={floor.floor_plate_sf} onChange={v => onChange({ floor_plate_sf: clampPlate(v) })} width="w-[85px]" />
          )}
        </td>
        <td className="px-1 py-1"><CellInput value={floor.floor_to_floor_ft} onChange={v => onChange({ floor_to_floor_ft: v })} suffix="ft" decimals={1} width="w-[65px]" /></td>
        <td className="px-1 py-1">
          {isRes ? <CellInput value={floor.units_on_floor} onChange={v => onChange({ units_on_floor: v })} width="w-[50px]" /> : <span className="text-xs text-muted-foreground">—</span>}
        </td>
        <td className="px-1 py-1"><CellInput value={floor.efficiency_pct} onChange={v => onChange({ efficiency_pct: v })} suffix="%" width="w-[50px]" /></td>
        <td className="px-1 py-1 text-right text-xs tabular-nums text-muted-foreground w-[65px]">
          {Math.round(primary_sf * (floor.efficiency_pct / 100)).toLocaleString()}
        </td>
        <td className="w-[24px] px-0.5 py-1">
          <button onClick={onDelete} className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </td>
      </tr>

      {/* Additional use rows — one per extra use. Primary SF auto-computes
          as the remainder after subtracting every additional use. */}
      {additional.map((u, idx) => {
        const usedTypes = new Set<FloorUseType>([floor.use_type, ...additional.map(a => a.use_type)]);
        const color2 = FLOOR_USE_COLORS[u.use_type];
        const eff = efficiencyForUse(u.use_type);
        return (
          <tr key={u.id} className="border-b bg-muted/5">
            <td />
            <td />
            <td className="px-1 py-1">
              <div className="flex items-center gap-1.5 pl-4">
                <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: color2.fill }} />
                <select value={u.use_type} onChange={e => updateUse(u.id, { use_type: e.target.value as FloorUseType })} className="bg-background text-xs text-foreground outline-none w-[90px] rounded border border-border/40">
                  {(Object.keys(FLOOR_USE_TYPE_LABELS) as FloorUseType[])
                    .filter(t => t === u.use_type || !usedTypes.has(t))
                    .map(t => (
                      <option key={t} value={t}>{FLOOR_USE_TYPE_LABELS[t]}</option>
                    ))}
                </select>
                <button onClick={() => removeUse(u.id)} className="text-muted-foreground hover:text-destructive" title="Remove this use">
                  <X className="h-3 w-3" />
                </button>
                {idx === additional.length - 1 && (
                  <button onClick={addUse}
                    className="opacity-60 hover:opacity-100 transition-opacity"
                    title="Add another use on this floor">
                    <Plus className="h-3 w-3 text-muted-foreground" />
                  </button>
                )}
              </div>
            </td>
            <td className="px-1 py-1"><CellInput value={u.sf} onChange={v => updateUse(u.id, { sf: v })} width="w-[85px]" /></td>
            <td colSpan={2} className="px-1 py-1 text-xs text-muted-foreground">
              {idx === additional.length - 1 ? (
                <span className={overAllocated ? "text-red-400" : ""}>
                  {overAllocated ? "⚠ over-allocated · " : ""}Total plate: {floor.floor_plate_sf.toLocaleString()} SF
                </span>
              ) : ""}
            </td>
            <td className="px-1 py-1 text-xs text-muted-foreground tabular-nums">{eff}%</td>
            <td className="px-1 py-1 text-right text-xs tabular-nums text-muted-foreground w-[65px]">
              {Math.round(u.sf * (eff / 100)).toLocaleString()}
            </td>
            <td />
          </tr>
        );
      })}
    </>
  );
}
