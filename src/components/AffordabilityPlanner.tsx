"use client";

import React, { useState, useEffect, useCallback } from "react";
import { v4 as uuidv4 } from "uuid";
import {
  Loader2, Plus, Trash2, DollarSign, TrendingUp, Sparkles,
  ChevronDown, ChevronRight, BarChart3,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

// ── Types ────────────────────────────────────────────────────────────────────

interface AmiTier {
  id: string;
  ami_pct: number;           // e.g., 60 for 60% AMI
  units_pct: number;         // % of total units at this tier
  units_count: number;       // computed from total
  max_rent_studio: number;
  max_rent_1br: number;
  max_rent_2br: number;
  max_rent_3br: number;
}

interface AffordabilityConfig {
  enabled: boolean;
  tiers: AmiTier[];
  total_units: number;
  market_rate_units: number;
  density_bonus_pct: number;        // additional density bonus earned
  density_bonus_source: string;     // e.g., "CA SB 1818", "Local IZ ordinance"
  tax_exemption_enabled: boolean;
  tax_exemption_pct: number;        // % reduction in property tax
  tax_exemption_years: number;      // how many years the exemption lasts
  tax_exemption_type: string;       // e.g., "LIHTC", "Local abatement", "Welfare exemption"
  notes: string;
}

interface AmiData {
  year: number;
  area_name: string;
  median_family_income: number;
  max_rents: Record<string, { studio: number; one_br: number; two_br: number; three_br: number }>;
  income_limits: Record<string, number[]>;
}

// ── Default AMI tier presets ─────────────────────────────────────────────────

const AMI_PRESETS = [
  { label: "LIHTC 9% (100% affordable)", tiers: [{ ami: 30, pct: 10 }, { ami: 50, pct: 30 }, { ami: 60, pct: 60 }] },
  { label: "LIHTC 4% (100% affordable)", tiers: [{ ami: 50, pct: 40 }, { ami: 60, pct: 60 }] },
  { label: "80/20 Mixed Income", tiers: [{ ami: 60, pct: 20 }] },
  { label: "Density Bonus (CA)", tiers: [{ ami: 50, pct: 15 }] },
  { label: "Inclusionary (20% at 80%)", tiers: [{ ami: 80, pct: 20 }] },
  { label: "Mixed (10% at 50%, 10% at 80%)", tiers: [{ ami: 50, pct: 10 }, { ami: 80, pct: 10 }] },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

const fc = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const fpct = (n: number) => n.toFixed(1) + "%";

// ── Component ────────────────────────────────────────────────────────────────

interface Props {
  dealId: string;
  totalUnits: number;
  avgMarketRent: number;      // weighted average market rent per unit/month
  currentTaxes: number;       // current taxes_annual from UW
  onConfigChange: (config: AffordabilityConfig) => void;
  initialConfig?: Partial<AffordabilityConfig> | null;
}

export default function AffordabilityPlanner({
  dealId,
  totalUnits,
  avgMarketRent,
  currentTaxes,
  onConfigChange,
  initialConfig,
}: Props) {
  const [open, setOpen] = useState(false);
  const [loadingAmi, setLoadingAmi] = useState(false);
  const [ami, setAmi] = useState<AmiData | null>(null);
  const [config, setConfig] = useState<AffordabilityConfig>({
    enabled: initialConfig?.enabled ?? false,
    tiers: initialConfig?.tiers ?? [],
    total_units: initialConfig?.total_units ?? totalUnits,
    market_rate_units: initialConfig?.market_rate_units ?? totalUnits,
    density_bonus_pct: initialConfig?.density_bonus_pct ?? 0,
    density_bonus_source: initialConfig?.density_bonus_source ?? "",
    tax_exemption_enabled: initialConfig?.tax_exemption_enabled ?? false,
    tax_exemption_pct: initialConfig?.tax_exemption_pct ?? 0,
    tax_exemption_years: initialConfig?.tax_exemption_years ?? 0,
    tax_exemption_type: initialConfig?.tax_exemption_type ?? "",
    notes: initialConfig?.notes ?? "",
  });

  // Update total units when prop changes
  useEffect(() => {
    setConfig((prev) => ({
      ...prev,
      total_units: totalUnits,
      market_rate_units: totalUnits - prev.tiers.reduce((s, t) => s + t.units_count, 0),
    }));
  }, [totalUnits]);

  // Fetch AMI data
  const fetchAmi = useCallback(async () => {
    setLoadingAmi(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/location-intelligence/fetch-ami`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ radius_miles: 3 }),
      });
      const json = await res.json();
      if (res.ok && json.data) {
        setAmi(json.data);
        toast.success(`AMI loaded: ${fc(json.data.median_family_income)}`);
      }
    } catch { /* non-fatal */ }
    setLoadingAmi(false);
  }, [dealId]);

  // Auto-fetch AMI on mount so presets work immediately without user action
  useEffect(() => {
    if (!ami) fetchAmi();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recompute when tiers change
  function updateConfig(newConfig: Partial<AffordabilityConfig>) {
    setConfig((prev) => {
      const next = { ...prev, ...newConfig };
      const affordableUnits = next.tiers.reduce((s, t) => s + t.units_count, 0);
      next.market_rate_units = Math.max(0, next.total_units - affordableUnits);
      onConfigChange(next);
      return next;
    });
  }

  function addTier(amiPct: number = 60) {
    const rents = getMaxRents(amiPct);
    const newTier: AmiTier = {
      id: uuidv4(),
      ami_pct: amiPct,
      units_pct: 10,
      units_count: Math.round(totalUnits * 0.1),
      max_rent_studio: rents.studio,
      max_rent_1br: rents.one_br,
      max_rent_2br: rents.two_br,
      max_rent_3br: rents.three_br,
    };
    updateConfig({ enabled: true, tiers: [...config.tiers, newTier] });
  }

  function updateTier(id: string, changes: Partial<AmiTier>) {
    const newTiers = config.tiers.map((t) => {
      if (t.id !== id) return t;
      const updated = { ...t, ...changes };
      // Recompute unit count from percentage
      if (changes.units_pct != null) {
        updated.units_count = Math.round(totalUnits * (updated.units_pct / 100));
      }
      // Recompute rents if AMI level changed
      if (changes.ami_pct != null) {
        const rents = getMaxRents(updated.ami_pct);
        updated.max_rent_studio = rents.studio;
        updated.max_rent_1br = rents.one_br;
        updated.max_rent_2br = rents.two_br;
        updated.max_rent_3br = rents.three_br;
      }
      return updated;
    });
    updateConfig({ tiers: newTiers });
  }

  function removeTier(id: string) {
    const newTiers = config.tiers.filter((t) => t.id !== id);
    updateConfig({ tiers: newTiers, enabled: newTiers.length > 0 });
  }

  function applyPreset(preset: typeof AMI_PRESETS[0]) {
    const tiers = preset.tiers.map((p) => {
      const rents = getMaxRents(p.ami);
      return {
        id: uuidv4(),
        ami_pct: p.ami,
        units_pct: p.pct,
        units_count: Math.round(totalUnits * (p.pct / 100)),
        max_rent_studio: rents.studio,
        max_rent_1br: rents.one_br,
        max_rent_2br: rents.two_br,
        max_rent_3br: rents.three_br,
      };
    });
    updateConfig({ enabled: true, tiers });
    toast.success(`Applied "${preset.label}" preset`);
  }

  function getMaxRents(amiPct: number) {
    if (!ami?.max_rents) return { studio: 0, one_br: 0, two_br: 0, three_br: 0 };
    const key = amiPct === 30 ? "ami_30" : amiPct === 50 ? "ami_50" : amiPct === 60 ? "ami_60" : amiPct === 80 ? "ami_80" : amiPct === 100 ? "ami_100" : "ami_120";
    return ami.max_rents[key] || { studio: 0, one_br: 0, two_br: 0, three_br: 0 };
  }

  // Revenue impact calculations
  const affordableUnits = config.tiers.reduce((s, t) => s + t.units_count, 0);
  const affordablePct = totalUnits > 0 ? (affordableUnits / totalUnits) * 100 : 0;

  // Weighted average affordable rent (use 2BR as proxy)
  const weightedAffordableRent = affordableUnits > 0
    ? config.tiers.reduce((s, t) => s + t.max_rent_2br * t.units_count, 0) / affordableUnits
    : 0;

  // Revenue comparison
  const marketGPR = totalUnits * avgMarketRent * 12;
  const blendedGPR = config.market_rate_units * avgMarketRent * 12 +
    config.tiers.reduce((s, t) => s + t.units_count * t.max_rent_2br * 12, 0);
  const revenueImpact = marketGPR - blendedGPR;
  const revenueImpactPct = marketGPR > 0 ? (revenueImpact / marketGPR) * 100 : 0;

  // Tax savings — pro-rata by unit count
  // Example: 100 units total, 20 affordable, $100k total taxes, 100% exemption
  //          → (20/100) × $100k × 100% = $20k savings
  const taxSavings = config.tax_exemption_enabled && totalUnits > 0
    ? (affordableUnits / totalUnits) * currentTaxes * (config.tax_exemption_pct / 100)
    : 0;

  return (
    <div className="border border-border/60 rounded-xl bg-card shadow-card overflow-hidden">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-3 px-5 py-3.5 bg-muted/20 hover:bg-muted/30 transition-colors text-left">
        {open ? <ChevronDown className="h-4 w-4 text-muted-foreground/60" /> : <ChevronRight className="h-4 w-4 text-muted-foreground/60" />}
        <span className="flex items-center gap-2">
          <DollarSign className="h-4 w-4 text-primary" />
          <span className="font-semibold text-sm">Affordability & Income Restrictions</span>
        </span>
        {config.enabled && (
          <span className="ml-auto text-xs text-primary bg-primary/10 px-2 py-0.5 rounded-full">
            {affordableUnits} units ({fpct(affordablePct)})
          </span>
        )}
      </button>

      {open && (
        <div className="px-5 py-4 space-y-4">
          {/* AMI info */}
          {ami ? (
            <div className="flex items-center gap-3 p-2.5 rounded-lg bg-primary/5 border border-primary/20 text-xs">
              <DollarSign className="h-3.5 w-3.5 text-primary flex-shrink-0" />
              <span>
                <span className="font-medium text-foreground/80">Area Median Income: {fc(ami.median_family_income)}</span>
                <span className="text-muted-foreground"> — {ami.area_name}, FY{ami.year}</span>
              </span>
            </div>
          ) : loadingAmi ? (
            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/10 border border-border/30 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin flex-shrink-0" />
              <span>Loading AMI data from HUD…</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-amber-500/5 border border-amber-500/20 text-xs text-amber-400">
              <DollarSign className="h-3.5 w-3.5 flex-shrink-0" />
              <span>Unable to load AMI data. Verify the property address is geocoded.</span>
            </div>
          )}

          {/* Quick presets */}
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">Quick Presets</div>
            <div className="flex flex-wrap gap-1.5">
              {AMI_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  onClick={() => applyPreset(preset)}
                  className="text-[10px] px-2.5 py-1 rounded-full border border-border/40 text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {/* Tiers */}
          {config.tiers.length > 0 && (
            <div className="space-y-2">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Affordability Tiers</div>
              {config.tiers.map((tier) => (
                <div key={tier.id} className="border border-border/40 rounded-lg p-3 bg-muted/5 space-y-2">
                  <div className="flex items-center gap-3">
                    <div>
                      <label className="text-[10px] text-muted-foreground">AMI Level</label>
                      <select
                        value={tier.ami_pct}
                        onChange={(e) => updateTier(tier.id, { ami_pct: Number(e.target.value) })}
                        className="block w-24 px-2 py-1 text-xs bg-background border border-border/40 rounded"
                      >
                        {[30, 50, 60, 80, 100, 120].map((v) => (
                          <option key={v} value={v}>{v}% AMI</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground">% of Units</label>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min={1}
                          max={100}
                          value={tier.units_pct}
                          onChange={(e) => updateTier(tier.id, { units_pct: Number(e.target.value) || 0 })}
                          className="w-16 px-2 py-1 text-xs bg-background border border-border/40 rounded text-right"
                        />
                        <span className="text-xs text-muted-foreground">%</span>
                      </div>
                    </div>
                    <div className="text-xs">
                      <label className="text-[10px] text-muted-foreground">Units</label>
                      <div className="font-medium">{tier.units_count}</div>
                    </div>
                    <div className="flex-1 text-xs text-muted-foreground">
                      <label className="text-[10px]">Max 2BR Rent</label>
                      <div className="font-medium text-foreground">{fc(tier.max_rent_2br)}/mo</div>
                    </div>
                    <button onClick={() => removeTier(tier.id)} className="text-muted-foreground/50 hover:text-red-400">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
              <Button size="sm" variant="outline" onClick={() => addTier(60)}>
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                Add Tier
              </Button>
            </div>
          )}

          {config.tiers.length === 0 && (
            <div className="text-center py-6 text-xs text-muted-foreground">
              <p>No affordability requirements set. Select a preset above or add custom tiers.</p>
              <Button size="sm" variant="outline" className="mt-3" onClick={() => addTier(60)}>
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                Add Affordability Tier
              </Button>
            </div>
          )}

          {/* Tax Exemption */}
          <div className="border-t border-border/40 pt-4">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">Property Tax Exemption</div>
            <div className="flex items-center gap-4 flex-wrap">
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={config.tax_exemption_enabled}
                  onChange={(e) => updateConfig({ tax_exemption_enabled: e.target.checked })}
                  className="rounded border-border"
                />
                Tax exemption for affordable units
              </label>
              {config.tax_exemption_enabled && (
                <>
                  <div>
                    <label className="text-[10px] text-muted-foreground">Type</label>
                    <select
                      value={config.tax_exemption_type}
                      onChange={(e) => updateConfig({ tax_exemption_type: e.target.value })}
                      className="block w-40 px-2 py-1 text-xs bg-background border border-border/40 rounded"
                    >
                      <option value="">Select...</option>
                      <option value="lihtc">LIHTC (100% exempt)</option>
                      <option value="welfare_exemption">Welfare Exemption (CA)</option>
                      <option value="local_abatement">Local Tax Abatement</option>
                      <option value="pilot">PILOT Agreement</option>
                      <option value="421a">421-a (NYC)</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground">Tax Reduction</label>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={config.tax_exemption_pct}
                        onChange={(e) => updateConfig({ tax_exemption_pct: Number(e.target.value) || 0 })}
                        className="w-16 px-2 py-1 text-xs bg-background border border-border/40 rounded text-right"
                      />
                      <span className="text-xs text-muted-foreground">%</span>
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground">Duration</label>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={0}
                        value={config.tax_exemption_years}
                        onChange={(e) => updateConfig({ tax_exemption_years: Number(e.target.value) || 0 })}
                        className="w-16 px-2 py-1 text-xs bg-background border border-border/40 rounded text-right"
                      />
                      <span className="text-xs text-muted-foreground">yrs</span>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Impact summary */}
          {config.enabled && (
            <div className="border-t border-border/40 pt-4">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">Impact Summary</div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="border border-border/40 rounded-lg bg-muted/10 p-2.5">
                  <div className="text-[10px] text-muted-foreground">Affordable Units</div>
                  <div className="text-sm font-semibold">{affordableUnits} of {totalUnits}</div>
                  <div className="text-[10px] text-muted-foreground">{fpct(affordablePct)}</div>
                </div>
                <div className="border border-border/40 rounded-lg bg-muted/10 p-2.5">
                  <div className="text-[10px] text-muted-foreground">Market Rate Units</div>
                  <div className="text-sm font-semibold">{config.market_rate_units}</div>
                </div>
                <div className="border border-border/40 rounded-lg bg-muted/10 p-2.5">
                  <div className="text-[10px] text-muted-foreground">Revenue Impact</div>
                  <div className={`text-sm font-semibold ${revenueImpact > 0 ? "text-red-400" : "text-emerald-400"}`}>
                    -{fc(revenueImpact)}/yr
                  </div>
                  <div className="text-[10px] text-muted-foreground">-{fpct(revenueImpactPct)} GPR</div>
                </div>
                {config.tax_exemption_enabled && taxSavings > 0 && (
                  <div className="border border-border/40 rounded-lg bg-muted/10 p-2.5">
                    <div className="text-[10px] text-muted-foreground">Tax Savings</div>
                    <div className="text-sm font-semibold text-emerald-400">+{fc(taxSavings)}/yr</div>
                    <div className="text-[10px] text-muted-foreground">
                      {affordableUnits}/{totalUnits} units × {config.tax_exemption_pct}%
                    </div>
                  </div>
                )}
              </div>
              {avgMarketRent > 0 && weightedAffordableRent > 0 && (
                <div className="text-[10px] text-muted-foreground mt-2">
                  Avg market rent: {fc(avgMarketRent)}/mo · Avg affordable rent: {fc(weightedAffordableRent)}/mo · Blended: {fc(totalUnits > 0 ? (blendedGPR / totalUnits / 12) : 0)}/mo
                </div>
              )}
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="block text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Notes</label>
            <textarea
              value={config.notes}
              onChange={(e) => updateConfig({ notes: e.target.value })}
              placeholder="Affordability requirements, density bonus program details, regulatory agreement terms…"
              rows={2}
              className="w-full px-3 py-2 text-sm bg-muted/20 border border-border/40 rounded-lg outline-none resize-none focus:border-primary/40"
            />
          </div>
        </div>
      )}
    </div>
  );
}
