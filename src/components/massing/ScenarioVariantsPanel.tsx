"use client";

// ScenarioVariantsPanel — modal that previews 9 candidate massing stacks
// (3 heights × 3 unit-mix archetypes) in a grid, lets the analyst pick
// one and apply it to the active building. Delivers the Algoma "see
// hundreds of options" thesis without any server round-trip or mutation
// to the scenario list.

import React, { useMemo } from "react";
import { X, Check, AlertTriangle, Sparkles, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  generateScenarioVariants,
  type VariantInputs,
  type ScenarioVariant,
} from "./scenario-generator";
import type { BuildingFloor, UnitMixEntry } from "@/lib/types";

interface Props {
  inputs: VariantInputs;
  activeBuildingLabel: string;
  onClose: () => void;
  onApply: (floors: BuildingFloor[], unit_mix: UnitMixEntry[], variant: ScenarioVariant) => void;
}

const fn = (n: number) => (n || n === 0 ? Math.round(n).toLocaleString("en-US") : "—");

export default function ScenarioVariantsPanel({
  inputs, activeBuildingLabel, onClose, onApply,
}: Props) {
  const variants = useMemo(() => generateScenarioVariants(inputs), [inputs]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="bg-card rounded-xl border shadow-lifted-md w-full max-w-5xl max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b">
          <div>
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-amber-400" />
              Scenario Variants — {activeBuildingLabel}
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Nine candidate stacks across three heights and three unit-mix archetypes. Pick one to overwrite this building&apos;s floor stack.
            </p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto">
          {variants.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-8">
              No footprint set for this building — draw one on the Site Plan first or type a Base Footprint, then re-open this panel.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {variants.map(v => {
                const compliant = v.compliance.height_ok && v.compliance.far_ok && v.compliance.coverage_ok;
                return (
                  <button
                    key={v.id}
                    onClick={() => onApply(v.floors, v.unit_mix, v)}
                    className={`text-left border rounded-lg p-3 transition-all hover:brightness-110 hover:border-primary/60 ${
                      compliant
                        ? "bg-emerald-500/5 border-emerald-500/30"
                        : "bg-amber-500/5 border-amber-500/30"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-center gap-1.5">
                        <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-xs font-semibold">{v.label}</span>
                      </div>
                      {compliant ? (
                        <Check className="h-3 w-3 text-emerald-400" />
                      ) : (
                        <AlertTriangle className="h-3 w-3 text-amber-400" />
                      )}
                    </div>
                    <p className="text-2xs text-muted-foreground mb-3 leading-relaxed">{v.strategy}</p>
                    <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-2xs">
                      <div>
                        <div className="text-muted-foreground">Units</div>
                        <div className="font-semibold tabular-nums text-blue-300">{fn(v.projected_units)}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">GSF</div>
                        <div className="font-semibold tabular-nums text-blue-300">{fn(v.projected_gsf)}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Stories</div>
                        <div className="font-semibold tabular-nums text-blue-300">{v.stories}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Height</div>
                        <div className="font-semibold tabular-nums text-blue-300">{fn(v.height_ft)} ft</div>
                      </div>
                    </div>
                    {!compliant && (
                      <div className="mt-2 text-2xs text-amber-400 space-y-0.5">
                        {!v.compliance.height_ok && <div>• Exceeds height cap</div>}
                        {!v.compliance.far_ok && <div>• Exceeds FAR cap</div>}
                        {!v.compliance.coverage_ok && <div>• Exceeds lot coverage</div>}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          {variants.length > 0 && (
            <p className="text-2xs text-muted-foreground mt-4">
              Clicking a card replaces this building&apos;s floor stack + unit mix. Your other scenarios, unit-group rent assumptions, and dev budget are untouched.
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 p-4 border-t bg-muted/10">
          <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  );
}
