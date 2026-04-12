"use client";

import React from "react";
import type { MassingScenario, MassingSummary, FloorUseType } from "@/lib/types";
import { FLOOR_USE_COLORS, FLOOR_USE_TYPE_LABELS } from "@/lib/types";

interface Props {
  scenario: MassingScenario;
  summary: MassingSummary;
}

const SVG_W = 500;
const BODY_L = 70;   // left edge of building body
const BODY_R = 370;   // right edge of building body
const BODY_CX = (BODY_L + BODY_R) / 2;
const BODY_W = BODY_R - BODY_L;
const TOP_MARGIN = 50;
const BOTTOM_MARGIN = 40;
const LABEL_X = BODY_R + 15;

export default function MassingSectionCut({ scenario, summary }: Props) {
  const aboveFloors = scenario.floors.filter(f => !f.is_below_grade).sort((a, b) => a.sort_order - b.sort_order);
  const belowFloors = scenario.floors.filter(f => f.is_below_grade).sort((a, b) => a.sort_order - b.sort_order);

  const totalAboveFt = summary.total_height_ft;
  const totalBelowFt = summary.total_below_grade_ft;
  const totalFt = totalAboveFt + totalBelowFt;
  if (totalFt <= 0) {
    return (
      <div className="flex items-center justify-center h-64 border border-dashed rounded-md text-muted-foreground text-sm">
        Add floors to see section cut
      </div>
    );
  }

  const scaleFactor = Math.min(400 / Math.max(totalFt, 1), 6);
  const aboveH = totalAboveFt * scaleFactor;
  const belowH = totalBelowFt * scaleFactor;
  const gradeY = TOP_MARGIN + aboveH;
  const svgH = TOP_MARGIN + aboveH + belowH + BOTTOM_MARGIN;

  const maxPlate = Math.max(...scenario.floors.map(f => f.floor_plate_sf), 1);

  // Height limit line
  const heightLimitFt = summary.max_allowed_height_ft;
  const heightLimitY = heightLimitFt > 0 ? gradeY - heightLimitFt * scaleFactor : -100;

  // Render floors top-to-bottom for above grade (reversed sort), bottom-to-top for below grade
  const aboveReversed = [...aboveFloors].reverse();

  let cursorY = TOP_MARGIN; // start at top of above-grade stack

  const floorRects: Array<{
    floor: typeof aboveFloors[0]; x: number; y: number; w: number; h: number;
  }> = [];

  // Above grade — render from top to bottom
  for (const f of aboveReversed) {
    const h = f.floor_to_floor_ft * scaleFactor;
    const w = (f.floor_plate_sf / maxPlate) * BODY_W;
    const x = BODY_CX - w / 2;
    floorRects.push({ floor: f, x, y: cursorY, w, h });
    cursorY += h;
  }

  // Below grade — render from grade downward
  cursorY = gradeY;
  for (const f of belowFloors) {
    const h = f.floor_to_floor_ft * scaleFactor;
    const w = (f.floor_plate_sf / maxPlate) * BODY_W;
    const x = BODY_CX - w / 2;
    floorRects.push({ floor: f, x, y: cursorY, w, h });
    cursorY += h;
  }

  // Collect unique use types for legend
  const useTypes = [...new Set(scenario.floors.map(f => f.use_type))];

  const fc = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(0)}K` : `${n}`;

  return (
    <svg viewBox={`0 0 ${SVG_W} ${svgH}`} className="w-full" preserveAspectRatio="xMidYMid meet">
      {/* Hatching pattern for below-grade */}
      <defs>
        <pattern id="hatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" stroke="#ffffff" strokeWidth="0.5" opacity="0.1" />
        </pattern>
      </defs>

      {/* Height limit line */}
      {heightLimitFt > 0 && heightLimitY > 0 && (
        <>
          <line x1={BODY_L - 10} y1={heightLimitY} x2={BODY_R + 10} y2={heightLimitY}
            stroke="#ef4444" strokeWidth="1" strokeDasharray="6,3" opacity="0.7" />
          <text x={BODY_R + 12} y={heightLimitY + 3} fill="#ef4444" fontSize="8" opacity="0.8">
            LIMIT {heightLimitFt}ft
          </text>
        </>
      )}

      {/* Floor rectangles */}
      {floorRects.map(({ floor, x, y, w, h }) => {
        const color = FLOOR_USE_COLORS[floor.use_type as FloorUseType];
        const showLabel = h >= 14;
        return (
          <g key={floor.id}>
            <rect x={x} y={y} width={w} height={h} fill={color.fill} opacity={0.6} stroke={color.fill} strokeWidth="1" rx="1" />
            {floor.is_below_grade && <rect x={x} y={y} width={w} height={h} fill="url(#hatch)" />}
            {showLabel && (
              <>
                <text x={x + 6} y={y + h / 2 - 3} fill="white" fontSize="9" fontWeight="500" opacity="0.9">
                  {floor.label || FLOOR_USE_TYPE_LABELS[floor.use_type]}
                </text>
                <text x={x + 6} y={y + h / 2 + 8} fill="white" fontSize="7" opacity="0.6">
                  {fc(floor.floor_plate_sf)} SF · {floor.floor_to_floor_ft}ft
                  {floor.units_on_floor > 0 ? ` · ${floor.units_on_floor}u` : ""}
                </text>
              </>
            )}
            {!showLabel && (
              <text x={LABEL_X} y={y + h / 2 + 3} fill={color.fill} fontSize="7" opacity="0.8">
                {floor.label || floor.use_type} · {fc(floor.floor_plate_sf)}
              </text>
            )}
          </g>
        );
      })}

      {/* Grade line */}
      <line x1={BODY_L - 20} y1={gradeY} x2={BODY_R + 20} y2={gradeY}
        stroke="#22c55e" strokeWidth="2" />
      <text x={BODY_L - 20} y={gradeY - 5} fill="#22c55e" fontSize="8" fontWeight="600">GRADE</text>

      {/* Total height dimension (left side) */}
      {totalAboveFt > 0 && (
        <>
          <line x1={BODY_L - 30} y1={TOP_MARGIN} x2={BODY_L - 30} y2={gradeY}
            stroke="#a3a3a3" strokeWidth="0.5" />
          <line x1={BODY_L - 34} y1={TOP_MARGIN} x2={BODY_L - 26} y2={TOP_MARGIN}
            stroke="#a3a3a3" strokeWidth="0.5" />
          <line x1={BODY_L - 34} y1={gradeY} x2={BODY_L - 26} y2={gradeY}
            stroke="#a3a3a3" strokeWidth="0.5" />
          <text x={BODY_L - 30} y={gradeY - aboveH / 2 + 3} fill="#a3a3a3" fontSize="8" textAnchor="middle"
            transform={`rotate(-90, ${BODY_L - 38}, ${gradeY - aboveH / 2})`}>
            {totalAboveFt.toFixed(0)} ft
          </text>
        </>
      )}

      {/* Summary stats bottom */}
      <text x={BODY_L} y={svgH - 12} fill="#a3a3a3" fontSize="9">
        {fc(summary.total_gsf)} GSF · {fc(summary.total_nrsf)} NRSF · {summary.total_units} units · {summary.total_parking_spaces_est} parking
      </text>

      {/* Legend */}
      {useTypes.map((t, i) => (
        <g key={t} transform={`translate(${LABEL_X}, ${svgH - 28 - (useTypes.length - 1 - i) * 14})`}>
          <rect width="8" height="8" fill={FLOOR_USE_COLORS[t].fill} opacity="0.7" rx="1" />
          <text x="12" y="7" fill="#a3a3a3" fontSize="8">{FLOOR_USE_TYPE_LABELS[t]}</text>
        </g>
      ))}

      {/* Over-height warning */}
      {!summary.height_compliant && heightLimitY > 0 && (
        <text x={BODY_CX} y={heightLimitY - 8} fill="#ef4444" fontSize="9" textAnchor="middle" fontWeight="600">
          ⚠ {(summary.total_height_ft - summary.max_allowed_height_ft).toFixed(0)}ft OVER LIMIT
        </text>
      )}
    </svg>
  );
}
