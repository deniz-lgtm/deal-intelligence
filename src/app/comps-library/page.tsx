"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  BarChart3,
  Search,
  Loader2,
  Camera,
  Trash2,
  ExternalLink,
  Sparkles,
  X,
  FileSearch,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppShell } from "@/components/AppShell";
import { toast } from "sonner";

interface LibraryComp {
  id: string;
  deal_id: string | null;
  source_deal_id: string | null;
  comp_type: "sale" | "rent";
  name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  property_type: string | null;
  year_built: number | null;
  units: number | null;
  total_sf: number | null;
  sale_price: number | null;
  sale_date: string | null;
  cap_rate: number | null;
  price_per_unit: number | null;
  price_per_sf: number | null;
  rent_per_unit: number | null;
  rent_per_sf: number | null;
  occupancy_pct: number | null;
  source: string;
  source_note: string | null;
  created_at: string;
  attached_deal_name: string | null;
  source_deal_name: string | null;
  source_deal_status: string | null;
}

interface DealPicker {
  id: string;
  name: string;
  status: string;
}

const fc = (n: number | null) =>
  n == null ? "—" : "$" + Math.round(Number(n)).toLocaleString("en-US");
const fn = (n: number | null) =>
  n == null ? "—" : Number(n).toLocaleString("en-US");
const fpct = (n: number | null, digits = 1) =>
  n == null ? "—" : Number(n).toFixed(digits) + "%";

const SOURCE_LABELS: Record<string, string> = {
  manual: "Manual",
  paste: "Pasted",
  doc: "Market doc",
  deal_snapshot: "Deal snapshot",
  api: "API",
};

const SOURCE_COLORS: Record<string, string> = {
  manual: "bg-zinc-500/20 text-zinc-300",
  paste: "bg-blue-500/20 text-blue-300",
  doc: "bg-purple-500/20 text-purple-300",
  deal_snapshot: "bg-emerald-500/20 text-emerald-300",
  api: "bg-amber-500/20 text-amber-300",
};

export default function CompsLibraryPage() {
  const [comps, setComps] = useState<LibraryComp[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<"" | "sale" | "rent">("");
  const [propertyTypeFilter, setPropertyTypeFilter] = useState("");
  const [search, setSearch] = useState("");
  const [snapshotOpen, setSnapshotOpen] = useState(false);

  const loadComps = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (typeFilter) qs.set("type", typeFilter);
      if (propertyTypeFilter) qs.set("property_type", propertyTypeFilter);
      if (search.trim()) qs.set("q", search.trim());
      const res = await fetch(`/api/workspace/comps?${qs.toString()}`);
      const json = await res.json();
      setComps(json.data || []);
    } catch {
      toast.error("Failed to load comps");
    } finally {
      setLoading(false);
    }
  }, [typeFilter, propertyTypeFilter, search]);

  // Debounce search; immediate for dropdown filters
  useEffect(() => {
    const t = setTimeout(loadComps, 250);
    return () => clearTimeout(t);
  }, [loadComps]);

  async function handleDelete(id: string) {
    if (!confirm("Delete this comp from the library?")) return;
    // Reuse the existing per-deal delete endpoint if attached; else the
    // workspace endpoint won't be needed — the row is deleted either way
    // via the comps table. We call the unified per-comp endpoint with a
    // deal_id of "_workspace" fallback. For simplicity, just issue the
    // delete via the per-deal-route pattern with the stored deal_id.
    const comp = comps.find((c) => c.id === id);
    if (!comp) return;
    // If deal_id is null we need a workspace-safe delete. Use the deal
    // route only when a deal is attached. For pure workspace comps,
    // fallback to nothing (future: add DELETE /api/workspace/comps/[id]).
    if (!comp.deal_id) {
      toast.error(
        "Workspace-only comps can't be deleted yet — coming in the next pass"
      );
      return;
    }
    try {
      await fetch(`/api/deals/${comp.deal_id}/comps/${id}`, {
        method: "DELETE",
      });
      toast.success("Deleted");
      loadComps();
    } catch {
      toast.error("Delete failed");
    }
  }

  const propertyTypes = Array.from(
    new Set(comps.map((c) => c.property_type).filter(Boolean))
  ) as string[];

  return (
    <AppShell>
      <div className="flex-1 flex flex-col min-h-0">
        {/* Header */}
        <header className="relative overflow-hidden border-b border-border/40 shrink-0">
          <div className="absolute inset-0 gradient-mesh" />
          <div className="relative max-w-full mx-auto px-6 sm:px-8">
            <div className="flex items-center justify-between h-14">
              <div className="flex items-center gap-3">
                <span className="font-display text-base text-foreground tracking-tight">
                  Comps Library
                </span>
                <span className="text-[10px] text-muted-foreground hidden sm:inline">
                  Workspace-level
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setSnapshotOpen(true)}
                >
                  <Camera className="h-3.5 w-3.5 mr-1.5" />
                  Snapshot a Deal
                </Button>
              </div>
            </div>
          </div>
        </header>

        {/* Filter bar */}
        <div className="shrink-0 border-b border-border/30 bg-card/30 backdrop-blur-sm">
          <div className="max-w-full mx-auto px-6 sm:px-8 py-3 flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, address, city, source note…"
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-muted/20 border border-border/40 rounded-md outline-none focus:border-primary/40"
              />
            </div>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as "" | "sale" | "rent")}
              className="px-3 py-1.5 text-xs bg-muted/20 border border-border/40 rounded-md outline-none focus:border-primary/40"
            >
              <option value="">All types</option>
              <option value="sale">Sale</option>
              <option value="rent">Rent</option>
            </select>
            <select
              value={propertyTypeFilter}
              onChange={(e) => setPropertyTypeFilter(e.target.value)}
              className="px-3 py-1.5 text-xs bg-muted/20 border border-border/40 rounded-md outline-none focus:border-primary/40"
            >
              <option value="">All property types</option>
              {propertyTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <div className="flex-1" />
            <div className="text-[10px] text-muted-foreground">
              {comps.length} comp{comps.length === 1 ? "" : "s"}
            </div>
          </div>
        </div>

        {/* Table */}
        <main className="flex-1 min-w-0 max-w-full mx-auto w-full px-6 sm:px-8 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : comps.length === 0 ? (
            <EmptyState onSnapshot={() => setSnapshotOpen(true)} />
          ) : (
            <div className="border border-border/40 rounded-xl bg-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-muted-foreground border-b border-border/40 bg-muted/10">
                      <th className="py-2.5 px-3">Type</th>
                      <th className="py-2.5 px-3">Name / Address</th>
                      <th className="py-2.5 px-3">From Deal</th>
                      <th className="py-2.5 px-3">Source</th>
                      <th className="py-2.5 px-3 text-right">Yr</th>
                      <th className="py-2.5 px-3 text-right">Size</th>
                      <th className="py-2.5 px-3 text-right">Headline</th>
                      <th className="py-2.5 px-3 text-right">Date</th>
                      <th className="py-2.5 px-3 w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {comps.map((c) => (
                      <tr
                        key={c.id}
                        className="border-b border-border/20 hover:bg-muted/10"
                      >
                        <td className="py-2 px-3 uppercase text-[10px] font-medium">
                          {c.comp_type}
                        </td>
                        <td className="py-2 px-3">
                          <div className="font-medium text-foreground">
                            {c.name || "—"}
                          </div>
                          <div className="text-[10px] text-muted-foreground">
                            {[c.address, c.city, c.state]
                              .filter(Boolean)
                              .join(", ") || "—"}
                          </div>
                        </td>
                        <td className="py-2 px-3">
                          {c.attached_deal_name || c.source_deal_name ? (
                            <Link
                              href={`/deals/${c.deal_id || c.source_deal_id}`}
                              className="text-primary hover:underline inline-flex items-center gap-1"
                            >
                              {c.attached_deal_name || c.source_deal_name}
                              <ExternalLink className="h-2.5 w-2.5" />
                            </Link>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                          {!c.deal_id && c.source_deal_id && (
                            <div className="text-[9px] text-muted-foreground/80">
                              Workspace
                            </div>
                          )}
                        </td>
                        <td className="py-2 px-3">
                          <span
                            className={`text-[9px] px-1.5 py-0.5 rounded-full ${
                              SOURCE_COLORS[c.source] ?? "bg-muted text-muted-foreground"
                            }`}
                          >
                            {SOURCE_LABELS[c.source] ?? c.source}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-right">
                          {c.year_built ?? "—"}
                        </td>
                        <td className="py-2 px-3 text-right">
                          {c.units
                            ? `${fn(c.units)}u`
                            : c.total_sf
                            ? `${fn(c.total_sf)} SF`
                            : "—"}
                        </td>
                        <td className="py-2 px-3 text-right">
                          {c.comp_type === "sale" ? (
                            <>
                              <div>{fc(c.sale_price)}</div>
                              <div className="text-[10px] text-muted-foreground">
                                {c.cap_rate != null ? `${fpct(c.cap_rate)} cap` : ""}
                                {c.cap_rate != null && c.price_per_unit != null ? " · " : ""}
                                {c.price_per_unit != null
                                  ? `${fc(c.price_per_unit)}/unit`
                                  : c.price_per_sf != null
                                  ? `$${Number(c.price_per_sf).toFixed(0)}/SF`
                                  : ""}
                              </div>
                            </>
                          ) : (
                            <>
                              <div>
                                {c.rent_per_unit != null
                                  ? `${fc(c.rent_per_unit)}/unit/mo`
                                  : c.rent_per_sf != null
                                  ? `$${Number(c.rent_per_sf).toFixed(2)}/SF`
                                  : "—"}
                              </div>
                              <div className="text-[10px] text-muted-foreground">
                                {c.occupancy_pct != null
                                  ? `${fpct(c.occupancy_pct, 0)} occ`
                                  : ""}
                              </div>
                            </>
                          )}
                        </td>
                        <td className="py-2 px-3 text-right text-muted-foreground">
                          {c.sale_date
                            ? new Date(c.sale_date).toLocaleDateString()
                            : new Date(c.created_at).toLocaleDateString()}
                        </td>
                        <td className="py-2 px-3 text-right">
                          <button
                            onClick={() => handleDelete(c.id)}
                            className="text-muted-foreground hover:text-red-400 transition-colors"
                            title="Delete"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </main>

        {/* Snapshot modal */}
        {snapshotOpen && (
          <SnapshotDealModal
            onClose={() => setSnapshotOpen(false)}
            onSaved={() => {
              setSnapshotOpen(false);
              loadComps();
            }}
          />
        )}
      </div>
    </AppShell>
  );
}

function EmptyState({ onSnapshot }: { onSnapshot: () => void }) {
  return (
    <div className="text-center py-20 max-w-lg mx-auto space-y-4">
      <div className="mx-auto w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
        <BarChart3 className="h-6 w-6 text-primary" />
      </div>
      <h2 className="text-lg font-display font-semibold">
        No comps in your library yet
      </h2>
      <p className="text-sm text-muted-foreground leading-relaxed">
        Comps from every deal live here — paste-mode entries, extractions from
        market documents, and snapshots of deal actuals. Tag them with their
        source deal so you can pull them into any future deal as a reference.
      </p>
      <div className="flex items-center justify-center gap-2">
        <Button variant="outline" size="sm" onClick={onSnapshot}>
          <Camera className="h-3.5 w-3.5 mr-1.5" />
          Snapshot a Deal
        </Button>
        <Link href="/">
          <Button variant="ghost" size="sm">
            <FileSearch className="h-3.5 w-3.5 mr-1.5" />
            Open a deal's Comps tab
          </Button>
        </Link>
      </div>
    </div>
  );
}

// ── Snapshot-a-deal modal ─────────────────────────────────────────────────

function SnapshotDealModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [deals, setDeals] = useState<DealPicker[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null);
  const [compType, setCompType] = useState<"sale" | "rent">("sale");
  const [attach, setAttach] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/deals")
      .then((r) => r.json())
      .then((j) => {
        const all = (j.data || []) as Array<{
          id: string;
          name: string;
          status: string;
        }>;
        setDeals(all.filter((d) => d.status !== "archived"));
      })
      .catch(() => toast.error("Failed to load deals"))
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    if (!selectedDealId) return;
    setSaving(true);
    try {
      const res = await fetch("/api/workspace/comps/from-deal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deal_id: selectedDealId,
          comp_type: compType,
          attach_to_deal: attach,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || "Snapshot failed");
        return;
      }
      toast.success("Deal snapshotted as comp");
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border/60 rounded-xl shadow-2xl w-full max-w-lg my-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-border/40">
          <h2 className="font-semibold text-sm">Snapshot Deal as Comp</h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-xs text-muted-foreground">
            Takes the current state of a deal — address, size, underwriting
            numbers, OM data — and saves it as a comp in your workspace
            library. Useful for closed-deal actuals or for capturing OMs you
            reviewed but aren't pursuing.
          </p>

          <div>
            <label className="block text-[10px] text-muted-foreground uppercase tracking-wide mb-1">
              Deal
            </label>
            {loading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : deals.length === 0 ? (
              <div className="text-xs text-muted-foreground py-4 text-center">
                No deals found.
              </div>
            ) : (
              <div className="max-h-56 overflow-y-auto border border-border/30 rounded-lg p-1">
                {deals.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => setSelectedDealId(d.id)}
                    className={`w-full text-left px-3 py-2 rounded-md text-xs transition-colors ${
                      selectedDealId === d.id
                        ? "bg-primary/20 text-foreground"
                        : "hover:bg-muted/30 text-muted-foreground"
                    }`}
                  >
                    <div className="font-medium">{d.name}</div>
                    <div className="text-[10px] text-muted-foreground/80">
                      {d.status}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="block text-[10px] text-muted-foreground uppercase tracking-wide mb-1">
              Comp Type
            </label>
            <div className="flex gap-2">
              <button
                onClick={() => setCompType("sale")}
                className={`flex-1 px-3 py-2 text-xs rounded-md transition-colors ${
                  compType === "sale"
                    ? "bg-primary/20 text-foreground border border-primary/40"
                    : "bg-muted/20 text-muted-foreground border border-border/40 hover:bg-muted/30"
                }`}
              >
                Sale
              </button>
              <button
                onClick={() => setCompType("rent")}
                className={`flex-1 px-3 py-2 text-xs rounded-md transition-colors ${
                  compType === "rent"
                    ? "bg-primary/20 text-foreground border border-primary/40"
                    : "bg-muted/20 text-muted-foreground border border-border/40 hover:bg-muted/30"
                }`}
              >
                Rent
              </button>
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={attach}
              onChange={(e) => setAttach(e.target.checked)}
              className="rounded border-border/40"
            />
            Also attach to the source deal (shows up in that deal's Comps tab)
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={!selectedDealId || saving}
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
              ) : (
                <Sparkles className="h-3.5 w-3.5 mr-1.5" />
              )}
              Snapshot
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
