"use client";

import React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Trash2 } from "lucide-react";
import type { BuildingFloor, FloorUseType } from "@/lib/types";
import { FLOOR_USE_TYPE_LABELS, FLOOR_USE_COLORS, FLOOR_HEIGHT_DEFAULTS, PARKING_ABOVE_GRADE_HEIGHT } from "@/lib/types";

interface FloorRowProps {
  floor: BuildingFloor;
  onChange: (updates: Partial<BuildingFloor>) => void;
  onDelete: () => void;
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

export default function FloorRow({ floor, onChange, onDelete }: FloorRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: floor.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  const isRes = floor.use_type === "residential";
  const color = FLOOR_USE_COLORS[floor.use_type];

  return (
    <tr ref={setNodeRef} style={style} className="border-b hover:bg-muted/10 group">
      <td className="w-[24px] px-0.5 py-1" {...attributes} {...listeners}>
        <GripVertical className="h-3.5 w-3.5 text-muted-foreground cursor-grab" />
      </td>
      <td className="px-1 py-1">
        <div className="flex items-center gap-1.5">
          <span className={`w-2.5 h-2.5 rounded-sm`} style={{ background: color.fill }} />
          <select value={floor.use_type} onChange={e => {
            const t = e.target.value as FloorUseType;
            onChange({
              use_type: t,
              floor_to_floor_ft: floor.is_below_grade && t === "parking" ? FLOOR_HEIGHT_DEFAULTS.parking : !floor.is_below_grade && t === "parking" ? PARKING_ABOVE_GRADE_HEIGHT : FLOOR_HEIGHT_DEFAULTS[t],
              efficiency_pct: t === "parking" ? 98 : t === "retail" ? 95 : t === "residential" ? 80 : t === "office" ? 87 : t === "lobby_amenity" ? 60 : 0,
              units_on_floor: t === "residential" ? floor.units_on_floor : 0,
            });
          }} className="bg-transparent text-xs outline-none w-[100px]">
            {(Object.keys(FLOOR_USE_TYPE_LABELS) as FloorUseType[]).map(t => (
              <option key={t} value={t}>{FLOOR_USE_TYPE_LABELS[t]}</option>
            ))}
          </select>
        </div>
      </td>
      <td className="px-1 py-1"><CellInput value={floor.floor_plate_sf} onChange={v => onChange({ floor_plate_sf: v })} width="w-[90px]" /></td>
      <td className="px-1 py-1"><CellInput value={floor.floor_to_floor_ft} onChange={v => onChange({ floor_to_floor_ft: v })} suffix="ft" decimals={1} width="w-[70px]" /></td>
      <td className="px-1 py-1">
        {isRes ? <CellInput value={floor.units_on_floor} onChange={v => onChange({ units_on_floor: v })} width="w-[55px]" /> : <span className="text-xs text-muted-foreground">—</span>}
      </td>
      <td className="px-1 py-1"><CellInput value={floor.efficiency_pct} onChange={v => onChange({ efficiency_pct: v })} suffix="%" width="w-[55px]" /></td>
      <td className="px-1 py-1 text-right text-xs tabular-nums text-muted-foreground w-[70px]">
        {Math.round(floor.floor_plate_sf * (floor.efficiency_pct / 100)).toLocaleString()}
      </td>
      <td className="w-[24px] px-0.5 py-1">
        <button onClick={onDelete} className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </td>
    </tr>
  );
}
