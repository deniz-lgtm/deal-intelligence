"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, DollarSign, ChevronDown, ChevronRight } from "lucide-react";
import { buildAmiTables } from "@/lib/ami-calc";

// Shape of the stored AMI object on the location_intelligence record.
interface StoredAmi {
  year?: number;
  area_name?: string;
  median_family_income?: number;
  income_limits?: Record<string, number[] | undefined>;
  max_rents?: Record<string, Record<string, number> | undefined>;
}

interface Props {
  dealId: string;
  /** Render style: inline expand/collapse card (default) */
  variant?: "inline" | "button";
  /** Show "Fetch" button to refresh AMI from HUD if data is missing */
  allowFetch?: boolean;
}

const fc = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const fn = (n: number) => Math.round(n).toLocaleString("en-US");

/**
 * Compact AMI (Area Median Income) reference card.
 * Pulls AMI data already stored in the deal's location-intelligence record
 * and shows the standard HUD rent/income-limit tables.
 * If no AMI data exists, lets the user fetch it from HUD on-demand.
 */
export default function AmiReference({ dealId, variant = "inline", allowFetch = true }: Props) {
  const [open, setOpen] = useState(false);
  const [ami, setAmi] = useState<StoredAmi | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Pull any AMI data already stored on the deal's location intel record.
  const loadStoredAmi = useCallback(async () => {
    try {
      const res = await fetch(`/api/deals/${dealId}/location-intelligence`);
      if (!res.ok) return;
      const json = await res.json();
      // Endpoint returns an array of rows (one per radius); find the first with AMI
      const rows: Array<{ data: string | Record<string, unknown> }> = Array.isArray(json.data)
        ? json.data
        : json.data
        ? [json.data]
        : [];
      for (const row of rows) {
        const parsed = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
        if (parsed?.ami) {
          setAmi(parsed.ami);
          return;
        }
      }
    } catch { /* non-fatal */ }
  }, [dealId]);

  useEffect(() => {
    if (open && !ami) loadStoredAmi();
  }, [open, ami, loadStoredAmi]);

  const fetchAmiNow = async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/location-intelligence/fetch-ami`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ radius_miles: 3 }),
      });
      const json = await res.json();
      if (!res.ok) {
        setFetchError(json.error || "Failed to fetch AMI");
      } else if (json.data) {
        setAmi(json.data);
      }
    } catch {
      setFetchError("Failed to fetch AMI");
    } finally {
      setLoading(false);
    }
  };

  // Back-fill missing limits/rents from MFI (same logic as the location intel page).
  const mfi = Number(ami?.median_family_income) || 0;
  const storedLimits = (ami?.income_limits || {}) as Record<string, number[] | undefined>;
  const storedRents = (ami?.max_rents || {}) as Record<string, Record<string, number> | undefined>;
  const allZero = (arr?: number[]) => !arr || arr.length === 0 || arr.every((v) => !v);
  const needsBackfill = mfi > 0 && (
    allZero(storedLimits.very_low_50) ||
    allZero(storedLimits.extremely_low_30) ||
    allZero(storedLimits.low_80) ||
    !storedRents.ami_50
  );
  const derived = needsBackfill
    ? buildAmiTables(mfi, {
        very_low_50: storedLimits.very_low_50,
        extremely_low_30: storedLimits.extremely_low_30,
        low_80: storedLimits.low_80,
      })
    : null;
  const limits: Record<string, number[] | undefined> = derived
    ? (derived.income_limits as unknown as Record<string, number[] | undefined>)
    : storedLimits;
  const rents: Record<string, Record<string, number> | undefined> = derived
    ? (derived.max_rents as unknown as Record<string, Record<string, number> | undefined>)
    : storedRents;

  const triggerBtn = (
    <Button
      variant="outline"
      size="sm"
      onClick={() => setOpen(!open)}
      className="gap-1.5"
    >
      {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
      <DollarSign className="h-3.5 w-3.5" />
      AMI Table
    </Button>
  );

  if (variant === "button" && !open) return triggerBtn;

  return (
    <div className="border border-border/60 rounded-lg bg-card">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/40">
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-2 text-sm font-semibold hover:text-primary"
        >
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <DollarSign className="h-4 w-4 text-primary" />
          AMI Table
          {ami?.area_name && (
            <span className="text-xs font-normal text-muted-foreground">
              — FY{ami.year} {ami.area_name}
            </span>
          )}
        </button>
        {allowFetch && open && (
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchAmiNow}
            disabled={loading}
            className="text-xs h-7"
          >
            {loading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
            {ami ? "Refresh" : "Fetch from HUD"}
          </Button>
        )}
      </div>

      {open && (
        <div className="p-3 space-y-3">
          {!ami && !loading && (
            <div className="text-xs text-muted-foreground py-2">
              No AMI data yet.{" "}
              {allowFetch ? (
                <button onClick={fetchAmiNow} className="text-primary hover:underline">
                  Fetch from HUD
                </button>
              ) : (
                <>Run the AMI fetch on the Location Intel page first.</>
              )}
            </div>
          )}
          {loading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
              <Loader2 className="h-3 w-3 animate-spin" /> Loading AMI data…
            </div>
          )}
          {fetchError && (
            <div className="text-xs text-red-400">{fetchError}</div>
          )}

          {ami && (
            <>
              <div className="flex items-baseline gap-4 text-sm">
                <span className="text-muted-foreground">Median Family Income:</span>
                <span className="font-semibold tabular-nums">{fc(mfi)}</span>
              </div>

              {/* Max Rents */}
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">
                  Max Affordable Rents (30% of income)
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-muted-foreground border-b border-border/40">
                        <th className="pb-1.5 pr-3">AMI</th>
                        <th className="pb-1.5 pr-3 text-right">Studio</th>
                        <th className="pb-1.5 pr-3 text-right">1 BR</th>
                        <th className="pb-1.5 pr-3 text-right">2 BR</th>
                        <th className="pb-1.5 text-right">3 BR</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { label: "30%", key: "ami_30", color: "text-red-400" },
                        { label: "50%", key: "ami_50", color: "text-amber-400" },
                        { label: "60% (LIHTC)", key: "ami_60", color: "text-amber-300" },
                        { label: "80%", key: "ami_80", color: "text-emerald-400" },
                        { label: "100%", key: "ami_100", color: "text-foreground/80" },
                        { label: "120%", key: "ami_120", color: "text-primary" },
                      ].map((row) => {
                        const r = rents[row.key];
                        if (!r) return null;
                        return (
                          <tr key={row.key} className="border-b border-border/20 last:border-0">
                            <td className={`py-1 pr-3 font-medium ${row.color}`}>{row.label}</td>
                            <td className="py-1 pr-3 text-right tabular-nums">${fn(r.studio)}</td>
                            <td className="py-1 pr-3 text-right tabular-nums">${fn(r.one_br)}</td>
                            <td className="py-1 pr-3 text-right tabular-nums">${fn(r.two_br)}</td>
                            <td className="py-1 text-right tabular-nums">${fn(r.three_br)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Income Limits */}
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">
                  Income Limits by Household Size
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-muted-foreground border-b border-border/40">
                        <th className="pb-1.5 pr-3">AMI</th>
                        {[1, 2, 3, 4, 5, 6].map((p) => (
                          <th key={p} className="pb-1.5 pr-2 text-right">{p}p</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { label: "30%", key: "extremely_low_30" },
                        { label: "50%", key: "very_low_50" },
                        { label: "60%", key: "sixty_pct" },
                        { label: "80%", key: "low_80" },
                      ].map((row) => {
                        const l = limits[row.key];
                        if (!l) return null;
                        return (
                          <tr key={row.key} className="border-b border-border/20 last:border-0">
                            <td className="py-1 pr-3 font-medium text-muted-foreground">{row.label}</td>
                            {l.slice(0, 6).map((v, i) => (
                              <td key={i} className="py-1 pr-2 text-right tabular-nums">${fn(v)}</td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="text-[10px] text-muted-foreground/60">
                Source: HUD FY{ami.year} Income Limits for {ami.area_name}. Max rents = 30% of income / 12. Utility allowances not deducted.
                {derived && " Limits derived from MFI via HUD's standard family-size adjustment factors."}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
