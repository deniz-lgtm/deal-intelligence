"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
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
  Pencil,
  Copy,
  Save,
  Map as MapIcon,
  List,
  Download,
  Printer,
  MapPin,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppShell } from "@/components/AppShell";
import { toast } from "sonner";

// Leaflet expects window so it has to be client-only. Dynamic import with
// ssr:false also keeps the map code out of the initial bundle — it's only
// loaded when the user switches to the map view.
const CompsMapView = dynamic(() => import("@/components/CompsMapView"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center py-20 border border-border/40 rounded-xl bg-card">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  ),
});

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
  lat: number | null;
  lng: number | null;
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
  const [stateFilter, setStateFilter] = useState("");
  const [search, setSearch] = useState("");
  const [snapshotOpen, setSnapshotOpen] = useState(false);
  const [editing, setEditing] = useState<LibraryComp | null>(null);
  const [copyingToDeal, setCopyingToDeal] = useState<LibraryComp | null>(null);
  const [view, setView] = useState<"table" | "map">("table");
  const [geocoding, setGeocoding] = useState(false);

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
    try {
      const res = await fetch(`/api/workspace/comps/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        toast.error(json.error || "Delete failed");
        return;
      }
      toast.success("Deleted");
      loadComps();
    } catch {
      toast.error("Delete failed");
    }
  }

  async function handleGeocodeMissing() {
    setGeocoding(true);
    try {
      // Loop until no more remaining (cap at 5 batches = up to 250 rows to
      // keep total wait reasonable)
      let totalGeocoded = 0;
      let totalFailed = 0;
      let batches = 0;
      for (batches = 0; batches < 5; batches++) {
        const res = await fetch("/api/workspace/comps/geocode-missing", {
          method: "POST",
        });
        const json = await res.json();
        if (!res.ok) {
          toast.error(json.error || "Geocoding failed");
          break;
        }
        totalGeocoded += json.data.geocoded;
        totalFailed += json.data.failed;
        if (!json.data.more || json.data.processed === 0) break;
      }
      if (totalGeocoded > 0) {
        toast.success(
          `Geocoded ${totalGeocoded} comp${totalGeocoded === 1 ? "" : "s"}` +
            (totalFailed > 0 ? ` (${totalFailed} failed)` : "")
        );
        loadComps();
      } else if (totalFailed > 0) {
        toast.error(`${totalFailed} comps couldn't be geocoded`);
      } else {
        toast("Nothing to geocode");
      }
    } finally {
      setGeocoding(false);
    }
  }

  function handleExportPdf() {
    if (filteredComps.length === 0) {
      toast.error("No comps to export");
      return;
    }
    const today = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const typeLabel =
      typeFilter === "sale"
        ? "Sale Comps"
        : typeFilter === "rent"
        ? "Rent Comps"
        : "All Comps";
    const filterLine = [
      propertyTypeFilter,
      stateFilter,
      search.trim() ? `"${search.trim()}"` : null,
    ]
      .filter(Boolean)
      .join(" · ");

    const escapeHtml = (s: unknown): string => {
      if (s == null) return "";
      return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    };

    const rows = filteredComps
      .map((c) => {
        const loc = [c.city, c.state].filter(Boolean).join(", ");
        const headline =
          c.comp_type === "sale"
            ? [
                c.sale_price != null ? fc(c.sale_price) : "",
                c.cap_rate != null ? `${c.cap_rate}% cap` : "",
                c.price_per_unit != null
                  ? `${fc(c.price_per_unit)}/unit`
                  : "",
              ]
                .filter(Boolean)
                .join(" · ")
            : [
                c.rent_per_unit != null
                  ? `${fc(c.rent_per_unit)}/unit/mo`
                  : "",
                c.rent_per_sf != null
                  ? `$${Number(c.rent_per_sf).toFixed(2)}/SF`
                  : "",
                c.occupancy_pct != null ? `${c.occupancy_pct}% occ` : "",
              ]
                .filter(Boolean)
                .join(" · ");
        return `
          <tr>
            <td class="type ${c.comp_type}">${c.comp_type.toUpperCase()}</td>
            <td>
              <div class="name">${escapeHtml(c.name) || "—"}</div>
              <div class="addr">${escapeHtml(c.address) || ""}${c.address && loc ? ", " : ""}${escapeHtml(loc)}</div>
            </td>
            <td class="num">${c.year_built ?? "—"}</td>
            <td class="num">${c.units ? fn(c.units) + "u" : c.total_sf ? fn(c.total_sf) + " SF" : "—"}</td>
            <td class="num">${escapeHtml(headline) || "—"}</td>
            <td class="date">${
              c.sale_date
                ? new Date(c.sale_date).toLocaleDateString()
                : new Date(c.created_at).toLocaleDateString()
            }</td>
            <td class="source">${escapeHtml(c.source_deal_name || c.attached_deal_name || "")}</td>
          </tr>
        `;
      })
      .join("");

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Comps Library — ${today}</title>
  <style>
    @page { size: letter landscape; margin: 0.5in; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #111;
      font-size: 10pt;
      margin: 0;
      padding: 0;
    }
    h1 {
      font-size: 16pt;
      margin: 0 0 4px 0;
      color: #000;
    }
    .meta {
      color: #666;
      font-size: 9pt;
      margin-bottom: 14px;
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 9pt;
    }
    th {
      text-align: left;
      padding: 6px 8px;
      background: #f5f5f5;
      border-bottom: 1.5px solid #333;
      font-weight: 600;
      text-transform: uppercase;
      font-size: 7.5pt;
      color: #555;
    }
    td {
      padding: 6px 8px;
      border-bottom: 1px solid #e5e5e5;
      vertical-align: top;
    }
    td.num, td.date {
      text-align: right;
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }
    td.type {
      font-weight: 600;
      font-size: 7.5pt;
      letter-spacing: 0.5px;
    }
    td.type.sale { color: #b45309; }
    td.type.rent { color: #1d4ed8; }
    td .name { font-weight: 600; }
    td .addr { color: #666; font-size: 8pt; }
    td.source { color: #666; font-size: 8pt; }
    tr { break-inside: avoid; }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <h1>${typeLabel}</h1>
  <div class="meta">
    <span>${today}</span>
    <span>${filteredComps.length} comp${filteredComps.length === 1 ? "" : "s"}</span>
    ${filterLine ? `<span>Filters: ${escapeHtml(filterLine)}</span>` : ""}
  </div>
  <table>
    <thead>
      <tr>
        <th>Type</th>
        <th>Name / Address</th>
        <th style="text-align:right">Yr</th>
        <th style="text-align:right">Size</th>
        <th style="text-align:right">Headline</th>
        <th style="text-align:right">Date</th>
        <th>Source Deal</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <script>
    window.addEventListener('load', function() {
      setTimeout(function() { window.print(); }, 200);
    });
  </script>
</body>
</html>`;

    const win = window.open("", "_blank", "width=1100,height=800");
    if (!win) {
      toast.error("Popup blocked — allow popups to export PDFs");
      return;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
    toast.success(`Preparing ${filteredComps.length} comps for print…`);
  }

  function handleExportCsv() {
    if (filteredComps.length === 0) {
      toast.error("No comps to export");
      return;
    }
    const header = [
      "type",
      "name",
      "address",
      "city",
      "state",
      "property_type",
      "year_built",
      "units",
      "total_sf",
      "sale_price",
      "sale_date",
      "cap_rate",
      "price_per_unit",
      "price_per_sf",
      "rent_per_unit",
      "rent_per_sf",
      "occupancy_pct",
      "source",
      "source_deal_name",
      "attached_deal_name",
      "notes",
      "created_at",
    ];
    const escape = (v: unknown): string => {
      if (v == null) return "";
      const s = String(v);
      if (s.includes(",") || s.includes('"') || s.includes("\n")) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };
    const rows = filteredComps.map((c) =>
      [
        c.comp_type,
        c.name,
        c.address,
        c.city,
        c.state,
        c.property_type,
        c.year_built,
        c.units,
        c.total_sf,
        c.sale_price,
        c.sale_date,
        c.cap_rate,
        c.price_per_unit,
        c.price_per_sf,
        c.rent_per_unit,
        c.rent_per_sf,
        c.occupancy_pct,
        c.source,
        c.source_deal_name,
        c.attached_deal_name,
        c.source_note,
        c.created_at,
      ]
        .map(escape)
        .join(",")
    );
    const csv = [header.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const today = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `comps-library-${today}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(`Exported ${filteredComps.length} comps`);
  }

  // Client-side state filter (the text filters are server-side via loadComps)
  const filteredComps = stateFilter
    ? comps.filter((c) => c.state === stateFilter)
    : comps;

  const propertyTypes = Array.from(
    new Set(comps.map((c) => c.property_type).filter(Boolean))
  ) as string[];
  const states = Array.from(
    new Set(comps.map((c) => c.state).filter(Boolean))
  ).sort() as string[];

  return (
    <AppShell>
      <div className="flex-1 flex flex-col min-h-0">
        {/* Header */}
        <header className="relative overflow-hidden border-b border-border/40 shrink-0">
          <div className="absolute inset-0 gradient-mesh" />
          <div className="relative max-w-full mx-auto px-6 sm:px-8">
            <div className="flex items-center justify-between h-14">
              <div className="flex items-center gap-2.5">
                <BarChart3 className="h-4 w-4 text-primary" />
                <span className="font-nameplate text-xl leading-none tracking-tight">
                  Comps Library
                </span>
                <span className="text-2xs uppercase tracking-[0.15em] text-muted-foreground/70 hidden sm:inline">
                  Workspace
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center bg-muted/20 border border-border/40 rounded-md p-0.5">
                  <button
                    onClick={() => setView("table")}
                    className={`flex items-center gap-1 px-2.5 py-1 text-xs rounded transition-colors ${
                      view === "table"
                        ? "bg-primary/20 text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                    title="Table view"
                  >
                    <List className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Table</span>
                  </button>
                  <button
                    onClick={() => setView("map")}
                    className={`flex items-center gap-1 px-2.5 py-1 text-xs rounded transition-colors ${
                      view === "map"
                        ? "bg-primary/20 text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                    title="Map view"
                  >
                    <MapIcon className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Map</span>
                  </button>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleExportCsv}
                  disabled={filteredComps.length === 0}
                >
                  <Download className="h-3.5 w-3.5 mr-1.5" />
                  CSV
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleExportPdf}
                  disabled={filteredComps.length === 0}
                >
                  <Printer className="h-3.5 w-3.5 mr-1.5" />
                  PDF
                </Button>
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
              className="px-3 py-1.5 text-xs bg-background border border-border rounded-md text-foreground outline-none focus:border-primary/40"
            >
              <option value="">All types</option>
              <option value="sale">Sale</option>
              <option value="rent">Rent</option>
            </select>
            <select
              value={propertyTypeFilter}
              onChange={(e) => setPropertyTypeFilter(e.target.value)}
              className="px-3 py-1.5 text-xs bg-background border border-border rounded-md text-foreground outline-none focus:border-primary/40"
            >
              <option value="">All property types</option>
              {propertyTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <select
              value={stateFilter}
              onChange={(e) => setStateFilter(e.target.value)}
              className="px-3 py-1.5 text-xs bg-background border border-border rounded-md text-foreground outline-none focus:border-primary/40"
            >
              <option value="">All states</option>
              {states.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <div className="flex-1" />
            <div className="text-[10px] text-muted-foreground">
              {filteredComps.length} comp{filteredComps.length === 1 ? "" : "s"}
              {stateFilter && comps.length !== filteredComps.length
                ? ` (${comps.length} total)`
                : ""}
            </div>
          </div>
        </div>

        {/* Table / Map */}
        <main className="flex-1 min-w-0 max-w-full mx-auto w-full px-6 sm:px-8 py-4 space-y-3">
          {/* Geocode banner — shown on map view when any comp is missing coords */}
          {view === "map" && !loading && (() => {
            const missingCoords = filteredComps.filter(
              (c) => c.lat == null || c.lng == null
            ).length;
            if (missingCoords === 0) return null;
            return (
              <div className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-amber-500/5 border border-amber-500/20 text-xs">
                <div className="flex items-center gap-2 text-amber-200/80">
                  <MapPin className="h-3.5 w-3.5 flex-shrink-0" />
                  <span>
                    {missingCoords} comp{missingCoords === 1 ? "" : "s"} not yet
                    geocoded. Map only shows comps with lat/lng.
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleGeocodeMissing}
                  disabled={geocoding}
                >
                  {geocoding ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  ) : (
                    <MapPin className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  Geocode Missing
                </Button>
              </div>
            );
          })()}

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredComps.length === 0 ? (
            <EmptyState onSnapshot={() => setSnapshotOpen(true)} />
          ) : view === "map" ? (
            (() => {
              const mapComps = filteredComps
                .filter((c) => c.lat != null && c.lng != null)
                .map((c) => ({
                  id: c.id,
                  deal_id: c.deal_id,
                  source_deal_id: c.source_deal_id,
                  comp_type: c.comp_type,
                  name: c.name,
                  address: c.address,
                  city: c.city,
                  state: c.state,
                  sale_price: c.sale_price,
                  cap_rate: c.cap_rate,
                  rent_per_unit: c.rent_per_unit,
                  rent_per_sf: c.rent_per_sf,
                  lat: c.lat as number,
                  lng: c.lng as number,
                }));
              if (mapComps.length === 0) {
                return (
                  <div className="text-center py-16 text-xs text-muted-foreground">
                    No comps with coordinates yet. Click <em>Geocode Missing</em>{" "}
                    above to resolve addresses via the Census.gov geocoder.
                  </div>
                );
              }
              return <CompsMapView comps={mapComps} height={540} />;
            })()
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
                    {filteredComps.map((c) => (
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
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => setEditing(c)}
                              className="text-muted-foreground hover:text-primary transition-colors"
                              title="Edit"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => setCopyingToDeal(c)}
                              className="text-muted-foreground hover:text-primary transition-colors"
                              title="Copy to a deal"
                            >
                              <Copy className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => handleDelete(c.id)}
                              className="text-muted-foreground hover:text-red-400 transition-colors"
                              title="Delete"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
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

        {/* Edit modal */}
        {editing && (
          <EditCompModal
            comp={editing}
            onClose={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              loadComps();
            }}
          />
        )}

        {/* Copy-to-deal modal */}
        {copyingToDeal && (
          <CopyToDealModal
            comp={copyingToDeal}
            onClose={() => setCopyingToDeal(null)}
            onSaved={() => {
              setCopyingToDeal(null);
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

// ── Edit Comp modal ───────────────────────────────────────────────────────
//
// Inline editor for any field on a comp row. Works for both deal-attached
// and workspace-only comps via the unified PATCH /api/workspace/comps/[id]
// endpoint. The form adapts to the comp's type — sale comps show sale/cap
// fields, rent comps show rent/occupancy fields.

function EditCompModal({
  comp,
  onClose,
  onSaved,
}: {
  comp: LibraryComp;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<Record<string, unknown>>({
    name: comp.name,
    address: comp.address,
    city: comp.city,
    state: comp.state,
    property_type: comp.property_type,
    year_built: comp.year_built,
    units: comp.units,
    total_sf: comp.total_sf,
    sale_price: comp.sale_price,
    sale_date: comp.sale_date,
    cap_rate: comp.cap_rate,
    price_per_unit: comp.price_per_unit,
    price_per_sf: comp.price_per_sf,
    rent_per_unit: comp.rent_per_unit,
    rent_per_sf: comp.rent_per_sf,
    occupancy_pct: comp.occupancy_pct,
    source_note: comp.source_note,
  });
  const [saving, setSaving] = useState(false);

  const set = (key: string, value: unknown) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const numOrNull = (v: string) => (v === "" ? null : Number(v));

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/workspace/comps/${comp.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        toast.error(json.error || "Save failed");
        return;
      }
      toast.success("Comp updated");
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
        className="bg-card border border-border/60 rounded-xl shadow-2xl w-full max-w-3xl my-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-border/40">
          <h2 className="font-semibold text-sm">
            Edit {comp.comp_type === "sale" ? "Sale" : "Rent"} Comp
          </h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <EditField label="Name" value={draft.name as string} onChange={(v) => set("name", v)} />
            <EditField label="Address" value={draft.address as string} onChange={(v) => set("address", v)} />
            <EditField label="City" value={draft.city as string} onChange={(v) => set("city", v)} />
            <EditField label="State" value={draft.state as string} onChange={(v) => set("state", v)} />
            <EditField label="Property Type" value={draft.property_type as string} onChange={(v) => set("property_type", v)} />
            <EditField
              label="Year Built"
              type="number"
              value={(draft.year_built as number | null) ?? ""}
              onChange={(v) => set("year_built", numOrNull(v))}
            />
            <EditField
              label="Units"
              type="number"
              value={(draft.units as number | null) ?? ""}
              onChange={(v) => set("units", numOrNull(v))}
            />
            <EditField
              label="Total SF"
              type="number"
              value={(draft.total_sf as number | null) ?? ""}
              onChange={(v) => set("total_sf", numOrNull(v))}
            />
            {comp.comp_type === "sale" ? (
              <>
                <EditField
                  label="Sale Price"
                  type="number"
                  suffix="$"
                  value={(draft.sale_price as number | null) ?? ""}
                  onChange={(v) => set("sale_price", numOrNull(v))}
                />
                <EditField
                  label="Sale Date"
                  type="date"
                  value={(draft.sale_date as string | null) ?? ""}
                  onChange={(v) => set("sale_date", v || null)}
                />
                <EditField
                  label="Cap Rate"
                  type="number"
                  suffix="%"
                  value={(draft.cap_rate as number | null) ?? ""}
                  onChange={(v) => set("cap_rate", numOrNull(v))}
                />
                <EditField
                  label="$ / Unit"
                  type="number"
                  suffix="$"
                  value={(draft.price_per_unit as number | null) ?? ""}
                  onChange={(v) => set("price_per_unit", numOrNull(v))}
                />
                <EditField
                  label="$ / SF"
                  type="number"
                  suffix="$"
                  value={(draft.price_per_sf as number | null) ?? ""}
                  onChange={(v) => set("price_per_sf", numOrNull(v))}
                />
              </>
            ) : (
              <>
                <EditField
                  label="Rent / Unit (mo)"
                  type="number"
                  suffix="$"
                  value={(draft.rent_per_unit as number | null) ?? ""}
                  onChange={(v) => set("rent_per_unit", numOrNull(v))}
                />
                <EditField
                  label="Rent / SF (yr)"
                  type="number"
                  suffix="$"
                  value={(draft.rent_per_sf as number | null) ?? ""}
                  onChange={(v) => set("rent_per_sf", numOrNull(v))}
                />
                <EditField
                  label="Occupancy"
                  type="number"
                  suffix="%"
                  value={(draft.occupancy_pct as number | null) ?? ""}
                  onChange={(v) => set("occupancy_pct", numOrNull(v))}
                />
              </>
            )}
          </div>
          <div>
            <label className="block text-[10px] text-muted-foreground uppercase tracking-wide mb-1">
              Notes
            </label>
            <textarea
              value={(draft.source_note as string) ?? ""}
              onChange={(e) => set("source_note", e.target.value)}
              rows={2}
              className="w-full px-3 py-2 text-xs bg-muted/20 border border-border/40 rounded-lg outline-none resize-none focus:border-primary/40"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
              ) : (
                <Save className="h-3.5 w-3.5 mr-1.5" />
              )}
              Save
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function EditField({
  label,
  value,
  onChange,
  suffix,
  type = "text",
}: {
  label: string;
  value: string | number | null;
  onChange: (v: string) => void;
  suffix?: string;
  type?: string;
}) {
  return (
    <div>
      <label className="block text-[10px] text-muted-foreground uppercase tracking-wide mb-1">
        {label}
      </label>
      <div className="flex items-center border border-border/40 rounded-lg bg-muted/20 overflow-hidden">
        <input
          type={type}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder="—"
          className="flex-1 px-3 py-1.5 text-sm bg-transparent outline-none"
        />
        {suffix && (
          <span className="px-2 text-xs text-muted-foreground bg-muted/30 border-l border-border/40 py-1.5">
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Copy-to-Deal modal ────────────────────────────────────────────────────
//
// Clones a library comp into a target deal's comp set via
// POST /api/workspace/comps/[id]/copy-to-deal. Useful for pulling an
// institutional-memory comp into a new underwriting cycle.

function CopyToDealModal({
  comp,
  onClose,
  onSaved,
}: {
  comp: LibraryComp;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [deals, setDeals] = useState<DealPicker[]>([]);
  const [loading, setLoading] = useState(true);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/deals")
      .then((r) => r.json())
      .then((j) => {
        const all = (j.data || []) as DealPicker[];
        setDeals(all.filter((d) => d.status !== "archived"));
      })
      .catch(() => toast.error("Failed to load deals"))
      .finally(() => setLoading(false));
  }, []);

  async function handleCopy() {
    if (!targetId) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/workspace/comps/${comp.id}/copy-to-deal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deal_id: targetId }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || "Copy failed");
        return;
      }
      toast.success("Copied to deal");
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
          <h2 className="font-semibold text-sm">Copy Comp to Deal</h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-xs text-muted-foreground">
            Clones <span className="text-foreground">{comp.name || "this comp"}</span>{" "}
            into the target deal's comp set. The original stays in your workspace
            library.
          </p>

          <div>
            <label className="block text-[10px] text-muted-foreground uppercase tracking-wide mb-1">
              Target Deal
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
                    onClick={() => setTargetId(d.id)}
                    className={`w-full text-left px-3 py-2 rounded-md text-xs transition-colors ${
                      targetId === d.id
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

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={handleCopy} disabled={!targetId || saving}>
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
              ) : (
                <Copy className="h-3.5 w-3.5 mr-1.5" />
              )}
              Copy
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
