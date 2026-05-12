"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import type { PointerEvent, ReactNode } from "react";
import { v4 as uuidv4 } from "uuid";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  Calendar,
  GanttChart,
  MessageSquare,
  DollarSign,
  AlertTriangle,
  CheckCircle2,
  Wallet,
  TrendingUp,
  Settings as SettingsIcon,
  Loader2,
  ArrowUp,
  ArrowDown,
  BookmarkPlus,
  GripVertical,
  Paperclip,
  Download,
  Sparkles,
  Check,
  X as XIcon,
  ArrowUpDown,
  ArrowUpRight,
  ArrowUpAZ,
  ArrowDownAZ,
  PanelRightOpen,
  ClipboardPaste,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  InlineNumber,
  InlineDate,
  InlinePredecessor,
  InlineCurrency,
  InlineText,
} from "@/components/schedule/InlineEdit";
import {
  ScheduleColumnsMenu,
  type ScheduleColumnVisibility,
} from "@/components/schedule/ScheduleColumnsMenu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  DEV_PHASE_STATUS_CONFIG,
  PREDEV_COST_STATUS_CONFIG,
  PREDEV_CATEGORIES,
  DEFAULT_PREDEV_THRESHOLDS,
} from "@/lib/types";
import {
  TASK_CATEGORY_CONFIG,
  SCHEDULE_TRACK_LABELS,
  workstreamForPhase,
} from "@/lib/types";
import type {
  DevPhase,
  DevPhaseStatus,
  DevWorkstream,
  PreDevCost,
  PreDevCostStatus,
  PreDevSettings,
  ScheduleTrack,
  TaskCategory,
} from "@/lib/types";
import {
  ENTITLEMENT_SCENARIOS,
  findEntitlementScenario,
  findBonusCard,
} from "@/lib/bonus-catalog";
import { toast } from "sonner";
import { ScheduleSeedWizard } from "@/components/schedule/ScheduleSeedWizard";

/**
 * Per-user custom entitlement templates (now DB-backed). Each template
 * is a named list of tasks the analyst builds once and replays on
 * future deals — lives in `entitlement_templates` and follows the user
 * across machines.
 *
 * Shape matches the API payload: { label, duration_days, category?,
 * owner? } per task (intentionally slimmer than DevPhase — these are
 * authoring blueprints, not scheduled rows).
 */
interface EntitlementTemplate {
  id: string;
  name: string;
  tasks: Array<{
    label: string;
    duration_days: number;
    category?: TaskCategory;
    owner?: string;
  }>;
  shared?: boolean;
  /**
   * Comes from the GET endpoint — true when the current user created
   * this template. Non-owner rows are read-only in the UI.
   */
  is_owner?: boolean;
  created_at: string;
  updated_at?: string;
}

/**
 * One-time migration from the v1 localStorage templates (see prior PR)
 * to the DB. Runs best-effort on mount when the browser has a non-empty
 * cached list and the server returns none.
 */
const LEGACY_TEMPLATES_KEY = "entitlement_templates_v1";
function readLegacyLocalTemplates(): EntitlementTemplate[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LEGACY_TEMPLATES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function clearLegacyLocalTemplates(): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.removeItem(LEGACY_TEMPLATES_KEY); } catch { /* noop */ }
}

interface Props {
  dealId: string;
  /**
   * Which deal_dev_phases track to render. Defaults to "development"
   * (the component's original scope), but the same UI drives the
   * Acquisition and Construction schedule pages too so all three phases
   * of a deal feel like one continuous process. Dev-specific features
   * (Seed Defaults button, Pre-Dev Budget tracker, workstream filter)
   * auto-hide for other tracks.
   */
  track?: ScheduleTrack | "all";
  /**
   * Workstream filter. When set, only root phases whose phase_key maps
   * into one of these workstreams (plus their child tasks) render on
   * the schedule. Used by /project/<workstream> subpages to give each
   * DM workstream a focused view while sharing the underlying
   * deal_dev_phases rows with the master gantt. Only applied when
   * track === "development".
   */
  workstreams?: DevWorkstream[];
  /** Suppress the Schedule section — Pre-Dev page could use this to show budget only. */
  hideSchedule?: boolean;
  /** Suppress the Pre-Development Budget section — master gantt + most subpages hide it. Auto-forced true on non-dev tracks. */
  hideBudget?: boolean;
}

type ScheduleColumnWidthKey =
  | "name"
  | "duration"
  | "predecessor"
  | "start"
  | "finish"
  | "budget"
  | "owner"
  | "bar"
  | "actions";

type ScheduleColumnWidths = Record<ScheduleColumnWidthKey, number>;

const DEFAULT_SCHEDULE_COLUMN_WIDTHS: ScheduleColumnWidths = {
  name: 300,
  duration: 58,
  predecessor: 145,
  start: 104,
  finish: 104,
  budget: 116,
  owner: 138,
  bar: 420,
  actions: 96,
};

const SCHEDULE_COLUMN_LIMITS: Record<ScheduleColumnWidthKey, { min: number; max: number }> = {
  name: { min: 180, max: 560 },
  duration: { min: 48, max: 100 },
  predecessor: { min: 110, max: 260 },
  start: { min: 86, max: 160 },
  finish: { min: 86, max: 160 },
  budget: { min: 90, max: 190 },
  owner: { min: 96, max: 240 },
  bar: { min: 280, max: 900 },
  actions: { min: 76, max: 130 },
};

function clampColumnWidth(key: ScheduleColumnWidthKey, value: number) {
  const limits = SCHEDULE_COLUMN_LIMITS[key];
  return Math.min(limits.max, Math.max(limits.min, Math.round(value)));
}

function sanitizeColumnWidths(value: unknown): ScheduleColumnWidths {
  if (!value || typeof value !== "object") return DEFAULT_SCHEDULE_COLUMN_WIDTHS;
  const raw = value as Partial<Record<ScheduleColumnWidthKey, unknown>>;
  return (Object.keys(DEFAULT_SCHEDULE_COLUMN_WIDTHS) as ScheduleColumnWidthKey[]).reduce(
    (next, key) => {
      const candidate = Number(raw[key]);
      next[key] = Number.isFinite(candidate)
        ? clampColumnWidth(key, candidate)
        : DEFAULT_SCHEDULE_COLUMN_WIDTHS[key];
      return next;
    },
    { ...DEFAULT_SCHEDULE_COLUMN_WIDTHS }
  );
}

const fc = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

function scheduleScopeLabel(track: ScheduleTrack | "all") {
  return track === "all" ? "Master" : SCHEDULE_TRACK_LABELS[track];
}

type PastedScheduleRow = {
  label: string;
  duration_days: number;
  start_date: string;
  task_owner: string;
  track: ScheduleTrack;
};

function normalizePasteTrack(value: string | undefined, fallback: ScheduleTrack): ScheduleTrack {
  const raw = (value || "").trim().toLowerCase();
  if (raw === "acq" || raw === "acquisition") return "acquisition";
  if (raw === "dev" || raw === "development") return "development";
  if (raw === "con" || raw === "construction") return "construction";
  return fallback;
}

function parseSchedulePaste(text: string, fallbackTrack: ScheduleTrack): PastedScheduleRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];
  const splitLine = (line: string) =>
    line.includes("\t")
      ? line.split("\t").map((cell) => cell.trim())
      : line.split(",").map((cell) => cell.trim().replace(/^"|"$/g, ""));
  const first = splitLine(lines[0]).map((cell) => cell.toLowerCase());
  const hasHeader = first.some((cell) =>
    ["task", "task name", "phase", "name", "duration", "days", "start", "owner", "track"].includes(cell)
  );
  const headerIndex = (candidates: string[], fallback: number) => {
    if (!hasHeader) return fallback;
    const index = first.findIndex((cell) => candidates.some((candidate) => cell.includes(candidate)));
    return index >= 0 ? index : fallback;
  };
  const labelIndex = headerIndex(["task", "phase", "name"], 0);
  const durationIndex = headerIndex(["duration", "days"], 1);
  const startIndex = headerIndex(["start"], 2);
  const ownerIndex = headerIndex(["owner", "assignee"], 3);
  const trackIndex = headerIndex(["track", "phase group"], 4);
  return lines.slice(hasHeader ? 1 : 0).flatMap((line) => {
    const cells = splitLine(line);
    const label = cells[labelIndex]?.trim();
    if (!label) return [];
    const duration = Number(cells[durationIndex]);
    return [{
      label,
      duration_days: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : 30,
      start_date: cells[startIndex] || "",
      task_owner: cells[ownerIndex] || "",
      track: normalizePasteTrack(cells[trackIndex], fallbackTrack),
    }];
  });
}

export default function DevelopmentSchedule({
  dealId,
  track = "development",
  workstreams,
  hideSchedule = false,
  hideBudget = false,
}: Props) {
  // Dev-specific UI (Pre-Dev Budget section, workstream filter,
  // entitlement scenario seeder) is scoped to the Development track.
  // The Seed Defaults button is available on every track and seeds
  // only that track's phases; see /api/deals/[id]/dev-schedule/seed.
  const isDevTrack = track === "development";
  const isMasterTrack = track === "all";
  const effectiveHideBudget = hideBudget || !isDevTrack;
  const effectiveWorkstreams = isDevTrack ? workstreams : undefined;
  const [phases, setPhases] = useState<DevPhase[]>([]);
  const [costs, setCosts] = useState<PreDevCost[]>([]);
  const [settings, setSettings] = useState<PreDevSettings>({
    total_budget: null,
    thresholds: DEFAULT_PREDEV_THRESHOLDS,
  });
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  // Wizard sits at the deal level — opens the bundle picker when the
  // user clicks "Seed Default Phases" instead of dumping every track's
  // default chain at once.
  const [wizardOpen, setWizardOpen] = useState(false);
  // Bulk selection — checkboxes inline on each row, action bar above
  // the schedule once anything is selected.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const selectedRows = useMemo(
    () => phases.filter((phase) => selectedIds.has(phase.id)),
    [phases, selectedIds]
  );
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const validIds = new Set(phases.map((phase) => phase.id));
      const next = new Set(Array.from(prev).filter((id) => validIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [phases]);
  const toggleRowSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const clearSelection = () => setSelectedIds(new Set());
  const selectAllRows = () => setSelectedIds(new Set(phases.map((phase) => phase.id)));
  const patchSelectedRows = async (
    buildUpdates: (phase: DevPhase) => Record<string, unknown>,
    successLabel: string
  ) => {
    const rows = selectedRows;
    if (rows.length === 0 || bulkUpdating) return;
    setBulkUpdating(true);
    try {
      const results = await Promise.all(
        rows.map(async (phase) => {
          const res = await fetch(`/api/deals/${dealId}/schedule/${phase.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(buildUpdates(phase)),
          });
          if (!res.ok) throw new Error(phase.label);
          return phase.id;
        })
      );
      clearSelection();
      await loadAll();
      toast.success(`${successLabel} for ${results.length} row${results.length === 1 ? "" : "s"}`);
    } catch (err) {
      await loadAll();
      toast.error(err instanceof Error ? `Failed on ${err.message}` : "Bulk update failed");
    } finally {
      setBulkUpdating(false);
    }
  };
  const handleBulkStatus = (status: DevPhaseStatus) => {
    patchSelectedRows(
      (phase) => ({
        status,
        pct_complete:
          status === "complete"
            ? 100
            : status === "not_started"
              ? 0
              : status === "in_progress"
                ? Math.max(Number(phase.pct_complete ?? 0), 25)
                : phase.pct_complete,
      }),
      `Marked ${DEV_PHASE_STATUS_CONFIG[status].label.toLowerCase()}`
    );
  };
  const handleBulkOwner = () => {
    const owner = window.prompt("Set owner for selected rows:", selectedRows[0]?.task_owner || "");
    if (owner == null) return;
    patchSelectedRows(
      () => ({ task_owner: owner.trim() || null }),
      owner.trim() ? `Assigned to ${owner.trim()}` : "Cleared owner"
    );
  };
  const handleBulkTrack = (nextTrack: ScheduleTrack) => {
    patchSelectedRows(
      () => ({ track: nextTrack }),
      `Moved to ${SCHEDULE_TRACK_LABELS[nextTrack]}`
    );
  };
  const handleBulkDelete = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (!confirm(`Delete ${ids.length} ${ids.length === 1 ? "row" : "rows"}? This can't be undone.`))
      return;
    setBulkDeleting(true);
    const results = await Promise.allSettled(
      ids.map(async (id) => {
        const res = await fetch(`/api/deals/${dealId}/schedule/${id}`, { method: "DELETE" });
        if (!res.ok) throw new Error(id);
      }),
    );
    const failed = results.filter((r) => r.status === "rejected").length;
    setBulkDeleting(false);
    clearSelection();
    await loadAll();
    if (failed > 0) toast.error(`${failed} delete${failed === 1 ? "" : "s"} failed`);
    else toast.success(`Deleted ${ids.length} ${ids.length === 1 ? "row" : "rows"}`);
  };

  const [scheduleExpanded, setScheduleExpanded] = useState(true);
  const [budgetExpanded, setBudgetExpanded] = useState(true);

  // Sortable column header state. `null` => use manual sort_order (the
  // default). Drag-reorder + up/down arrows always clear sort and fall
  // back to manual order so the user's drop intent isn't immediately
  // overwritten.
  type SortKey =
    | "name"
    | "duration"
    | "start"
    | "finish"
    | "budget"
    | "predecessor";
  const [sortBy, setSortBy] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // Column visibility — persists per (deal, track) so analysts can
  // arrange Acquisition / Development / Construction tracks
  // independently. Defaults give Dev/Con an Owner column out of the box;
  // Predecessor is hidden by default everywhere (power-user feature).
  const colDefaults: ScheduleColumnVisibility = useMemo(
    () => ({
      predecessor: false,
      start: true,
      finish: true,
      budget: true,
      owner: track !== "acquisition",
    }),
    [track]
  );
  const [columns, setColumns] =
    useState<ScheduleColumnVisibility>(colDefaults);
  const [columnWidths, setColumnWidths] = useState<ScheduleColumnWidths>(DEFAULT_SCHEDULE_COLUMN_WIDTHS);
  // Per-parent toggle for the "add subtask" inline form. Master view
  // stays clean by default — tasks are added explicitly via this
  // affordance or via the mini-schedule module on a checklist item.
  const [openSubAddFor, setOpenSubAddFor] = useState<string | null>(null);
  // Timeline zoom: pixels per day. 28 → week-level detail, 8 → month,
  // 2.5 → quarter overview. Persisted to localStorage per deal+track.
  const [pxPerDay, setPxPerDay] = useState<number>(8);
  const zoomStorageKey = `dealSchedule:${dealId}:${track}:zoom`;
  const colsStorageKey = `dealSchedule:${dealId}:${track}:cols`;
  const widthsStorageKey = `dealSchedule:${dealId}:${track}:widths:v1`;
  const sortStorageKey = `dealSchedule:${dealId}:${track}:sort`;
  // Load persisted prefs on mount / deal+track change.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const rawCols = window.localStorage.getItem(colsStorageKey);
      if (rawCols) {
        const parsed = JSON.parse(rawCols);
        if (parsed && typeof parsed === "object") {
          setColumns({ ...colDefaults, ...parsed });
        } else {
          setColumns(colDefaults);
        }
      } else {
        setColumns(colDefaults);
      }
    } catch {
      setColumns(colDefaults);
    }
    try {
      const rawWidths = window.localStorage.getItem(widthsStorageKey);
      setColumnWidths(rawWidths ? sanitizeColumnWidths(JSON.parse(rawWidths)) : DEFAULT_SCHEDULE_COLUMN_WIDTHS);
    } catch {
      setColumnWidths(DEFAULT_SCHEDULE_COLUMN_WIDTHS);
    }
    try {
      const rawSort = window.localStorage.getItem(sortStorageKey);
      if (rawSort) {
        const parsed = JSON.parse(rawSort);
        if (parsed && typeof parsed === "object") {
          setSortBy(parsed.sortBy ?? null);
          setSortDir(parsed.sortDir === "desc" ? "desc" : "asc");
        }
      } else {
        setSortBy(null);
      }
    } catch {
      setSortBy(null);
    }
    try {
      const rawZoom = window.localStorage.getItem(zoomStorageKey);
      const z = rawZoom ? Number(rawZoom) : NaN;
      if (Number.isFinite(z) && z >= 1 && z <= 60) setPxPerDay(z);
    } catch { /* swallow */ }
  }, [colsStorageKey, widthsStorageKey, sortStorageKey, zoomStorageKey, colDefaults]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(zoomStorageKey, String(pxPerDay));
    } catch { /* swallow */ }
  }, [zoomStorageKey, pxPerDay]);
  // Persist column visibility on change.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(colsStorageKey, JSON.stringify(columns));
    } catch { /* swallow */ }
  }, [colsStorageKey, columns]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(widthsStorageKey, JSON.stringify(columnWidths));
    } catch { /* swallow */ }
  }, [widthsStorageKey, columnWidths]);
  // Persist sort on change.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        sortStorageKey,
        JSON.stringify({ sortBy, sortDir })
      );
    } catch { /* swallow */ }
  }, [sortStorageKey, sortBy, sortDir]);

  // Header click cycles asc → desc → off (back to manual order).
  const cycleSort = (key: SortKey) => {
    if (sortBy !== key) {
      setSortBy(key);
      setSortDir("asc");
      return;
    }
    if (sortDir === "asc") {
      setSortDir("desc");
      return;
    }
    setSortBy(null);
    setSortDir("asc");
  };

  const beginColumnResize = useCallback(
    (key: ScheduleColumnWidthKey, event: PointerEvent<HTMLSpanElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const startX = event.clientX;
      const startWidth = columnWidths[key];
      const doc = event.currentTarget.ownerDocument;
      const move = (moveEvent: globalThis.PointerEvent) => {
        const delta = moveEvent.clientX - startX;
        setColumnWidths((prev) => ({
          ...prev,
          [key]: clampColumnWidth(key, startWidth + delta),
        }));
      };
      const stop = () => {
        doc.removeEventListener("pointermove", move);
        doc.removeEventListener("pointerup", stop);
        doc.body.style.cursor = "";
        doc.body.style.userSelect = "";
      };
      doc.body.style.cursor = "col-resize";
      doc.body.style.userSelect = "none";
      doc.addEventListener("pointermove", move);
      doc.addEventListener("pointerup", stop, { once: true });
    },
    [columnWidths]
  );

  // Phase dialog
  const [phaseDialogOpen, setPhaseDialogOpen] = useState(false);
  const [editingPhase, setEditingPhase] = useState<DevPhase | null>(null);
  const [detailPhaseId, setDetailPhaseId] = useState<string | null>(null);
  const [phaseForm, setPhaseForm] = useState({
    label: "",
    duration_days: 30,
    predecessor_id: "",
    lag_days: 0,
    start_date: "",
    pct_complete: 0,
    status: "not_started" as DevPhaseStatus,
    notes: "",
    // When set, the phase being created is a child task rendered under
    // its parent phase (e.g. "Neighborhood Meeting" under "Entitlements
    // & Permits"). Empty string = top-level phase.
    parent_phase_id: "",
    // Entitlement task category chip. Empty string = no category.
    task_category: "" as TaskCategory | "",
    // Free-text owner / assignee for child tasks.
    task_owner: "",
    // Documents from the deal's Documents tab linked to this task.
    // Stored as an array of document ids — the picker writes this, the
    // child row renders a paperclip chip when it's non-empty.
    linked_document_ids: [] as string[],
    // Optional per-task budget. Null = no budget set. Rolls up under the
    // parent phase in the schedule so analysts see total committed
    // entitlement spend without jumping to the pre-dev budget tracker.
    budget: null as number | null,
  });
  const [quickAdd, setQuickAdd] = useState({
    label: "",
    track: "development" as ScheduleTrack,
    duration_days: 30,
    start_date: "",
    task_owner: "",
  });
  const [quickAdding, setQuickAdding] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasteTrack, setPasteTrack] = useState<ScheduleTrack>("development");
  const [pastingRows, setPastingRows] = useState(false);
  const [childQuickAdds, setChildQuickAdds] = useState<
    Record<string, { label: string; duration_days: number; task_owner: string }>
  >({});
  const [seedingEntitlements, setSeedingEntitlements] = useState(false);
  // Deal documents — fetched once and used by the phase dialog's linker.
  const [dealDocuments, setDealDocuments] = useState<
    Array<{ id: string; name: string; original_name?: string | null; category?: string | null }>
  >([]);
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/deals/${dealId}/documents`);
        const json = await res.json();
        if (res.ok && Array.isArray(json.data)) setDealDocuments(json.data);
      } catch { /* no docs — the linker just shows empty state */ }
    })();
  }, [dealId]);
  const detailPhase = useMemo(
    () => phases.find((phase) => phase.id === detailPhaseId) || null,
    [phases, detailPhaseId]
  );
  const pastedRows = useMemo(
    () => parseSchedulePaste(pasteText, pasteTrack),
    [pasteText, pasteTrack]
  );
  // AI-suggest state — a preview modal drives which tasks actually land
  // on the schedule (we never auto-create).
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestTarget, setSuggestTarget] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<
    Array<{ label: string; duration_days: number; category: TaskCategory; rationale: string }>
  >([]);
  const [suggestPicked, setSuggestPicked] = useState<Set<number>>(new Set());
  const [suggestMeta, setSuggestMeta] = useState<{ jurisdiction: string; spottedBonuses: string[] } | null>(null);
  // Drag sensors for reordering entitlement child tasks. Pointer
  // activates after a small movement so regular clicks (like label
  // edit) still work.
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  // User's custom entitlement templates — DB-backed so they follow the
  // user across machines. Loaded once on mount; subsequent mutations
  // refresh via reloadTemplates().
  const [templates, setTemplates] = useState<EntitlementTemplate[]>([]);
  const reloadTemplates = useCallback(async () => {
    try {
      const res = await fetch("/api/entitlement-templates");
      const json = await res.json();
      if (res.ok && Array.isArray(json.data)) {
        setTemplates(json.data);
        return json.data as EntitlementTemplate[];
      }
    } catch { /* swallow — empty list is fine */ }
    setTemplates([]);
    return [] as EntitlementTemplate[];
  }, []);
  useEffect(() => {
    (async () => {
      const rows = await reloadTemplates();
      // One-time migration: if server has nothing but localStorage has a
      // cached v1 list, upload them then clear the legacy bucket.
      if (rows.length === 0) {
        const legacy = readLegacyLocalTemplates();
        if (legacy.length > 0) {
          try {
            for (const tpl of legacy) {
              await fetch("/api/entitlement-templates", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: tpl.name, tasks: tpl.tasks }),
              });
            }
            clearLegacyLocalTemplates();
            await reloadTemplates();
            toast.message(
              `Migrated ${legacy.length} local template${legacy.length === 1 ? "" : "s"} to your account`
            );
          } catch { /* best-effort */ }
        }
      }
    })();
  }, [reloadTemplates]);
  // Pair-swap reordering guards the child row up/down arrows.
  const [reorderingIds, setReorderingIds] = useState<Set<string>>(new Set());

  // Cost dialog
  const [costDialogOpen, setCostDialogOpen] = useState(false);
  const [editingCost, setEditingCost] = useState<PreDevCost | null>(null);
  const [costForm, setCostForm] = useState({
    category: PREDEV_CATEGORIES[0] as string,
    description: "",
    vendor: "",
    amount: 0,
    status: "estimated" as PreDevCostStatus,
    incurred_date: "",
    notes: "",
  });

  // Settings dialog
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [settingsForm, setSettingsForm] = useState<PreDevSettings>({
    total_budget: null,
    thresholds: DEFAULT_PREDEV_THRESHOLDS,
  });

  const loadAll = useCallback(async () => {
    try {
      const [phasesRes, costsRes, settingsRes] = await Promise.all([
        // Filter to the caller-supplied track. deal_dev_phases holds all
        // three tracks (acquisition / development / construction); the
        // page is just picking which slice to render.
        fetch(`/api/deals/${dealId}/dev-schedule${isMasterTrack ? "" : `?track=${track}`}`),
        // Pre-dev costs + settings are dev-track-only; skip the fetch
        // entirely on acq/con to cut round-trips.
        isDevTrack
          ? fetch(`/api/deals/${dealId}/predev-costs`)
          : Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 })),
        isDevTrack
          ? fetch(`/api/deals/${dealId}/predev-settings`)
          : Promise.resolve(new Response(JSON.stringify({ data: null }), { status: 200 })),
      ]);
      const [pj, cj, sj] = await Promise.all([phasesRes.json(), costsRes.json(), settingsRes.json()]);
      setPhases(pj.data || []);
      setCosts(cj.data || []);
      if (sj.data) {
        setSettings({
          total_budget: sj.data.total_budget ?? null,
          thresholds: sj.data.thresholds || DEFAULT_PREDEV_THRESHOLDS,
        });
      }
    } catch (err) {
      console.error("Failed to load dev schedule:", err);
    } finally {
      setLoading(false);
    }
  }, [dealId, track, isDevTrack, isMasterTrack]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // ── Seed default phases ──
  const handleSeedPhases = async () => {
    if (isMasterTrack) {
      setWizardOpen(true);
      return;
    }
    setSeeding(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/dev-schedule/seed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start_date: new Date().toISOString().split("T")[0],
          track,
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        toast.error(json.error || `Seed failed (HTTP ${res.status})`);
        return;
      }
      const json = await res.json().catch(() => ({}));
      await loadAll();
      if (json?.data?.seeded) {
        toast.success("Default phases seeded");
      } else {
        toast.info("Phases already exist on this track");
      }
    } catch (err) {
      console.error("Failed to seed phases:", err);
      toast.error("Failed to seed phases — check console");
    } finally {
      setSeeding(false);
    }
  };

  // ── Phase CRUD ──
  const resetPhaseForm = () => {
    setPhaseForm({ label: "", duration_days: 30, predecessor_id: "", lag_days: 0, start_date: "", pct_complete: 0, status: "not_started", notes: "", parent_phase_id: "", task_category: "", task_owner: "", linked_document_ids: [], budget: null });
  };

  const openCreatePhase = () => {
    setEditingPhase(null);
    resetPhaseForm();
    setPhaseDialogOpen(true);
  };

  /**
   * Open the phase dialog in "new task under parent X" mode — used by
   * the "+ Task" button on nested phases like Entitlements & Permits.
   * The new phase inherits the parent_phase_id so it renders as a
   * child task.
   */
  const openCreateChildPhase = (parentPhaseId: string) => {
    setEditingPhase(null);
    setPhaseForm({
      label: "",
      duration_days: 30,
      predecessor_id: "",
      lag_days: 0,
      start_date: "",
      pct_complete: 0,
      status: "not_started",
      notes: "",
      parent_phase_id: parentPhaseId,
      task_category: "pre_submittal",
      task_owner: "",
      linked_document_ids: [],
      budget: null,
    });
    setPhaseDialogOpen(true);
  };

  const openEditPhase = (p: DevPhase) => {
    setEditingPhase(p);
    setPhaseForm({
      label: p.label,
      duration_days: p.duration_days ?? 30,
      predecessor_id: p.predecessor_id || "",
      lag_days: p.lag_days ?? 0,
      start_date: p.start_date || "",
      pct_complete: p.pct_complete,
      status: p.status,
      notes: p.notes || "",
      parent_phase_id: p.parent_phase_id || "",
      task_category: p.task_category ?? "",
      task_owner: p.task_owner ?? "",
      linked_document_ids: Array.isArray(p.linked_document_ids)
        ? p.linked_document_ids
        : [],
      budget: p.budget != null ? Number(p.budget) : null,
    });
    setPhaseDialogOpen(true);
  };

  const handleSavePhase = async () => {
    if (!phaseForm.label.trim()) return;
    // If phase has a predecessor, server will compute start_date — clear the manual one
    const hasPredecessor = !!phaseForm.predecessor_id;
    const payload = {
      // Stamp the track on create so the server-side default (develop-
      // ment) doesn't stash every new row in the dev track regardless
      // of which schedule page the user was on.
      track: track === "all" ? "development" : track,
      label: phaseForm.label,
      duration_days: phaseForm.duration_days,
      predecessor_id: phaseForm.predecessor_id || null,
      lag_days: phaseForm.lag_days,
      parent_phase_id: phaseForm.parent_phase_id || null,
      task_category: phaseForm.task_category || null,
      task_owner: phaseForm.task_owner?.trim() || null,
      linked_document_ids: phaseForm.linked_document_ids.length > 0
        ? phaseForm.linked_document_ids
        : null,
      budget: phaseForm.budget,
      start_date: hasPredecessor ? null : (phaseForm.start_date || null),
      pct_complete: phaseForm.pct_complete,
      status: phaseForm.status,
      notes: phaseForm.notes,
    };
    try {
      let res;
      if (editingPhase) {
        res = await fetch(`/api/deals/${dealId}/dev-schedule/${editingPhase.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetch(`/api/deals/${dealId}/dev-schedule`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, sort_order: phases.length }),
        });
      }
      if (!res.ok) {
        const err = await res.json();
        const msg = err.detail
          ? `${err.error || "Failed to save phase"}: ${err.detail}`
          : err.error || "Failed to save phase";
        alert(msg);
        return;
      }
      setPhaseDialogOpen(false);
      setEditingPhase(null);
      resetPhaseForm();
      loadAll();
    } catch (err) {
      console.error("Failed to save phase:", err);
    }
  };

  const handleQuickAddPhase = async () => {
    const label = quickAdd.label.trim();
    if (!label || quickAdding) return;
    setQuickAdding(true);
    try {
      const payload = {
        track: track === "all" ? quickAdd.track : track,
        label,
        duration_days: Math.max(1, Number(quickAdd.duration_days) || 1),
        predecessor_id: null,
        lag_days: 0,
        parent_phase_id: null,
        task_category: null,
        task_owner: quickAdd.task_owner.trim() || null,
        linked_document_ids: null,
        budget: null,
        start_date: quickAdd.start_date || null,
        pct_complete: 0,
        status: "not_started" as DevPhaseStatus,
        notes: "",
        sort_order: phases.length,
      };
      const res = await fetch(`/api/deals/${dealId}/dev-schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.detail || err.error || "Failed to add schedule row");
        return;
      }
      setQuickAdd({
        label: "",
        track: quickAdd.track,
        duration_days: quickAdd.duration_days,
        start_date: quickAdd.start_date,
        task_owner: "",
      });
      await loadAll();
    } catch (err) {
      toast.error((err as Error).message || "Failed to add schedule row");
    } finally {
      setQuickAdding(false);
    }
  };

  const handlePasteImport = async () => {
    if (pastedRows.length === 0 || pastingRows) return;
    setPastingRows(true);
    let created = 0;
    try {
      for (let i = 0; i < pastedRows.length; i++) {
        const row = pastedRows[i];
        const res = await fetch(`/api/deals/${dealId}/dev-schedule`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            track: track === "all" ? row.track : track,
            label: row.label,
            duration_days: row.duration_days,
            predecessor_id: null,
            lag_days: 0,
            parent_phase_id: null,
            task_category: null,
            task_owner: row.task_owner || null,
            linked_document_ids: null,
            budget: null,
            start_date: row.start_date || null,
            pct_complete: 0,
            status: "not_started",
            notes: "",
            sort_order: phases.length + i,
          }),
        });
        if (res.ok) created++;
      }
      toast.success(`Imported ${created} schedule row${created === 1 ? "" : "s"}`);
      setPasteOpen(false);
      setPasteText("");
      await loadAll();
    } catch (err) {
      toast.error((err as Error).message || "Paste import failed");
    } finally {
      setPastingRows(false);
    }
  };

  const handleQuickAddChild = async (parent: DevPhase) => {
    const draft = childQuickAdds[parent.id];
    const label = draft?.label?.trim();
    if (!label) return;
    try {
      const siblings = phases.filter((phase) => phase.parent_phase_id === parent.id);
      const res = await fetch(`/api/deals/${dealId}/dev-schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          track: parent.track ?? (track === "all" ? "development" : track),
          label,
          duration_days: Math.max(1, Number(draft.duration_days) || 1),
          predecessor_id: null,
          lag_days: 0,
          parent_phase_id: parent.id,
          task_category: "pre_submittal",
          task_owner: draft.task_owner?.trim() || null,
          linked_document_ids: null,
          budget: null,
          start_date: null,
          pct_complete: 0,
          status: "not_started",
          notes: "",
          sort_order: siblings.length,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.detail || err.error || "Failed to add child task");
        return;
      }
      setChildQuickAdds((prev) => ({
        ...prev,
        [parent.id]: { label: "", duration_days: draft.duration_days || 7, task_owner: "" },
      }));
      await loadAll();
    } catch (err) {
      toast.error((err as Error).message || "Failed to add child task");
    }
  };

  /**
   * Inline-edit helper. Patches a single field on a phase and reloads.
   * Optimistic: we mutate local state first so the UI doesn't flicker
   * while the network round-trip is in flight, then trigger a full
   * reload so the server's recompute (predecessor cascades, end_date
   * recompute) lands in the view.
   */
  const updatePhaseField = async (id: string, updates: Record<string, unknown>) => {
    setPhases((prev) =>
      prev.map((p) => (p.id === id ? ({ ...p, ...updates } as DevPhase) : p))
    );
    try {
      const res = await fetch(`/api/deals/${dealId}/dev-schedule/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        const msg = j.detail
          ? `${j.error || "Update failed"}: ${j.detail}`
          : j.error || "Update failed";
        toast.error(msg);
        await loadAll(); // revert optimistic
        return;
      }
      await loadAll();
    } catch (err) {
      toast.error((err as Error).message || "Update failed");
      await loadAll();
    }
  };

  const handleDeletePhase = async (id: string) => {
    try {
      await fetch(`/api/deals/${dealId}/dev-schedule/${id}`, { method: "DELETE" });
      loadAll();
    } catch (err) {
      console.error("Failed to delete phase:", err);
    }
  };

  /**
   * Seed child tasks under the Entitlements & Permits parent based on a
   * chosen scenario (by-right, ministerial, major discretionary,
   * rezone/GPA, specific plan, coastal, historic). Spotted bonus cards
   * (SB 35 / CCHS / SB 330) still layer in program-specific filings on
   * top of whatever scenario is picked.
   *
   * Idempotent — dedupes by label (case-insensitive) and skips any task
   * already present as a child of the entitlements parent. Re-click
   * after spotting another bonus, no duplicates.
   *
   * @param source — either `{ kind: "scenario", scenarioKey }` to seed a
   *   built-in approval pathway (bonus filings layered on top), or
   *   `{ kind: "template", template }` to apply a user-saved template
   *   as-is. Templates skip the bonus-merge step so they apply
   *   predictably every time.
   */
  const handleSeedEntitlementTasks = async (
    entitlementPhaseId: string,
    source:
      | { kind: "scenario"; scenarioKey: string }
      | { kind: "template"; template: EntitlementTemplate }
  ) => {
    let scenarioLabel: string;
    let baseTasks: Array<{ label: string; duration_days: number; category?: TaskCategory; owner?: string }>;
    if (source.kind === "scenario") {
      const scenario = findEntitlementScenario(source.scenarioKey);
      if (!scenario) {
        toast.error("Unknown scenario");
        return;
      }
      scenarioLabel = scenario.label;
      baseTasks = scenario.tasks.map((t) => ({
        label: t.label,
        duration_days: t.duration_days,
        category: t.category,
      }));
    } else {
      scenarioLabel = source.template.name;
      baseTasks = source.template.tasks.map((t) => ({
        label: t.label,
        duration_days: t.duration_days,
        category: t.category,
        owner: t.owner,
      }));
    }
    setSeedingEntitlements(true);
    try {
      // Scenario seeds layer in program-specific filings from any
      // spotted bonus cards; templates are user-defined and apply as-is.
      let spottedSources: string[] = [];
      if (source.kind === "scenario") {
        try {
          const uwRes = await fetch(`/api/underwriting?deal_id=${dealId}`);
          const uwJson = await uwRes.json();
          const raw = uwJson.data?.data;
          const parsed = raw == null ? null : typeof raw === "string" ? JSON.parse(raw) : raw;
          spottedSources = (parsed?.zoning_info?.density_bonuses || [])
            .map((b: { source?: string }) => b?.source)
            .filter((s: unknown): s is string => typeof s === "string" && s.length > 0);
        } catch {
          /* Deal may have no underwriting yet — fall through to scenario only */
        }
      }

      // Build the task list: scenario/template tasks first, then
      // bonus-specific filings (scenarios only).
      const toCreate: Array<{ label: string; duration_days: number; category?: TaskCategory; owner?: string }> = [
        ...baseTasks,
      ];
      for (const src of spottedSources) {
        const card = findBonusCard(src);
        for (const t of card?.effects?.entitlement_tasks ?? []) {
          toCreate.push({
            label: t.label,
            duration_days: t.duration_days ?? 30,
            category: t.category,
          });
        }
      }

      // Dedupe by label (case-insensitive); skip any label that's already
      // a child task of the entitlements parent.
      const existingLabels = new Set(
        phases
          .filter((p) => p.parent_phase_id === entitlementPhaseId)
          .map((p) => p.label.trim().toLowerCase())
      );
      const seen = new Set<string>();
      const uniqueNew = toCreate.filter((t) => {
        const key = t.label.trim().toLowerCase();
        if (existingLabels.has(key) || seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      if (uniqueNew.length === 0) {
        toast.message("All tasks from this scenario are already seeded");
        return;
      }

      // Sort order picks up from after the last existing task in the
      // entitlements parent so new items land at the bottom of the group.
      const baseSort = phases
        .filter((p) => p.parent_phase_id === entitlementPhaseId)
        .reduce((max, p) => Math.max(max, p.sort_order), 0);

      let created = 0;
      for (let i = 0; i < uniqueNew.length; i++) {
        const t = uniqueNew[i];
        const res = await fetch(`/api/deals/${dealId}/dev-schedule`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            label: t.label,
            duration_days: t.duration_days,
            parent_phase_id: entitlementPhaseId,
            task_category: t.category ?? null,
            task_owner: t.owner ?? null,
            sort_order: baseSort + i + 1,
          }),
        });
        if (res.ok) created++;
      }
      toast.success(
        `Seeded ${created} task${created === 1 ? "" : "s"} for "${scenarioLabel}"${
          spottedSources.length > 0 ? ` (+ ${spottedSources.length} bonus program${spottedSources.length === 1 ? "" : "s"})` : ""
        }`
      );
      loadAll();
    } catch (err) {
      console.error("Failed to seed entitlement tasks:", err);
      toast.error("Failed to seed entitlement tasks");
    } finally {
      setSeedingEntitlements(false);
    }
  };

  /**
   * Remove every child task under the entitlements parent. Useful when
   * the user wants to switch scenarios cleanly — they can clear first,
   * then seed the new scenario. Confirms once before bulk-deleting.
   */
  const handleClearEntitlementTasks = async (entitlementPhaseId: string) => {
    const children = phases.filter((p) => p.parent_phase_id === entitlementPhaseId);
    if (children.length === 0) {
      toast.message("No tasks to clear");
      return;
    }
    const ok = window.confirm(
      `Delete all ${children.length} task${children.length === 1 ? "" : "s"} under Entitlements & Permits? (The parent phase stays.)`
    );
    if (!ok) return;
    setSeedingEntitlements(true);
    try {
      await Promise.all(
        children.map((c) =>
          fetch(`/api/deals/${dealId}/dev-schedule/${c.id}`, { method: "DELETE" })
        )
      );
      toast.success(`Cleared ${children.length} task${children.length === 1 ? "" : "s"}`);
      loadAll();
    } catch (err) {
      console.error("Failed to clear entitlement tasks:", err);
      toast.error("Failed to clear tasks");
    } finally {
      setSeedingEntitlements(false);
    }
  };

  /**
   * Save the entitlements parent's current children as a reusable
   * template. Persisted to localStorage so the analyst can re-apply
   * the same task list on future deals without rebuilding it.
   */
  /** Snapshot a parent's current children into a task-list payload. */
  const buildTemplateTasks = (entitlementPhaseId: string) =>
    phases
      .filter((p) => p.parent_phase_id === entitlementPhaseId)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((p) => ({
        label: p.label,
        duration_days: p.duration_days ?? 30,
        category: p.task_category ?? undefined,
        owner: p.task_owner ?? undefined,
      }));

  const handleSaveAsTemplate = async (entitlementPhaseId: string) => {
    const tasks = buildTemplateTasks(entitlementPhaseId);
    if (tasks.length === 0) {
      toast.error("Nothing to save — add tasks first");
      return;
    }
    const name = window.prompt(
      "Name this template (so you can find it later):",
      `My Entitlement Path ${templates.length + 1}`
    );
    if (!name || !name.trim()) return;
    try {
      const res = await fetch("/api/entitlement-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), tasks }),
      });
      if (!res.ok) throw new Error();
      await reloadTemplates();
      toast.success(`Saved "${name.trim()}" — re-apply from the Seed dropdown`);
    } catch {
      toast.error("Failed to save template");
    }
  };

  /** Flip the shared flag on a template the current user owns. */
  const handleToggleShareTemplate = async (templateId: string) => {
    const tpl = templates.find((t) => t.id === templateId);
    if (!tpl) return;
    const nextShared = !tpl.shared;
    try {
      const res = await fetch(`/api/entitlement-templates/${templateId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shared: nextShared }),
      });
      if (!res.ok) throw new Error();
      await reloadTemplates();
      toast.success(
        nextShared
          ? `"${tpl.name}" is now shared with your workspace`
          : `"${tpl.name}" is back to private`
      );
    } catch {
      toast.error("Failed to toggle sharing");
    }
  };

  /** Rename an existing template in place. */
  const handleRenameTemplate = async (templateId: string) => {
    const tpl = templates.find((t) => t.id === templateId);
    if (!tpl) return;
    const next = window.prompt("Rename template:", tpl.name);
    if (!next || !next.trim() || next.trim() === tpl.name) return;
    try {
      const res = await fetch(`/api/entitlement-templates/${templateId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: next.trim() }),
      });
      if (!res.ok) throw new Error();
      await reloadTemplates();
      toast.success(`Renamed to "${next.trim()}"`);
    } catch {
      toast.error("Failed to rename template");
    }
  };

  /**
   * Overwrite a template's tasks with the current children of the
   * entitlements phase. Useful when the analyst tweaks their pathway
   * after saving and wants the template to reflect the current state.
   */
  const handleOverwriteTemplate = async (
    templateId: string,
    entitlementPhaseId: string
  ) => {
    const tpl = templates.find((t) => t.id === templateId);
    if (!tpl) return;
    const tasks = buildTemplateTasks(entitlementPhaseId);
    if (tasks.length === 0) {
      toast.error("No tasks under Entitlements — nothing to snapshot");
      return;
    }
    if (!window.confirm(
      `Overwrite "${tpl.name}" with the current ${tasks.length} task${tasks.length === 1 ? "" : "s"}? The saved version will be replaced.`
    )) return;
    try {
      const res = await fetch(`/api/entitlement-templates/${templateId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tasks }),
      });
      if (!res.ok) throw new Error();
      await reloadTemplates();
      toast.success(`Updated "${tpl.name}"`);
    } catch {
      toast.error("Failed to update template");
    }
  };

  const handleDeleteTemplate = async (templateId: string) => {
    const tpl = templates.find((t) => t.id === templateId);
    if (!tpl) return;
    if (!window.confirm(`Delete template "${tpl.name}"?`)) return;
    try {
      const res = await fetch(`/api/entitlement-templates/${templateId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error();
      await reloadTemplates();
      toast.success(`Deleted template "${tpl.name}"`);
    } catch {
      toast.error("Failed to delete template");
    }
  };

  /**
   * Open the AI-suggest modal. Reads the deal / jurisdiction context,
   * asks Claude for a jurisdiction-specific task list, and shows a
   * preview. The user ticks the ones they want; we then POST them as
   * child tasks of the entitlements phase.
   */
  const handleAiSuggest = async (entitlementPhaseId: string) => {
    setSuggestTarget(entitlementPhaseId);
    setSuggestOpen(true);
    setSuggesting(true);
    setSuggestions([]);
    setSuggestPicked(new Set());
    setSuggestMeta(null);
    try {
      const res = await fetch(
        `/api/deals/${dealId}/dev-schedule/suggest-entitlement-tasks`,
        { method: "POST" }
      );
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || "Failed to generate suggestions");
        setSuggestOpen(false);
        return;
      }
      const rows = Array.isArray(json.data?.tasks) ? json.data.tasks : [];
      setSuggestions(rows);
      // Default all suggestions to picked — analysts can untick the ones
      // they don't want before clicking Add.
      setSuggestPicked(new Set(rows.map((_: unknown, i: number) => i)));
      setSuggestMeta({
        jurisdiction: json.data?.jurisdiction || "Unknown",
        spottedBonuses: Array.isArray(json.data?.spotted_bonuses)
          ? json.data.spotted_bonuses
          : [],
      });
    } catch (err) {
      console.error("Failed to fetch suggestions:", err);
      toast.error("Failed to generate suggestions");
      setSuggestOpen(false);
    } finally {
      setSuggesting(false);
    }
  };

  /** Apply the picked AI suggestions as child tasks. */
  const handleApplySuggestions = async () => {
    if (!suggestTarget) return;
    const picked = suggestions.filter((_, i) => suggestPicked.has(i));
    if (picked.length === 0) {
      toast.error("Pick at least one suggestion");
      return;
    }
    const baseSort = phases
      .filter((p) => p.parent_phase_id === suggestTarget)
      .reduce((max, p) => Math.max(max, p.sort_order), 0);
    let created = 0;
    for (let i = 0; i < picked.length; i++) {
      const t = picked[i];
      const res = await fetch(`/api/deals/${dealId}/dev-schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: t.label,
          duration_days: t.duration_days,
          parent_phase_id: suggestTarget,
          task_category: t.category,
          sort_order: baseSort + i + 1,
          notes: t.rationale,
        }),
      });
      if (res.ok) created++;
    }
    toast.success(`Added ${created} AI-suggested task${created === 1 ? "" : "s"}`);
    setSuggestOpen(false);
    setSuggestTarget(null);
    loadAll();
  };

  /**
   * Download the schedule as Excel, CSV, or ICS. `scope` chooses between the
   * current page's track (matching what the analyst is looking at) and
   * the full deal across all three tracks. Defaults to current track so
   * a "Export schedule" click on the Acquisition page exports
   * acquisition rows only.
   */
  const handleExportSchedule = (
    format: "csv" | "ics" | "xls" | "pdf",
    scope: "track" | "all" = "track",
    pdfView: "executive" | "gantt" | "detail" = "executive"
  ) => {
    // Browser navigates to the export route with the proper Content-
    // Disposition header — simplest cross-client path to "download file".
    const trackQs = scope === "track" && track !== "all" ? `?track=${track}` : "";
    if (format === "pdf") {
      const sep = trackQs ? "&" : "?";
      window.open(
        `/api/deals/${dealId}/dev-schedule/pdf${trackQs}${sep}view=${pdfView}`,
        "_blank"
      );
      return;
    }
    const trackParam = trackQs ? `&${trackQs.slice(1)}` : "";
    const url = `/api/deals/${dealId}/dev-schedule/export?format=${format}${trackParam}`;
    window.open(url, "_blank");
  };

  /**
   * Swap a child task's sort_order with its immediate sibling in the
   * given direction. Siblings = other children of the same parent,
   * ordered by their stored sort_order. PATCHes both rows.
   */
  /**
   * Drag-end handler for a DnD context over one parent's children.
   * Computes the new order, PATCHes `sort_order` for every child that
   * moved, and refreshes. `parentPhaseId` tells us which child list
   * this drag applies to so children of other phases don't shuffle.
   */
  const handleDragReorder = async (evt: DragEndEvent, parentPhaseId: string) => {
    const { active, over } = evt;
    if (!over || active.id === over.id) return;
    const siblings = phases
      .filter((p) => p.parent_phase_id === parentPhaseId)
      .sort((a, b) => a.sort_order - b.sort_order);
    const oldIdx = siblings.findIndex((p) => p.id === active.id);
    const newIdx = siblings.findIndex((p) => p.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const reordered = arrayMove(siblings, oldIdx, newIdx);
    // Only PATCH the rows whose sort_order actually changes.
    const updates: Array<{ id: string; sort_order: number }> = [];
    reordered.forEach((p, i) => {
      if (p.sort_order !== i) updates.push({ id: p.id, sort_order: i });
    });
    if (updates.length === 0) return;
    // Drop intent overrides any active column sort — manual order is
    // what the user just expressed by dragging.
    if (sortBy !== null) {
      setSortBy(null);
      setSortDir("asc");
    }
    setReorderingIds((s) => {
      const next = new Set(s);
      for (const u of updates) next.add(u.id);
      return next;
    });
    try {
      await Promise.all(
        updates.map((u) =>
          fetch(`/api/deals/${dealId}/dev-schedule/${u.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sort_order: u.sort_order }),
          })
        )
      );
      loadAll();
    } catch (err) {
      console.error("Failed to reorder (drag):", err);
      toast.error("Failed to reorder");
    } finally {
      setReorderingIds(new Set());
    }
  };

  const handleReorderChild = async (phase: DevPhase, direction: "up" | "down") => {
    if (!phase.parent_phase_id) return;
    const siblings = phases
      .filter((p) => p.parent_phase_id === phase.parent_phase_id)
      .sort((a, b) => a.sort_order - b.sort_order);
    const idx = siblings.findIndex((p) => p.id === phase.id);
    if (idx < 0) return;
    const swapWith =
      direction === "up" ? siblings[idx - 1] : siblings[idx + 1];
    if (!swapWith) return; // already at edge
    // Same as drag: manual reorder clears any active column sort.
    if (sortBy !== null) {
      setSortBy(null);
      setSortDir("asc");
    }
    setReorderingIds((s) => {
      const next = new Set(s);
      next.add(phase.id);
      next.add(swapWith.id);
      return next;
    });
    try {
      // Swap sort_order values. The API ignores unsupported fields, and
      // both rows survive a PATCH in parallel.
      await Promise.all([
        fetch(`/api/deals/${dealId}/dev-schedule/${phase.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sort_order: swapWith.sort_order }),
        }),
        fetch(`/api/deals/${dealId}/dev-schedule/${swapWith.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sort_order: phase.sort_order }),
        }),
      ]);
      loadAll();
    } catch (err) {
      console.error("Failed to reorder:", err);
      toast.error("Failed to reorder");
    } finally {
      setReorderingIds(new Set());
    }
  };

  // ── Cost CRUD ──
  const resetCostForm = () => {
    setCostForm({
      category: PREDEV_CATEGORIES[0] as string,
      description: "",
      vendor: "",
      amount: 0,
      status: "estimated",
      incurred_date: "",
      notes: "",
    });
  };

  const openCreateCost = () => {
    setEditingCost(null);
    resetCostForm();
    setCostDialogOpen(true);
  };

  const openEditCost = (c: PreDevCost) => {
    setEditingCost(c);
    setCostForm({
      category: c.category,
      description: c.description,
      vendor: c.vendor || "",
      amount: Number(c.amount),
      status: c.status,
      incurred_date: c.incurred_date || "",
      notes: c.notes || "",
    });
    setCostDialogOpen(true);
  };

  const handleSaveCost = async () => {
    if (!costForm.description.trim()) return;
    try {
      if (editingCost) {
        await fetch(`/api/deals/${dealId}/predev-costs/${editingCost.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(costForm),
        });
      } else {
        await fetch(`/api/deals/${dealId}/predev-costs`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(costForm),
        });
      }
      setCostDialogOpen(false);
      setEditingCost(null);
      resetCostForm();
      loadAll();
    } catch (err) {
      console.error("Failed to save cost:", err);
    }
  };

  const handleDeleteCost = async (id: string) => {
    try {
      await fetch(`/api/deals/${dealId}/predev-costs/${id}`, { method: "DELETE" });
      loadAll();
    } catch (err) {
      console.error("Failed to delete cost:", err);
    }
  };

  // ── Settings ──
  const openSettings = () => {
    setSettingsForm(settings);
    setSettingsDialogOpen(true);
  };

  const handleSaveSettings = async () => {
    try {
      await fetch(`/api/deals/${dealId}/predev-settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settingsForm),
      });
      setSettings(settingsForm);
      setSettingsDialogOpen(false);
    } catch (err) {
      console.error("Failed to save settings:", err);
    }
  };

  // ── Calculations ──
  const totalCommittedOrSpent = costs
    .filter((c) => c.status === "committed" || c.status === "incurred" || c.status === "paid")
    .reduce((sum, c) => sum + Number(c.amount), 0);
  const totalEstimated = costs.reduce((sum, c) => sum + Number(c.amount), 0);
  const totalPaid = costs
    .filter((c) => c.status === "paid")
    .reduce((sum, c) => sum + Number(c.amount), 0);

  // Group costs by category
  const costsByCategory = costs.reduce<Record<string, PreDevCost[]>>((acc, c) => {
    if (!acc[c.category]) acc[c.category] = [];
    acc[c.category].push(c);
    return acc;
  }, {});

  // Approval threshold logic
  const sortedThresholds = [...settings.thresholds].sort((a, b) => a.amount - b.amount);
  const nextThreshold = sortedThresholds.find((t) => t.amount > totalCommittedOrSpent);
  const passedThresholds = sortedThresholds.filter((t) => t.amount <= totalCommittedOrSpent);
  const headroomToNext = nextThreshold ? nextThreshold.amount - totalCommittedOrSpent : 0;

  // ── Timeline calculations ──
  const allDates = phases
    .flatMap((p) => [p.start_date, p.end_date])
    .filter((d): d is string => !!d)
    .sort();
  const minDate = allDates[0];
  const maxDate = allDates[allDates.length - 1];
  const timelineRangeMs = minDate && maxDate
    ? new Date(maxDate).getTime() - new Date(minDate).getTime()
    : 0;

  const getBarStyle = (start: string | null, end: string | null) => {
    if (!start || !end || !minDate || timelineRangeMs === 0) return { left: "0%", width: "0%" };
    const startMs = new Date(start).getTime();
    const endMs = new Date(end).getTime();
    const baseMs = new Date(minDate).getTime();
    const left = ((startMs - baseMs) / timelineRangeMs) * 100;
    const width = ((endMs - startMs) / timelineRangeMs) * 100;
    return { left: `${left}%`, width: `${Math.max(width, 1)}%` };
  };

  // ── Today marker position ──
  const todayMs = Date.now();
  const todayPct = minDate && maxDate && timelineRangeMs > 0
    ? ((todayMs - new Date(minDate).getTime()) / timelineRangeMs) * 100
    : null;

  // ── Timeline pixel width + tick generation ──────────────────────────
  // The bar column is now a fixed pixel width (days * pxPerDay) so the
  // whole grid scrolls horizontally inside an overflow wrapper. Ticks
  // are computed from the same min/max date range so the header lines
  // up with the bars below.
  const MS_PER_DAY = 86_400_000;
  const daysInRange =
    minDate && maxDate
      ? Math.max(1, Math.round(timelineRangeMs / MS_PER_DAY) + 1)
      : 0;
  const timelinePixelWidth = Math.max(360, Math.round(daysInRange * pxPerDay));

  // Tick granularity follows the zoom level: tight zoom shows weeks,
  // mid shows months, wide shows quarters.
  type TimelineTick = { left: number; label: string; major: boolean };
  const buildTicks = (): TimelineTick[] => {
    if (!minDate || !maxDate) return [];
    const base = new Date(minDate + "T00:00:00").getTime();
    const end = new Date(maxDate + "T00:00:00").getTime();
    const ticks: TimelineTick[] = [];
    const pxAt = (ms: number) => ((ms - base) / MS_PER_DAY) * pxPerDay;

    if (pxPerDay >= 18) {
      // Week ticks; label every 2 weeks; major on month boundaries.
      let cursor = new Date(base);
      cursor.setUTCDate(cursor.getUTCDate() - cursor.getUTCDay());
      let i = 0;
      while (cursor.getTime() <= end) {
        const isMonthStart = cursor.getUTCDate() <= 7;
        ticks.push({
          left: pxAt(cursor.getTime()),
          label: isMonthStart
            ? cursor.toLocaleDateString("en-US", { month: "short", year: "2-digit" })
            : i % 2 === 0
              ? cursor.toLocaleDateString("en-US", { month: "short", day: "numeric" })
              : "",
          major: isMonthStart,
        });
        cursor = new Date(cursor.getTime() + 7 * MS_PER_DAY);
        i += 1;
      }
    } else if (pxPerDay >= 4) {
      // Month ticks; label every month; major on quarter boundaries.
      const cursor = new Date(base);
      cursor.setUTCDate(1);
      while (cursor.getTime() <= end + MS_PER_DAY) {
        const isQuarter = cursor.getUTCMonth() % 3 === 0;
        ticks.push({
          left: pxAt(cursor.getTime()),
          label: cursor.toLocaleDateString("en-US", {
            month: "short",
            year: isQuarter ? "numeric" : undefined,
          }),
          major: isQuarter,
        });
        cursor.setUTCMonth(cursor.getUTCMonth() + 1);
      }
    } else {
      // Quarter ticks; label every quarter with year.
      const cursor = new Date(base);
      cursor.setUTCDate(1);
      cursor.setUTCMonth(Math.floor(cursor.getUTCMonth() / 3) * 3);
      while (cursor.getTime() <= end + MS_PER_DAY) {
        const q = Math.floor(cursor.getUTCMonth() / 3) + 1;
        ticks.push({
          left: pxAt(cursor.getTime()),
          label: `Q${q} ${cursor.getUTCFullYear()}`,
          major: true,
        });
        cursor.setUTCMonth(cursor.getUTCMonth() + 3);
      }
    }
    return ticks.filter((t) => t.left >= -1 && t.left <= timelinePixelWidth + 1);
  };
  const timelineTicks = buildTicks();
  const showToday = todayPct !== null && todayPct >= 0 && todayPct <= 100;

  // Critical-path detection used to live here as a local longest-chain
  // heuristic. The math was a recurring source of drift (it computed
  // its own answer rather than reading is_critical from the DB) and
  // the visual treatment — a small red triangle — wasn't earning its
  // keep on a feasibility-stage gantt. Stripped along with the
  // backward-pass CPM in the dev-schedule-compute simplification;
  // see #143 follow-up. Empty set keeps existing render paths
  // happy while we phase out callers.
  const criticalPhaseIds = new Set<string>();
  const phaseById = new Map(phases.map((p) => [p.id, p]));

  const isDelayed = (p: DevPhase) => {
    if (p.status === "delayed") return true;
    if (p.end_date && p.status !== "complete" && new Date(p.end_date).getTime() < todayMs) return true;
    return false;
  };

  // Total budget across visible phases — sum of every phase's own
  // `budget`, scoped to the workstream filter when one is active. Roots
  // and children both contribute since either can carry a budget. Hidden
  // (zero / null) when no phase has a budget set so fresh schedules
  // stay quiet.
  const totalScheduleBudget = (() => {
    const workstreamSet = effectiveWorkstreams
      ? new Set(effectiveWorkstreams)
      : null;
    // Roots in scope (after workstream filter).
    const visibleRootIds = new Set(
      phases
        .filter((p) => !p.parent_phase_id)
        .filter(
          (p) =>
            !workstreamSet || workstreamSet.has(workstreamForPhase(p.phase_key))
        )
        .map((p) => p.id)
    );
    let sum = 0;
    for (const p of phases) {
      const inScope = p.parent_phase_id
        ? visibleRootIds.has(p.parent_phase_id)
        : visibleRootIds.has(p.id);
      if (!inScope) continue;
      if (p.budget != null) sum += Number(p.budget);
    }
    return sum;
  })();

  // Build the CSS grid template from the current column-visibility
  // state. Header row + every gantt row use the same template so cells
  // line up perfectly; the bar always takes the largest fraction. Hidden
  // columns omit their entry entirely so the bar gets that width back.
  const gridTemplate = (() => {
    const cols: string[] = [`${columnWidths.name}px`]; // name (always)
    cols.push(`${columnWidths.duration}px`); // duration (always)
    if (columns.predecessor) cols.push(`${columnWidths.predecessor}px`);
    if (columns.start) cols.push(`${columnWidths.start}px`);
    if (columns.finish) cols.push(`${columnWidths.finish}px`);
    if (columns.budget) cols.push(`${columnWidths.budget}px`);
    if (columns.owner) cols.push(`${columnWidths.owner}px`);
    cols.push(`${timelinePixelWidth}px`); // bar — fixed pixel width drives scroll
    cols.push(`${columnWidths.actions}px`); // status + actions (always)
    return cols.join(" ");
  })();
  const visibleGridColumnCount =
    4 +
    Number(columns.predecessor) +
    Number(columns.start) +
    Number(columns.finish) +
    Number(columns.budget) +
    Number(columns.owner);
  const gridMinWidth =
    columnWidths.name +
    columnWidths.duration +
    (columns.predecessor ? columnWidths.predecessor : 0) +
    (columns.start ? columnWidths.start : 0) +
    (columns.finish ? columnWidths.finish : 0) +
    (columns.budget ? columnWidths.budget : 0) +
    (columns.owner ? columnWidths.owner : 0) +
    timelinePixelWidth +
    columnWidths.actions +
    (visibleGridColumnCount - 1) * 8;

  const scheduleAssistantPrompts = [
    {
      label: "Ask prep questions",
      prompt: `Ask me the key prep questions you need before changing the ${scheduleScopeLabel(track)} schedule. Focus on target dates, approvals, owners, missing documents, and handoff risks.`,
    },
    {
      label: "Find missing tasks",
      prompt: `Review this ${scheduleScopeLabel(track)} schedule and the Development Playbook. What important tasks, decisions, or owner follow-ups appear to be missing? Keep it concise before creating anything.`,
    },
    {
      label: "Create task plan",
      prompt: `Help me choose which phase should become a focused task plan. Ask any needed prep questions, then suggest the child tasks and owners before creating them.`,
    },
  ];

  // Sort comparator. Null values sort to the bottom regardless of
  // direction so empties don't pollute the top of the list.
  const compare = (a: DevPhase, b: DevPhase): number => {
    if (sortBy === null) return a.sort_order - b.sort_order;
    const dir = sortDir === "asc" ? 1 : -1;
    const nullLast = (av: unknown, bv: unknown): number | null => {
      const an = av == null || av === "";
      const bn = bv == null || bv === "";
      if (an && bn) return 0;
      if (an) return 1;
      if (bn) return -1;
      return null;
    };
    if (sortBy === "name") {
      return a.label.localeCompare(b.label) * dir;
    }
    if (sortBy === "duration") {
      const av = a.duration_days ?? 0;
      const bv = b.duration_days ?? 0;
      return (av - bv) * dir;
    }
    if (sortBy === "start") {
      const av = a.start_date ?? null;
      const bv = b.start_date ?? null;
      const ord = nullLast(av, bv);
      if (ord !== null) return ord;
      return (av! < bv! ? -1 : av! > bv! ? 1 : 0) * dir;
    }
    if (sortBy === "finish") {
      const av = a.end_date ?? null;
      const bv = b.end_date ?? null;
      const ord = nullLast(av, bv);
      if (ord !== null) return ord;
      return (av! < bv! ? -1 : av! > bv! ? 1 : 0) * dir;
    }
    if (sortBy === "budget") {
      const av = a.budget != null ? Number(a.budget) : null;
      const bv = b.budget != null ? Number(b.budget) : null;
      const ord = nullLast(av, bv);
      if (ord !== null) return ord;
      return (av! - bv!) * dir;
    }
    if (sortBy === "predecessor") {
      const al = a.predecessor_id
        ? phases.find((x) => x.id === a.predecessor_id)?.label ?? ""
        : "";
      const bl = b.predecessor_id
        ? phases.find((x) => x.id === b.predecessor_id)?.label ?? ""
        : "";
      const ord = nullLast(al || null, bl || null);
      if (ord !== null) return ord;
      return al.localeCompare(bl) * dir;
    }
    return 0;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-pulse text-muted-foreground text-sm">Loading development schedule...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Development Schedule (Phases) ── */}
      {!hideSchedule && (
      <section className="border border-border/50 rounded-lg bg-card/50">
        <button
          onClick={() => setScheduleExpanded(!scheduleExpanded)}
          className="flex items-center gap-2 w-full px-4 py-3 text-left hover:bg-muted/30 transition-colors rounded-t-lg"
        >
          {scheduleExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          <GanttChart className="h-4 w-4 text-primary" />
          <span className="font-medium text-sm">{scheduleScopeLabel(track)} Schedule</span>
          <Badge variant="secondary" className="ml-auto text-2xs">
            {phases.filter((p) => p.status === "complete").length}/{phases.length} phases
          </Badge>
        </button>

        {scheduleExpanded && (
          <div className="px-4 pb-4 space-y-3 overflow-x-auto">
            {/* Bulk action bar — only renders when something is
                selected. Sits at the top of the schedule body so it's
                visible regardless of how far the user has scrolled
                down the row list. */}
            {selectedIds.size > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 rounded-md border border-primary/30 bg-primary/[0.06]">
                <span className="text-xs tabular-nums">
                  <span className="font-medium text-foreground">{selectedRows.length}</span>{" "}
                  <span className="text-muted-foreground">
                    {selectedRows.length === 1 ? "row" : "rows"} selected
                  </span>
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleBulkStatus("in_progress")}
                    disabled={bulkUpdating || bulkDeleting}
                    className="h-7 gap-1.5 text-xs"
                  >
                    <TrendingUp className="h-3 w-3" />
                    In Progress
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleBulkStatus("complete")}
                    disabled={bulkUpdating || bulkDeleting}
                    className="h-7 gap-1.5 text-xs"
                  >
                    <Check className="h-3 w-3" />
                    Complete
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleBulkOwner}
                    disabled={bulkUpdating || bulkDeleting}
                    className="h-7 text-xs"
                  >
                    Set owner
                  </Button>
                  {isMasterTrack && (
                    <select
                      value=""
                      disabled={bulkUpdating || bulkDeleting}
                      onChange={(event) => {
                        const nextTrack = event.target.value as ScheduleTrack;
                        event.target.value = "";
                        if (nextTrack) handleBulkTrack(nextTrack);
                      }}
                      className="h-7 rounded-md border border-input bg-background px-2 text-xs outline-none hover:border-primary/40 disabled:opacity-50"
                    >
                      <option value="">Move track...</option>
                      <option value="acquisition">Acquisition</option>
                      <option value="development">Development</option>
                      <option value="construction">Construction</option>
                    </select>
                  )}
                  <button
                    onClick={clearSelection}
                    disabled={bulkDeleting || bulkUpdating}
                    className="text-xs text-muted-foreground/80 hover:text-foreground transition-colors disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={handleBulkDelete}
                    disabled={bulkDeleting || bulkUpdating}
                    className="gap-1.5 h-7"
                  >
                    {bulkDeleting ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Trash2 className="h-3 w-3" />
                    )}
                    Delete {selectedRows.length}
                  </Button>
                </div>
              </div>
            )}
            <div className="flex gap-2 items-center">
              <Button size="sm" variant="outline" className="text-xs" onClick={openCreatePhase}>
                <Plus className="h-3 w-3 mr-1" /> Add Phase
              </Button>
              <Button size="sm" variant="outline" className="text-xs" onClick={() => setPasteOpen(true)}>
                <ClipboardPaste className="h-3 w-3 mr-1" /> Paste rows
              </Button>
              {phases.length > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-xs"
                  onClick={selectedRows.length === phases.length ? clearSelection : selectAllRows}
                >
                  {selectedRows.length === phases.length ? "Clear selection" : "Select all"}
                </Button>
              )}
              {/* Always available — the wizard dedupes by phase_key,
                  so a user who seeded "Purchase" only can come back
                  later and layer in "Diligence" or "IC" without
                  creating duplicate rows. */}
              <Button
                size="sm"
                variant="outline"
                className="text-xs"
                onClick={() => setWizardOpen(true)}
              >
                <Calendar className="h-3 w-3 mr-1" />
                {phases.length === 0 ? "Seed Schedule" : "Seed bundles"}
              </Button>
              <ScheduleColumnsMenu visibility={columns} onChange={setColumns} />
              <button
                type="button"
                onClick={() => setColumnWidths(DEFAULT_SCHEDULE_COLUMN_WIDTHS)}
                className="h-8 rounded-md border border-border/60 px-2 text-xs text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
                title="Reset schedule column widths"
              >
                Reset widths
              </button>
              {phases.length > 0 && (
                <div className="inline-flex items-center gap-1">
                  <Download className="h-3 w-3 text-muted-foreground" />
                  <select
                    value=""
                    onChange={(e) => {
                      const v = e.target.value;
                      e.target.value = "";
                      if (v === "xls") handleExportSchedule("xls", "track");
                      else if (v === "pdf-exec") handleExportSchedule("pdf", "track", "executive");
                      else if (v === "pdf-gantt") handleExportSchedule("pdf", "track", "gantt");
                      else if (v === "pdf-detail") handleExportSchedule("pdf", "track", "detail");
                      else if (v === "csv") handleExportSchedule("csv", "track");
                      else if (v === "ics") handleExportSchedule("ics", "track");
                      else if (v === "xls-all") handleExportSchedule("xls", "all");
                      else if (v === "pdf-exec-all") handleExportSchedule("pdf", "all", "executive");
                      else if (v === "pdf-gantt-all") handleExportSchedule("pdf", "all", "gantt");
                      else if (v === "csv-all") handleExportSchedule("csv", "all");
                      else if (v === "ics-all") handleExportSchedule("ics", "all");
                    }}
                    className="text-xs h-8 bg-background border border-input rounded-md px-2 py-1 outline-none hover:border-primary/40"
                    title="Download the schedule for spreadsheets / calendars"
                  >
                    <option value="">Export…</option>
                    <optgroup label={isMasterTrack ? "Master schedule" : `This track (${scheduleScopeLabel(track)})`}>
                      <option value="pdf-exec">PDF — Executive view</option>
                      <option value="pdf-gantt">PDF — Gantt view</option>
                      <option value="pdf-detail">PDF — Detail view</option>
                      <option value="xls">Excel schedule packet</option>
                      <option value="csv">CSV data</option>
                      <option value="ics">ICS (Calendar)</option>
                    </optgroup>
                    <optgroup label="All tracks">
                      <option value="pdf-exec-all">PDF Executive — all tracks</option>
                      <option value="pdf-gantt-all">PDF Gantt — all tracks</option>
                      <option value="xls-all">Excel packet - all tracks</option>
                      <option value="csv-all">CSV — all tracks</option>
                      <option value="ics-all">ICS — all tracks</option>
                    </optgroup>
                  </select>
                </div>
              )}
              {sortBy !== null && (
                <button
                  onClick={() => {
                    setSortBy(null);
                    setSortDir("asc");
                  }}
                  className="text-2xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-muted/40"
                  title="Clear sort and return to manual order"
                >
                  <ArrowUpDown className="h-3 w-3" /> Sorted by {sortBy} · clear
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/50 bg-background/45 px-3 py-2">
              <span className="flex items-center gap-1.5 text-2xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                <MessageSquare className="h-3 w-3" />
                Assistant
              </span>
              {scheduleAssistantPrompts.map((starter) => (
                <a
                  key={starter.label}
                  href={`/deals/${dealId}/chat?prompt=${encodeURIComponent(starter.prompt)}`}
                  className="rounded-md border border-border/60 bg-card px-2.5 py-1 text-2xs text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground"
                >
                  {starter.label}
                </a>
              ))}
            </div>

            {phases.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">
                No phases yet. Click &quot;Seed Default Phases&quot; to start with a typical CRE timeline.
              </p>
            ) : (
              <>
              {/* Timeline zoom toolbar */}
              <div className="mb-2 flex items-center gap-2 text-2xs text-muted-foreground">
                <span className="font-semibold uppercase tracking-[0.14em]">Zoom</span>
                {[
                  { px: 28, label: "Week" },
                  { px: 12, label: "Month" },
                  { px: 4, label: "Quarter" },
                  { px: 1.5, label: "Year" },
                ].map((z) => {
                  const active = Math.abs(pxPerDay - z.px) < 0.5;
                  return (
                    <button
                      key={z.label}
                      type="button"
                      onClick={() => setPxPerDay(z.px)}
                      className={cn(
                        "rounded-full border px-2.5 py-0.5 transition-colors",
                        active
                          ? "border-primary/45 bg-primary/10 text-primary"
                          : "border-border/60 bg-background/50 hover:border-primary/30 hover:text-foreground"
                      )}
                    >
                      {z.label}
                    </button>
                  );
                })}
                <span className="ml-auto tabular-nums">
                  {minDate && maxDate
                    ? `${new Date(minDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} → ${new Date(maxDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} · ${daysInRange}d`
                    : ""}
                </span>
              </div>

              {/* Schedule scroll container — horizontal scroll on the
                  entire grid (left meta columns + timeline). Bars stay
                  percent-positioned within the timeline cell so they
                  scale with the pxPerDay zoom. */}
              <div className="overflow-x-auto overflow-y-visible">
              <div className="space-y-3" style={{ minWidth: gridMinWidth }}>
                {/* Timeline ruled header — month/week/quarter ticks
                    rendered absolutely above the bar column, aligned by
                    the same gridTemplateColumns as the row grid. */}
                {minDate && maxDate && (
                  <div
                    className="grid items-stretch border-b border-border/40 pb-1"
                    style={{ gridTemplateColumns: gridTemplate, gap: 8 }}
                  >
                    {/* Empty cells matching the left meta columns. */}
                    {Array.from({ length: visibleGridColumnCount - 1 }).map((_, i) => (
                      <div key={`hdr-spacer-${i}`} />
                    ))}
                    {/* Tick canvas for the bar column. */}
                    <div
                      className="relative h-7"
                      style={{ width: timelinePixelWidth }}
                    >
                      {/* Today marker label (renders only if in range). */}
                      {showToday && todayPct !== null && todayPct >= 0 && todayPct <= 100 && (
                        <div
                          className="absolute -top-0.5 z-10 -translate-x-1/2 rounded-sm bg-red-500/90 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white shadow"
                          style={{ left: `${todayPct}%` }}
                        >
                          Today
                        </div>
                      )}
                      {timelineTicks.map((t, i) => (
                        <div
                          key={`tick-${i}`}
                          className={cn(
                            "absolute bottom-0 flex flex-col items-start text-[10px]",
                            t.major ? "text-foreground/85 font-medium" : "text-muted-foreground/70"
                          )}
                          style={{ left: t.left }}
                        >
                          <span
                            className={cn(
                              "block w-px",
                              t.major ? "h-3 bg-border" : "h-2 bg-border/50"
                            )}
                          />
                          {t.label && (
                            <span className="mt-0.5 whitespace-nowrap px-1">{t.label}</span>
                          )}
                        </div>
                      ))}
                    </div>
                    {/* Empty cell matching actions column. */}
                    <div />
                  </div>
                )}

                {/* Legend */}
                {criticalPhaseIds.size > 0 && (
                  <div className="flex items-center gap-4 text-2xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-red-500/60" />
                      Critical path
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-amber-500/60" />
                      Delayed
                    </span>
                  </div>
                )}

                {/* Sortable column header. Mirrors the row's grid
                    template so cells line up. Each header is a button
                    that cycles asc → desc → off. Drag-reorder + up/down
                    arrows always clear sort and fall back to manual
                    sort_order. */}
                <div
                  className="grid gap-2 items-center pb-1 border-b border-border/40 text-2xs uppercase tracking-wide text-muted-foreground/80"
                  style={{ gridTemplateColumns: gridTemplate }}
                >
                  <ResizableHeaderCell onResizeStart={(event) => beginColumnResize("name", event)}>
                    <SortHeader
                      label="Task name"
                      active={sortBy === "name"}
                      direction={sortDir}
                      onClick={() => cycleSort("name")}
                      align="start"
                    />
                  </ResizableHeaderCell>
                  <ResizableHeaderCell onResizeStart={(event) => beginColumnResize("duration", event)}>
                    <SortHeader
                      label="Dur."
                      active={sortBy === "duration"}
                      direction={sortDir}
                      onClick={() => cycleSort("duration")}
                      align="start"
                    />
                  </ResizableHeaderCell>
                  {columns.predecessor && (
                    <ResizableHeaderCell onResizeStart={(event) => beginColumnResize("predecessor", event)}>
                      <SortHeader
                        label="Predecessor"
                        active={sortBy === "predecessor"}
                        direction={sortDir}
                        onClick={() => cycleSort("predecessor")}
                        align="start"
                      />
                    </ResizableHeaderCell>
                  )}
                  {columns.start && (
                    <ResizableHeaderCell onResizeStart={(event) => beginColumnResize("start", event)}>
                      <SortHeader
                        label="Start"
                        active={sortBy === "start"}
                        direction={sortDir}
                        onClick={() => cycleSort("start")}
                        align="start"
                      />
                    </ResizableHeaderCell>
                  )}
                  {columns.finish && (
                    <ResizableHeaderCell onResizeStart={(event) => beginColumnResize("finish", event)}>
                      <SortHeader
                        label="Finish"
                        active={sortBy === "finish"}
                        direction={sortDir}
                        onClick={() => cycleSort("finish")}
                        align="start"
                      />
                    </ResizableHeaderCell>
                  )}
                  {columns.budget && (
                    <ResizableHeaderCell onResizeStart={(event) => beginColumnResize("budget", event)}>
                      <SortHeader
                        label="Budget"
                        active={sortBy === "budget"}
                        direction={sortDir}
                        onClick={() => cycleSort("budget")}
                        align="start"
                      />
                    </ResizableHeaderCell>
                  )}
                  {columns.owner && (
                    <ResizableHeaderCell onResizeStart={(event) => beginColumnResize("owner", event)}>
                      <span className="text-2xs uppercase tracking-wide px-1">
                        Owner
                      </span>
                    </ResizableHeaderCell>
                  )}
                  <ResizableHeaderCell onResizeStart={(event) => beginColumnResize("bar", event)}>
                    <span className="text-2xs uppercase tracking-wide px-1">Timeline</span>
                  </ResizableHeaderCell>
                  <ResizableHeaderCell onResizeStart={(event) => beginColumnResize("actions", event)}>
                    <span className="block text-right pr-1">%</span>
                  </ResizableHeaderCell>
                </div>

                <div
                  className="grid gap-2 items-center rounded-md border border-dashed border-border/60 bg-background/45 px-2 py-2"
                  style={{ gridTemplateColumns: gridTemplate }}
                >
                  <div className="flex min-w-0 items-center gap-1">
                    {isMasterTrack && (
                      <select
                        value={quickAdd.track}
                        onChange={(event) =>
                          setQuickAdd((prev) => ({
                            ...prev,
                            track: event.target.value as ScheduleTrack,
                          }))
                        }
                        className="h-7 rounded border border-border/50 bg-background px-1.5 text-2xs outline-none focus:border-primary/50"
                        title="Track"
                      >
                        <option value="acquisition">Acq</option>
                        <option value="development">Dev</option>
                        <option value="construction">Con</option>
                      </select>
                    )}
                    <input
                      value={quickAdd.label}
                      onChange={(event) =>
                        setQuickAdd((prev) => ({ ...prev, label: event.target.value }))
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter") handleQuickAddPhase();
                      }}
                      placeholder={`Add ${scheduleScopeLabel(track).toLowerCase()} row`}
                      className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-1 text-xs outline-none transition-colors placeholder:text-muted-foreground/55 focus:border-primary/40 focus:bg-background"
                    />
                  </div>
                  <input
                    type="number"
                    min={1}
                    value={quickAdd.duration_days}
                    onChange={(event) =>
                      setQuickAdd((prev) => ({
                        ...prev,
                        duration_days: Number(event.target.value),
                      }))
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") handleQuickAddPhase();
                    }}
                    className="min-w-0 rounded border border-transparent bg-transparent px-1 py-1 text-2xs tabular-nums outline-none transition-colors focus:border-primary/40 focus:bg-background"
                    title="Duration in days"
                  />
                  {columns.predecessor && (
                    <span className="px-1 text-2xs text-muted-foreground/50">Anchor</span>
                  )}
                  {columns.start && (
                    <input
                      type="date"
                      value={quickAdd.start_date}
                      onChange={(event) =>
                        setQuickAdd((prev) => ({ ...prev, start_date: event.target.value }))
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter") handleQuickAddPhase();
                      }}
                      className="min-w-0 rounded border border-transparent bg-transparent px-1 py-1 text-2xs tabular-nums outline-none transition-colors focus:border-primary/40 focus:bg-background"
                      title="Optional anchor start date"
                    />
                  )}
                  {columns.finish && (
                    <span className="px-1 text-2xs text-muted-foreground/50">Computed</span>
                  )}
                  {columns.budget && (
                    <span className="px-1 text-2xs text-muted-foreground/50">—</span>
                  )}
                  {columns.owner && (
                    <input
                      value={quickAdd.task_owner}
                      onChange={(event) =>
                        setQuickAdd((prev) => ({ ...prev, task_owner: event.target.value }))
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter") handleQuickAddPhase();
                      }}
                      placeholder="Owner"
                      className="min-w-0 rounded border border-transparent bg-transparent px-1 py-1 text-2xs outline-none transition-colors placeholder:text-muted-foreground/45 focus:border-primary/40 focus:bg-background"
                    />
                  )}
                  <span className="px-1 text-2xs text-muted-foreground/50">
                    Type a row and press Enter
                  </span>
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 gap-1 px-2 text-2xs"
                      disabled={!quickAdd.label.trim() || quickAdding}
                      onClick={handleQuickAddPhase}
                    >
                      {quickAdding ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Plus className="h-3 w-3" />
                      )}
                      Add
                    </Button>
                  </div>
                </div>

                {/* Gantt rows — roots render at top level with any child
                    tasks (parent_phase_id set) nested below, indented. */}
                <div className="space-y-1.5">
                  {(() => {
                    // When a workstream filter is active, only render
                    // root phases whose phase_key maps into the allowed
                    // workstreams. Children ride along with their parent
                    // via childrenByParent so filtered children aren't
                    // orphaned off-screen. effectiveWorkstreams drops
                    // the filter on non-dev tracks automatically.
                    const workstreamSet = effectiveWorkstreams
                      ? new Set(effectiveWorkstreams)
                      : null;
                    const rootPhases = phases
                      .filter((p) => !p.parent_phase_id)
                      .filter(
                        (p) =>
                          !workstreamSet || workstreamSet.has(workstreamForPhase(p.phase_key))
                      )
                      .sort(compare);
                    const childrenByParent = new Map<string, DevPhase[]>();
                    for (const p of phases) {
                      if (!p.parent_phase_id) continue;
                      const list = childrenByParent.get(p.parent_phase_id) || [];
                      list.push(p);
                      childrenByParent.set(p.parent_phase_id, list);
                    }

                    const renderRow = (
                      p: DevPhase,
                      isChild: boolean,
                      childIdx = 0,
                      childCount = 0,
                      dragHandleProps?: {
                        setActivatorNodeRef: (el: HTMLElement | null) => void;
                        listeners: Record<string, unknown> | undefined;
                        attributes: Record<string, unknown>;
                      },
                      wbs = ""
                    ) => {
                      const cfg = DEV_PHASE_STATUS_CONFIG[p.status];
                      const barStyle = getBarStyle(p.start_date, p.end_date);
                      const predLabel = p.predecessor_id
                        ? phases.find((x) => x.id === p.predecessor_id)?.label
                        : null;
                      const isCritical = criticalPhaseIds.has(p.id);
                      const delayed = isDelayed(p);
                      const catCfg = p.task_category
                        ? TASK_CATEGORY_CONFIG[p.task_category]
                        : null;
                      const isReordering = reorderingIds.has(p.id);
                      // Variance suffix shown beside the Finish date for
                      // completed children — small green / red delta vs.
                      // planned duration. Pulled out so it can render in
                      // the Finish cell without bloating the row.
                      const varianceSuffix = (() => {
                        if (
                          !isChild ||
                          p.status !== "complete" ||
                          !p.start_date ||
                          !p.end_date ||
                          p.duration_days == null
                        )
                          return null;
                        const s = new Date(p.start_date);
                        const e = new Date(p.end_date);
                        const actual = Math.max(
                          0,
                          Math.round((e.getTime() - s.getTime()) / 86400000)
                        );
                        const delta = actual - (p.duration_days || 0);
                        const color =
                          delta > 0
                            ? "text-red-400"
                            : delta < 0
                              ? "text-emerald-400"
                              : "text-muted-foreground/80";
                        return (
                          <span
                            className={cn("text-[10px] tabular-nums ml-1", color)}
                            title={`Planned ${p.duration_days}d · actual ${actual}d (${delta > 0 ? "+" : ""}${delta}d)`}
                          >
                            ({delta > 0 ? "+" : ""}
                            {delta}d)
                          </span>
                        );
                      })();
                      return (
                        <div key={p.id} className="group">
                          <div
                            className="grid gap-2 items-center"
                            style={{ gridTemplateColumns: gridTemplate }}
                          >
                            {/* Name cell — drag handle + indent + label.
                                The label text is still the full-edit
                                modal trigger; doc-link icon and category
                                badge ride along on this cell. */}
                            <div
                              className={cn(
                                "text-xs flex items-center gap-1 min-w-0 relative",
                                delayed && "text-red-400",
                                isChild && "pl-4 text-muted-foreground"
                              )}
                            >
                              {/* Selection checkbox — invisible until
                                  the row is hovered or anything in the
                                  schedule is already selected. Click
                                  doesn't navigate or open the edit
                                  modal; stopPropagation on the wrapper
                                  isn't needed because the surrounding
                                  area is non-interactive at this depth. */}
                              <input
                                type="checkbox"
                                checked={selectedIds.has(p.id)}
                                onChange={() => toggleRowSelect(p.id)}
                                aria-label={`Select ${p.label}`}
                                className={cn(
                                  "shrink-0 h-3 w-3 rounded border-border/60 cursor-pointer transition-opacity",
                                  selectedIds.size > 0 || selectedIds.has(p.id)
                                    ? "opacity-90"
                                    : "opacity-0 group-hover:opacity-70 hover:opacity-100",
                                )}
                              />
                              {dragHandleProps && (
                                <button
                                  ref={dragHandleProps.setActivatorNodeRef}
                                  {...dragHandleProps.attributes}
                                  {...(dragHandleProps.listeners as Record<string, unknown>)}
                                  className="absolute -left-3 opacity-0 group-hover:opacity-60 hover:opacity-100 text-muted-foreground cursor-grab active:cursor-grabbing transition-opacity"
                                  title="Drag to reorder"
                                  aria-label="Drag to reorder"
                                  type="button"
                                >
                                  <GripVertical className="h-3 w-3" />
                                </button>
                              )}
                              {isChild && (
                                <span className="text-muted-foreground/50">└</span>
                              )}
                              {isChild && catCfg && (
                                <span
                                  className={cn(
                                    "text-[9px] uppercase tracking-wide px-1 rounded border flex-shrink-0",
                                    catCfg.color,
                                    catCfg.bg,
                                    catCfg.border
                                  )}
                                  title={catCfg.label}
                                >
                                  {catCfg.label}
                                </span>
                              )}
                              {wbs && (
                                <span
                                  className="shrink-0 tabular-nums text-[10px] font-medium text-muted-foreground/80"
                                  title="Work breakdown number — derives from row order"
                                >
                                  {wbs}
                                </span>
                              )}
                              <InlineText
                                value={p.label}
                                allowEmpty={false}
                                onSave={(value) =>
                                  updatePhaseField(p.id, { label: value || p.label })
                                }
                                title="Click to edit row name"
                                className="text-left text-xs flex-1"
                              />
                              {!isChild && (
                                <a
                                  href={`/deals/${dealId}/schedule/focus/${p.id}`}
                                  className="inline-flex items-center gap-0.5 rounded border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-2xs text-primary/90 transition-colors hover:bg-primary/15 hover:text-primary"
                                  title="Open focused task plan"
                                  aria-label={`Open focused task plan for ${p.label}`}
                                >
                                  <ArrowUpRight className="h-2.5 w-2.5" />
                                </a>
                              )}
                              {Array.isArray(p.linked_document_ids) &&
                                p.linked_document_ids.length > 0 && (
                                  <button
                                    onClick={() => openEditPhase(p)}
                                    className="flex items-center gap-0.5 text-2xs text-primary/80 flex-shrink-0 hover:text-primary"
                                    title={`${p.linked_document_ids.length} linked document${p.linked_document_ids.length === 1 ? "" : "s"} — click to open`}
                                  >
                                    <Paperclip className="h-2.5 w-2.5" />
                                    {p.linked_document_ids.length}
                                  </button>
                                )}
                            </div>

                            {/* Duration cell */}
                            <div className="text-xs">
                              <InlineNumber
                                value={p.duration_days}
                                suffix="d"
                                onSave={(v) =>
                                  updatePhaseField(p.id, { duration_days: v })
                                }
                                title="Click to edit duration"
                              />
                            </div>

                            {/* Predecessor cell — root rows only. Children
                                inherit their parent's chain so the cell
                                renders empty for them. */}
                            {columns.predecessor && (
                              <div className="text-xs min-w-0 truncate">
                                {!isChild ? (
                                  <InlinePredecessor
                                    value={p.predecessor_id ?? null}
                                    ownTrack={p.track ?? null}
                                    options={phases.map((x) => ({
                                      id: x.id,
                                      label: x.label,
                                      track: x.track ?? null,
                                    }))}
                                    excludeIds={new Set([p.id])}
                                    onSave={(predId) =>
                                      updatePhaseField(p.id, {
                                        predecessor_id: predId,
                                      })
                                    }
                                  />
                                ) : (
                                  <span className="text-muted-foreground/40">
                                    —
                                  </span>
                                )}
                              </div>
                            )}

                            {/* Start cell — anchor rows are click-to-edit;
                                chained / child rows show computed start
                                as static text since editing it from here
                                would be confusing. */}
                            {columns.start && (
                              <div className="text-xs">
                                {!isChild && !p.predecessor_id ? (
                                  <InlineDate
                                    value={p.start_date ?? null}
                                    onSave={(d) =>
                                      updatePhaseField(p.id, { start_date: d })
                                    }
                                    title="Anchor start date"
                                    placeholder="set start"
                                  />
                                ) : (
                                  <span className="text-2xs text-muted-foreground tabular-nums">
                                    {p.start_date ?? "—"}
                                  </span>
                                )}
                              </div>
                            )}

                            {/* Finish cell — always computed (end_date) */}
                            {columns.finish && (
                              <div className="text-xs">
                                <span className="text-2xs text-muted-foreground tabular-nums">
                                  {p.end_date ?? "—"}
                                </span>
                                {varianceSuffix}
                              </div>
                            )}

                            {/* Budget cell */}
                            {columns.budget && (
                              <div className="text-xs">
                                <InlineCurrency
                                  value={p.budget != null ? Number(p.budget) : null}
                                  onSave={(v) =>
                                    updatePhaseField(p.id, { budget: v })
                                  }
                                  title="Click to edit budget"
                                />
                              </div>
                            )}

                            {/* Owner cell */}
                            {columns.owner && (
                              <div className="text-xs min-w-0 truncate">
                                <InlineText
                                  value={p.task_owner ?? null}
                                  onSave={(value) =>
                                    updatePhaseField(p.id, { task_owner: value })
                                  }
                                  title={p.task_owner ? `Owner: ${p.task_owner}` : "Click to set owner"}
                                  placeholder="—"
                                  className="max-w-full text-2xs text-muted-foreground"
                                />
                              </div>
                            )}

                            {/* Bar — taller and outlined for prominence,
                                tinted track behind it so empty time is
                                visible at high zoom. */}
                            <div
                              className={cn(
                                "relative rounded border",
                                isChild
                                  ? "h-4 bg-muted/15 border-border/30"
                                  : "h-7 bg-muted/20 border-border/40"
                              )}
                            >
                              {showToday && todayPct !== null && todayPct >= 0 && todayPct <= 100 && (
                                <div
                                  className="absolute top-0 h-full w-0.5 bg-red-500/80 z-10 shadow-[0_0_0_1px_rgba(239,68,68,0.25)]"
                                  style={{ left: `${todayPct}%` }}
                                />
                              )}
                              <div
                                className={cn(
                                  "absolute top-0 h-full rounded-sm border shadow-sm",
                                  delayed
                                    ? "bg-red-500/45 border-red-500/60"
                                    : isCritical
                                      ? "border-red-500/55 " + cfg.bg
                                      : isChild
                                        ? "bg-primary/45 border-primary/55"
                                        : cfg.bg + " border-foreground/15"
                                )}
                                style={barStyle}
                                title={`${p.label}: ${p.start_date || "?"} → ${p.end_date || "?"} (${p.pct_complete}%)${predLabel ? ` | After: ${predLabel}` : ""}${isCritical ? " [CRITICAL PATH]" : ""}${delayed ? " [DELAYED]" : ""}`}
                              >
                                {p.pct_complete > 0 && (
                                  <div
                                    className="absolute top-0 left-0 h-full rounded-sm bg-emerald-500/65"
                                    style={{ width: `${p.pct_complete}%` }}
                                  />
                                )}
                                {!isChild && (
                                  <div className="pointer-events-none absolute inset-y-0 left-1.5 right-1.5 flex items-center text-[10px] font-medium text-foreground/85 truncate">
                                    {p.is_milestone ? "◆ " : ""}
                                    {p.label}
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Status + actions */}
                            <div className="flex items-center justify-end gap-1">
                              {isChild && (
                                <>
                                  <button
                                    onClick={() => handleReorderChild(p, "up")}
                                    disabled={childIdx === 0 || isReordering}
                                    className={cn(
                                      "text-muted-foreground/50 hover:text-foreground transition-colors",
                                      (childIdx === 0 || isReordering) &&
                                        "opacity-30 cursor-not-allowed"
                                    )}
                                    title="Move up"
                                  >
                                    <ArrowUp className="h-3 w-3" />
                                  </button>
                                  <button
                                    onClick={() => handleReorderChild(p, "down")}
                                    disabled={
                                      childIdx >= childCount - 1 || isReordering
                                    }
                                    className={cn(
                                      "text-muted-foreground/50 hover:text-foreground transition-colors",
                                      (childIdx >= childCount - 1 || isReordering) &&
                                        "opacity-30 cursor-not-allowed"
                                    )}
                                    title="Move down"
                                  >
                                    <ArrowDown className="h-3 w-3" />
                                  </button>
                                </>
                              )}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const cycle: Record<
                                    DevPhase["status"],
                                    DevPhase["status"]
                                  > = {
                                    not_started: "in_progress",
                                    in_progress: "complete",
                                    complete: "not_started",
                                    delayed: "in_progress",
                                  };
                                  const next = cycle[p.status] ?? "in_progress";
                                  const nextPct =
                                    next === "complete"
                                      ? 100
                                      : next === "not_started"
                                        ? 0
                                        : p.pct_complete;
                                  updatePhaseField(p.id, {
                                    status: next,
                                    pct_complete: nextPct,
                                  });
                                }}
                                title={`Status: ${cfg.label}${delayed ? " (delayed)" : ""} · click to cycle`}
                              >
                                <Badge
                                  variant="secondary"
                                  className={cn(
                                    "text-2xs cursor-pointer hover:opacity-80 transition-opacity",
                                    delayed
                                      ? "text-red-400 bg-red-500/10"
                                      : cfg.color
                                  )}
                                >
                                  {p.pct_complete}%
                                </Badge>
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDetailPhaseId(p.id);
                                }}
                                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-all"
                                title="Open row details"
                                type="button"
                              >
                                <PanelRightOpen className="h-3 w-3" />
                              </button>
                              <button
                                onClick={() => handleDeletePhase(p.id)}
                                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400 transition-all"
                                type="button"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    };

                    const renderChildQuickAdd = (parent: DevPhase) => {
                      const draft = childQuickAdds[parent.id] || {
                        label: "",
                        duration_days: 7,
                        task_owner: "",
                      };
                      return (
                        <div
                          key={`${parent.id}-quick-child`}
                          className="grid gap-2 items-center rounded-md border border-dashed border-border/40 bg-background/25 px-2 py-1.5"
                          style={{ gridTemplateColumns: gridTemplate }}
                        >
                          <div className="flex min-w-0 items-center gap-1 pl-8">
                            <span className="text-muted-foreground/50">└</span>
                            <input
                              value={draft.label}
                              onChange={(event) =>
                                setChildQuickAdds((prev) => ({
                                  ...prev,
                                  [parent.id]: { ...draft, label: event.target.value },
                                }))
                              }
                              onKeyDown={(event) => {
                                if (event.key === "Enter") handleQuickAddChild(parent);
                              }}
                              placeholder={`Add task under ${parent.label}`}
                              className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-1 text-2xs outline-none transition-colors placeholder:text-muted-foreground/45 focus:border-primary/40 focus:bg-background"
                            />
                          </div>
                          <input
                            type="number"
                            min={1}
                            value={draft.duration_days}
                            onChange={(event) =>
                              setChildQuickAdds((prev) => ({
                                ...prev,
                                [parent.id]: {
                                  ...draft,
                                  duration_days: Number(event.target.value),
                                },
                              }))
                            }
                            onKeyDown={(event) => {
                              if (event.key === "Enter") handleQuickAddChild(parent);
                            }}
                            className="min-w-0 rounded border border-transparent bg-transparent px-1 py-1 text-2xs tabular-nums outline-none transition-colors focus:border-primary/40 focus:bg-background"
                          />
                          {columns.predecessor && <span />}
                          {columns.start && <span className="text-2xs text-muted-foreground/40">auto</span>}
                          {columns.finish && <span className="text-2xs text-muted-foreground/40">auto</span>}
                          {columns.budget && <span />}
                          {columns.owner && (
                            <input
                              value={draft.task_owner}
                              onChange={(event) =>
                                setChildQuickAdds((prev) => ({
                                  ...prev,
                                  [parent.id]: { ...draft, task_owner: event.target.value },
                                }))
                              }
                              onKeyDown={(event) => {
                                if (event.key === "Enter") handleQuickAddChild(parent);
                              }}
                              placeholder="Owner"
                              className="min-w-0 rounded border border-transparent bg-transparent px-1 py-1 text-2xs outline-none transition-colors placeholder:text-muted-foreground/45 focus:border-primary/40 focus:bg-background"
                            />
                          )}
                          <span className="text-2xs text-muted-foreground/40">Child task</span>
                          <div className="flex justify-end">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 gap-1 px-2 text-2xs"
                              disabled={!draft.label.trim()}
                              onClick={() => handleQuickAddChild(parent)}
                            >
                              <Plus className="h-2.5 w-2.5" />
                              Add
                            </Button>
                          </div>
                        </div>
                      );
                    };

                    const renderRoot = (p: DevPhase, rootIdx: number) => {
                      const rootWbs = String(rootIdx + 1);
                      const children = childrenByParent.get(p.id) || [];
                      const isEntitlement = p.phase_key === "entitlements";
                      // Children are stored by sort_order so up/down
                      // arrows can do stable pair-swaps.
                      // sort_order is the natural order; an active column
                      // sort overrides it so children re-sort along with
                      // root rows.
                      const sortedChildren = [...children].sort(
                        sortBy === null
                          ? (a, b) => a.sort_order - b.sort_order
                          : compare
                      );
                      // Rolled-up budget + planned/actual summaries — only
                      // render the summary strip when children exist so the
                      // parent row itself stays quiet on empty phases.
                      const childBudgetTotal = sortedChildren.reduce(
                        (s, c) => s + (c.budget != null ? Number(c.budget) : 0),
                        0
                      );
                      const plannedTotalDays = sortedChildren.reduce(
                        (s, c) => s + (c.duration_days || 0),
                        0
                      );
                      const completedChildren = sortedChildren.filter(
                        (c) => c.status === "complete" && c.start_date && c.end_date
                      );
                      const actualCompletedDays = completedChildren.reduce((s, c) => {
                        const start = new Date(c.start_date!);
                        const end = new Date(c.end_date!);
                        return s + Math.max(0, Math.round((end.getTime() - start.getTime()) / 86400000));
                      }, 0);
                      const plannedForCompletedChildren = completedChildren.reduce(
                        (s, c) => s + (c.duration_days || 0),
                        0
                      );
                      return (
                        <div key={p.id} className="space-y-1">
                          {renderRow(p, false, 0, 0, undefined, rootWbs)}
                          {sortedChildren.length > 0 && (
                            <DndContext
                              sensors={dndSensors}
                              collisionDetection={closestCenter}
                              onDragEnd={(e) => handleDragReorder(e, p.id)}
                            >
                              <SortableContext
                                items={sortedChildren.map((c) => c.id)}
                                strategy={verticalListSortingStrategy}
                              >
                                <div className="space-y-1">
                                  {sortedChildren.map((c, i) => (
                                    <SortableChild key={c.id} id={c.id}>
                                      {(drag) =>
                                        renderRow(
                                          c,
                                          true,
                                          i,
                                          sortedChildren.length,
                                          drag,
                                          `${rootWbs}.${i + 1}`
                                        )
                                      }
                                    </SortableChild>
                                  ))}
                                </div>
                              </SortableContext>
                            </DndContext>
                          )}
                          {openSubAddFor === p.id ? (
                            <div className="space-y-1">
                              {renderChildQuickAdd(p)}
                              <div className="pl-8">
                                <button
                                  type="button"
                                  onClick={() => setOpenSubAddFor(null)}
                                  className="text-[10px] text-muted-foreground/70 hover:text-foreground"
                                >
                                  Done
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setOpenSubAddFor(p.id)}
                              className="ml-8 inline-flex items-center gap-1 rounded-md border border-dashed border-border/40 bg-transparent px-2 py-0.5 text-[10px] text-muted-foreground/70 transition-colors hover:border-primary/35 hover:text-foreground"
                              title="Add a subtask under this phase. For richer mini-schedules tied to a diligence item, open the item drawer instead."
                            >
                              <Plus className="h-2.5 w-2.5" />
                              Add subtask
                            </button>
                          )}
                          {sortedChildren.length > 0 && (childBudgetTotal > 0 || plannedTotalDays > 0) && (
                            <div className="flex items-center gap-3 pl-6 text-2xs text-muted-foreground">
                              <span>
                                {sortedChildren.length} task
                                {sortedChildren.length === 1 ? "" : "s"}
                              </span>
                              {plannedTotalDays > 0 && (
                                <span className="tabular-nums">
                                  Planned: <span className="text-foreground font-medium">{plannedTotalDays}d</span>
                                </span>
                              )}
                              {completedChildren.length > 0 && (() => {
                                const delta = actualCompletedDays - plannedForCompletedChildren;
                                const color = delta > 0 ? "text-red-400" : delta < 0 ? "text-emerald-400" : "text-muted-foreground";
                                return (
                                  <span
                                    className={cn("tabular-nums", color)}
                                    title={`${completedChildren.length} complete task${completedChildren.length === 1 ? "" : "s"}: planned ${plannedForCompletedChildren}d vs actual ${actualCompletedDays}d (${delta > 0 ? "+" : ""}${delta}d)`}
                                  >
                                    Actual (completed): {actualCompletedDays}d
                                    <span className="text-muted-foreground">
                                      {" · "}{delta > 0 ? "+" : ""}{delta}d vs plan
                                    </span>
                                  </span>
                                );
                              })()}
                              {childBudgetTotal > 0 && (
                                <span className="tabular-nums text-emerald-400">
                                  Budget: {fc(childBudgetTotal)}
                                </span>
                              )}
                            </div>
                          )}
                          {/* Entitlement-phase toolbar — pick a scenario
                              to seed the typical task list for that
                              approval pathway, then add / edit / remove
                              tasks as the jurisdiction requires. Spotted
                              bonus cards layer program-specific filings
                              on top of whatever scenario is chosen. */}
                          {isEntitlement && (
                            <div className="flex items-start gap-1.5 pl-6 pb-1 flex-wrap">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 text-2xs"
                                onClick={() => openCreateChildPhase(p.id)}
                              >
                                <Plus className="h-2.5 w-2.5 mr-1" /> Task
                              </Button>
                              <div className="flex items-center gap-1">
                                <Calendar className="h-2.5 w-2.5 text-muted-foreground" />
                                <select
                                  value=""
                                  disabled={seedingEntitlements}
                                  onChange={(e) => {
                                    const raw = e.target.value;
                                    e.target.value = "";
                                    if (!raw) return;
                                    // The <select> flags scenarios vs
                                    // templates via a small `scenario:` /
                                    // `template:` prefix so both can live
                                    // in the same picker.
                                    if (raw.startsWith("scenario:")) {
                                      handleSeedEntitlementTasks(p.id, {
                                        kind: "scenario",
                                        scenarioKey: raw.slice("scenario:".length),
                                      });
                                    } else if (raw.startsWith("template:")) {
                                      const tplId = raw.slice("template:".length);
                                      const tpl = templates.find((t) => t.id === tplId);
                                      if (tpl) {
                                        handleSeedEntitlementTasks(p.id, {
                                          kind: "template",
                                          template: tpl,
                                        });
                                      }
                                    }
                                  }}
                                  title="Seed a typical task list. Scenarios include spotted bonus filings on top; templates apply as-is."
                                  className="h-6 text-2xs bg-background border border-border/40 rounded px-1.5 outline-none hover:border-primary/40"
                                >
                                  <option value="">Seed scenario / template…</option>
                                  <optgroup label="Approval Pathways">
                                    {ENTITLEMENT_SCENARIOS.map((s) => (
                                      <option
                                        key={s.key}
                                        value={`scenario:${s.key}`}
                                      >
                                        {s.label}
                                      </option>
                                    ))}
                                  </optgroup>
                                  {templates.length > 0 && (
                                    <optgroup label="Your Saved Templates">
                                      {templates.map((t) => (
                                        <option
                                          key={t.id}
                                          value={`template:${t.id}`}
                                        >
                                          {t.name} ({t.tasks.length})
                                        </option>
                                      ))}
                                    </optgroup>
                                  )}
                                </select>
                                {seedingEntitlements && (
                                  <Loader2 className="h-2.5 w-2.5 animate-spin text-muted-foreground" />
                                )}
                              </div>
                              <a
                                href={`/deals/${dealId}/chat?prompt=${encodeURIComponent(`Review the focused task plan for "${p.label}". Ask any prep questions you need, then suggest entitlement tasks, owners, durations, and missing approvals before creating anything.`)}`}
                                className="inline-flex h-6 items-center rounded-md px-2 text-2xs text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
                                title="Use the assistant to review and create entitlement tasks"
                              >
                                <MessageSquare className="h-2.5 w-2.5 mr-1" />
                                Ask assistant
                              </a>
                              {children.length > 0 && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 text-2xs"
                                  onClick={() => handleSaveAsTemplate(p.id)}
                                  disabled={seedingEntitlements}
                                  title="Save the current task list as a reusable template you can re-apply on any future deal."
                                >
                                  <BookmarkPlus className="h-2.5 w-2.5 mr-1" /> Save as template
                                </Button>
                              )}
                              {/* Schedule-wide export moved to the section
                                  header next to Columns so it's discoverable
                                  on tracks without entitlement children. */}
                              {children.length > 0 && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 text-2xs text-muted-foreground hover:text-red-400"
                                  onClick={() => handleClearEntitlementTasks(p.id)}
                                  disabled={seedingEntitlements}
                                  title="Delete all child tasks so you can switch scenarios cleanly"
                                >
                                  <Trash2 className="h-2.5 w-2.5 mr-1" /> Clear tasks
                                </Button>
                              )}
                              {children.length === 0 && (
                                <span className="text-2xs text-muted-foreground/70 ml-1 self-center">
                                  Pick a scenario or saved template to seed, or add a task manually.
                                </span>
                              )}
                              {/* Template manager strip — one chip per saved
                                  template with a small × to delete. Kept
                                  minimal; same information as the dropdown
                                  but lets the user prune the list. */}
                              {templates.length > 0 && (
                                <div className="w-full flex items-center gap-1 flex-wrap pt-1">
                                  <span className="text-[9px] uppercase tracking-wide text-muted-foreground/70 mr-1">
                                    Templates
                                  </span>
                                  {templates.map((t) => {
                                    // Only the creator can rename / overwrite /
                                    // delete / toggle share. Shared templates
                                    // authored by someone else are read-only
                                    // ("from the workspace") and still apply
                                    // from the dropdown.
                                    const canEdit = t.is_owner !== false;
                                    return (
                                    <span
                                      key={t.id}
                                      className={cn(
                                        "inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border",
                                        t.shared
                                          ? "border-emerald-500/40 bg-emerald-500/10"
                                          : "border-border/40 bg-muted/20"
                                      )}
                                      title={`${t.tasks.length} task${t.tasks.length === 1 ? "" : "s"} — saved ${new Date(t.created_at).toLocaleDateString()}${t.shared ? " · shared with workspace" : ""}${canEdit ? "" : " · shared by a teammate"}`}
                                    >
                                      <span>{t.name}</span>
                                      {t.shared && (
                                        <span className="text-emerald-400" title="Shared with workspace">
                                          🌐
                                        </span>
                                      )}
                                      {canEdit && (
                                        <button
                                          type="button"
                                          onClick={() => handleToggleShareTemplate(t.id)}
                                          className="text-muted-foreground/50 hover:text-foreground transition-colors"
                                          title={t.shared ? "Make private" : "Share with workspace"}
                                        >
                                          {t.shared ? "🔒" : "↗"}
                                        </button>
                                      )}
                                      {canEdit && (
                                      <button
                                        type="button"
                                        onClick={() => handleRenameTemplate(t.id)}
                                        className="text-muted-foreground/50 hover:text-foreground transition-colors"
                                        title="Rename template"
                                      >
                                        ✎
                                      </button>
                                      )}
                                      {canEdit && (
                                      <button
                                        type="button"
                                        onClick={() => handleOverwriteTemplate(t.id, p.id)}
                                        className="text-muted-foreground/50 hover:text-foreground transition-colors"
                                        title="Overwrite with current tasks (snapshot the entitlement phase again)"
                                        disabled={children.length === 0}
                                      >
                                        ⟳
                                      </button>
                                      )}
                                      {canEdit && (
                                      <button
                                        type="button"
                                        onClick={() => handleDeleteTemplate(t.id)}
                                        className="text-muted-foreground/50 hover:text-red-400 transition-colors"
                                        title="Delete template"
                                      >
                                        ×
                                      </button>
                                      )}
                                    </span>
                                  );
                                  })}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    };

                    if (isMasterTrack) {
                      const tracks: ScheduleTrack[] = ["acquisition", "development", "construction"];
                      return tracks.flatMap((sectionTrack) => {
                        const rows = rootPhases.filter((phase) => (phase.track ?? "development") === sectionTrack);
                        if (rows.length === 0) return [];
                        return [
                          <div
                            key={`section-${sectionTrack}`}
                            className="rounded-md border border-border/50 bg-muted/20 px-3 py-1.5 text-2xs font-medium uppercase tracking-[0.14em] text-muted-foreground"
                          >
                            {SCHEDULE_TRACK_LABELS[sectionTrack]}
                          </div>,
                          ...rows.map(renderRoot),
                        ];
                      });
                    }

                    return rootPhases.map(renderRoot);
                  })()}
                </div>
                {totalScheduleBudget > 0 && columns.budget && (
                  <div className="flex items-center justify-end pt-2 border-t border-border/30 text-2xs text-muted-foreground">
                    <span>
                      Total budget:&nbsp;
                      <span className="text-emerald-400 font-medium tabular-nums">
                        {fc(totalScheduleBudget)}
                      </span>
                    </span>
                  </div>
                )}
                <div className="text-2xs text-muted-foreground pt-1">
                  ⚓ = anchor phase (manually set start date) · linked phases auto-shift when their predecessor moves
                </div>
              </div>
              </div>
              </>
            )}
          </div>
        )}
      </section>
      )}

      {/* ── Pre-Development Budget Tracker ── */}
      {!effectiveHideBudget && (
      <section className="border border-border/50 rounded-lg bg-card/50">
        <button
          onClick={() => setBudgetExpanded(!budgetExpanded)}
          className="flex items-center gap-2 w-full px-4 py-3 text-left hover:bg-muted/30 transition-colors rounded-t-lg"
        >
          {budgetExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          <Wallet className="h-4 w-4 text-primary" />
          <span className="font-medium text-sm">Pre-Development Budget</span>
          <Badge variant="secondary" className="ml-auto text-2xs">
            {fc(totalCommittedOrSpent)} committed
          </Badge>
        </button>

        {budgetExpanded && (
          <div className="px-4 pb-4 space-y-4">
            {/* ── Approval Threshold Tracker ── */}
            <div className="border border-border/30 rounded-md p-3 bg-background/40">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-3.5 w-3.5 text-primary" />
                  <span className="text-xs font-medium">Approval Status</span>
                </div>
                <Button size="sm" variant="ghost" className="h-6 text-2xs" onClick={openSettings}>
                  <SettingsIcon className="h-3 w-3 mr-1" /> Configure
                </Button>
              </div>

              <div className="grid grid-cols-3 gap-3 mb-3">
                <div>
                  <div className="text-2xs text-muted-foreground">Committed/Spent</div>
                  <div className="text-base font-bold">{fc(totalCommittedOrSpent)}</div>
                </div>
                <div>
                  <div className="text-2xs text-muted-foreground">Total Estimated</div>
                  <div className="text-base font-bold">{fc(totalEstimated)}</div>
                </div>
                <div>
                  <div className="text-2xs text-muted-foreground">Paid</div>
                  <div className="text-base font-bold text-emerald-400">{fc(totalPaid)}</div>
                </div>
              </div>

              {/* Next threshold callout */}
              {nextThreshold ? (
                <div className={cn(
                  "rounded-md p-2 mb-2 border",
                  headroomToNext < nextThreshold.amount * 0.1
                    ? "bg-red-500/10 border-red-500/30"
                    : headroomToNext < nextThreshold.amount * 0.25
                    ? "bg-amber-500/10 border-amber-500/30"
                    : "bg-blue-500/10 border-blue-500/30"
                )}>
                  <div className="flex items-center gap-2 text-xs">
                    <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                    <span className="font-medium">
                      {fc(headroomToNext)} until next approval gate:
                    </span>
                    <span className="text-muted-foreground">
                      {nextThreshold.label} ({fc(nextThreshold.amount)})
                    </span>
                  </div>
                </div>
              ) : (
                <div className="rounded-md p-2 mb-2 bg-emerald-500/10 border border-emerald-500/30">
                  <div className="flex items-center gap-2 text-xs">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                    <span>All approval gates passed.</span>
                  </div>
                </div>
              )}

              {/* Threshold ladder */}
              <div className="space-y-1">
                {sortedThresholds.map((t) => {
                  const passed = totalCommittedOrSpent >= t.amount;
                  const pctOfThreshold = Math.min(100, (totalCommittedOrSpent / t.amount) * 100);
                  return (
                    <div key={t.amount} className="space-y-0.5">
                      <div className="flex items-center justify-between text-2xs">
                        <span className={cn("flex items-center gap-1", passed ? "text-emerald-400" : "text-muted-foreground")}>
                          {passed ? <CheckCircle2 className="h-3 w-3" /> : <div className="h-3 w-3 rounded-full border border-muted-foreground/30" />}
                          {t.label}
                        </span>
                        <span className={passed ? "text-emerald-400" : "text-muted-foreground"}>{fc(t.amount)}</span>
                      </div>
                      <Progress value={pctOfThreshold} className="h-1" />
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ── Add Cost Button ── */}
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="text-xs" onClick={openCreateCost}>
                <Plus className="h-3 w-3 mr-1" /> Add Line Item
              </Button>
            </div>

            {/* ── Costs grouped by category ── */}
            {costs.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">
                No pre-development costs yet. Add line items as you commit spend.
              </p>
            ) : (
              <div className="space-y-3">
                {Object.entries(costsByCategory).map(([cat, items]) => {
                  const catTotal = items.reduce((s, c) => s + Number(c.amount), 0);
                  return (
                    <div key={cat} className="border border-border/30 rounded-md overflow-hidden">
                      <div className="flex items-center justify-between px-3 py-2 bg-muted/20 border-b border-border/30">
                        <div className="flex items-center gap-2">
                          <DollarSign className="h-3 w-3 text-primary" />
                          <span className="text-xs font-medium">{cat}</span>
                          <Badge variant="secondary" className="text-2xs">{items.length}</Badge>
                        </div>
                        <span className="text-xs font-bold">{fc(catTotal)}</span>
                      </div>
                      <div className="divide-y divide-border/20">
                        {items.map((c) => {
                          const cfg = PREDEV_COST_STATUS_CONFIG[c.status];
                          return (
                            <div key={c.id} className="group flex items-center gap-2 px-3 py-2 hover:bg-muted/20">
                              <button
                                onClick={() => openEditCost(c)}
                                className="flex-1 min-w-0 text-left text-xs hover:text-primary truncate"
                              >
                                {c.description}
                                {c.vendor && <span className="text-muted-foreground"> · {c.vendor}</span>}
                              </button>
                              <Badge variant="secondary" className={cn("text-2xs flex-shrink-0", cfg.color)}>
                                {cfg.label}
                              </Badge>
                              <span className="text-xs font-medium tabular-nums w-20 text-right">{fc(Number(c.amount))}</span>
                              <button
                                onClick={() => handleDeleteCost(c.id)}
                                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400 transition-all"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </section>
      )}

      {/* ── Paste Rows Dialog ── */}
      <Dialog open={pasteOpen} onOpenChange={setPasteOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Paste Schedule Rows</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <p className="text-sm text-muted-foreground">
              Paste rows copied from Excel, Project, or Sheets. Supported columns:
              task/name, duration, start, owner, and track.
            </p>
            {isMasterTrack && (
              <label className="block space-y-1 text-xs text-muted-foreground">
                <span>Default track when pasted rows do not include one</span>
                <select
                  value={pasteTrack}
                  onChange={(event) => setPasteTrack(event.target.value as ScheduleTrack)}
                  className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="acquisition">Acquisition</option>
                  <option value="development">Development</option>
                  <option value="construction">Construction</option>
                </select>
              </label>
            )}
            <textarea
              value={pasteText}
              onChange={(event) => setPasteText(event.target.value)}
              rows={8}
              placeholder={"Task Name\tDuration\tStart\tOwner\tTrack\nSubmit LOI\t7\t2026-05-15\tAcq Manager\tAcquisition"}
              className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary"
            />
            <div className="rounded-md border border-border/60 bg-muted/20 p-3">
              <div className="mb-2 flex items-center justify-between text-xs">
                <span className="font-medium text-foreground">Preview</span>
                <span className="text-muted-foreground">{pastedRows.length} row{pastedRows.length === 1 ? "" : "s"}</span>
              </div>
              <div className="max-h-44 overflow-y-auto text-xs">
                {pastedRows.length === 0 ? (
                  <p className="text-muted-foreground">Paste rows above to preview them here.</p>
                ) : (
                  <div className="space-y-1">
                    {pastedRows.slice(0, 12).map((row, index) => (
                      <div key={`${row.label}-${index}`} className="grid grid-cols-[1fr_56px_88px_92px] gap-2 rounded bg-background/60 px-2 py-1">
                        <span className="truncate">{row.label}</span>
                        <span className="tabular-nums text-muted-foreground">{row.duration_days}d</span>
                        <span className="text-muted-foreground">{row.start_date || "No start"}</span>
                        <span className="text-muted-foreground">{SCHEDULE_TRACK_LABELS[row.track]}</span>
                      </div>
                    ))}
                    {pastedRows.length > 12 && (
                      <p className="pt-1 text-muted-foreground">+ {pastedRows.length - 12} more</p>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setPasteOpen(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={handlePasteImport} disabled={pastedRows.length === 0 || pastingRows}>
                {pastingRows && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                Import rows
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {detailPhase && (
        <aside className="fixed bottom-0 right-0 top-0 z-40 flex w-full max-w-md flex-col border-l border-border/70 bg-background shadow-2xl">
          <div className="flex items-start justify-between gap-4 border-b border-border/60 px-5 py-4">
            <div className="min-w-0">
              <div className="mb-2 inline-flex rounded-full border border-border/60 px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                {detailPhase.parent_phase_id ? "Task Detail" : `${SCHEDULE_TRACK_LABELS[detailPhase.track || "development"]} Row`}
              </div>
              <InlineText
                value={detailPhase.label}
                allowEmpty={false}
                onSave={(value) =>
                  updatePhaseField(detailPhase.id, { label: value || detailPhase.label })
                }
                title="Click to rename"
                className="text-base font-semibold text-foreground"
              />
            </div>
            <button
              type="button"
              onClick={() => setDetailPhaseId(null)}
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
              aria-label="Close detail panel"
            >
              <XIcon className="h-4 w-4" />
            </button>
          </div>
          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1.5 text-xs text-muted-foreground">
                <span>Status</span>
                <select
                  value={detailPhase.status}
                  onChange={(event) =>
                    updatePhaseField(detailPhase.id, {
                      status: event.target.value as DevPhaseStatus,
                      pct_complete:
                        event.target.value === "complete"
                          ? 100
                          : event.target.value === "not_started"
                            ? 0
                            : detailPhase.pct_complete,
                    })
                  }
                  className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary"
                >
                  {Object.entries(DEV_PHASE_STATUS_CONFIG).map(([key, cfg]) => (
                    <option key={key} value={key}>{cfg.label}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1.5 text-xs text-muted-foreground">
                <span>% Complete</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  key={`pct-${detailPhase.id}-${detailPhase.pct_complete}`}
                  defaultValue={detailPhase.pct_complete}
                  onBlur={(event) =>
                    updatePhaseField(detailPhase.id, {
                      pct_complete: Math.min(100, Math.max(0, Number(event.target.value) || 0)),
                    })
                  }
                  className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary"
                />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1.5 text-xs text-muted-foreground">
                <span>Duration</span>
                <input
                  type="number"
                  min={1}
                  key={`duration-${detailPhase.id}-${detailPhase.duration_days ?? 1}`}
                  defaultValue={detailPhase.duration_days ?? 1}
                  onBlur={(event) =>
                    updatePhaseField(detailPhase.id, {
                      duration_days: Math.max(1, Number(event.target.value) || 1),
                    })
                  }
                  className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary"
                />
              </label>
              <label className="space-y-1.5 text-xs text-muted-foreground">
                <span>Start</span>
                <input
                  type="date"
                  value={detailPhase.start_date ?? ""}
                  disabled={!!detailPhase.predecessor_id}
                  onChange={(event) =>
                    updatePhaseField(detailPhase.id, { start_date: event.target.value || null })
                  }
                  className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
                />
              </label>
            </div>

            <label className="block space-y-1.5 text-xs text-muted-foreground">
              <span>Owner</span>
              <input
                key={`owner-${detailPhase.id}-${detailPhase.task_owner ?? ""}`}
                defaultValue={detailPhase.task_owner ?? ""}
                onBlur={(event) =>
                  updatePhaseField(detailPhase.id, {
                    task_owner: event.target.value.trim() || null,
                  })
                }
                placeholder="Owner / assignee"
                className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary"
              />
            </label>

            <label className="block space-y-1.5 text-xs text-muted-foreground">
              <span>Notes</span>
              <textarea
                key={`notes-${detailPhase.id}-${detailPhase.notes ?? ""}`}
                defaultValue={detailPhase.notes ?? ""}
                onBlur={(event) =>
                  updatePhaseField(detailPhase.id, { notes: event.target.value })
                }
                placeholder="Add context, handoff notes, or decisions."
                rows={5}
                className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary"
              />
            </label>

            <div className="rounded-lg border border-border/60 bg-card/60 p-3 text-xs text-muted-foreground">
              <div className="flex items-center justify-between gap-2">
                <span>Predecessor</span>
                <span className="truncate text-foreground">
                  {detailPhase.predecessor_id
                    ? phases.find((phase) => phase.id === detailPhase.predecessor_id)?.label || "Linked row"
                    : "Anchor row"}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <span>Finish</span>
                <span className="text-foreground">{detailPhase.end_date || "Computed after dates are set"}</span>
              </div>
              {Array.isArray(detailPhase.linked_document_ids) && detailPhase.linked_document_ids.length > 0 && (
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span>Linked docs</span>
                  <span className="text-foreground">{detailPhase.linked_document_ids.length}</span>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-border/60 px-5 py-3">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setDetailPhaseId(null);
                openEditPhase(detailPhase);
              }}
            >
              Full edit
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDetailPhaseId(null)}>
              Done
            </Button>
          </div>
        </aside>
      )}

      <Dialog open={phaseDialogOpen} onOpenChange={(open) => {
        setPhaseDialogOpen(open);
        if (!open) { setEditingPhase(null); resetPhaseForm(); }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingPhase ? "Edit Phase" : "New Phase"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Phase Name</label>
              <input
                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                value={phaseForm.label}
                onChange={(e) => setPhaseForm({ ...phaseForm, label: e.target.value })}
                placeholder="e.g., Construction"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Duration (days)</label>
                <input
                  type="number"
                  min={1}
                  className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  value={phaseForm.duration_days}
                  onChange={(e) => setPhaseForm({ ...phaseForm, duration_days: Number(e.target.value) })}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Lag (days after predecessor)</label>
                <input
                  type="number"
                  min={0}
                  className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
                  value={phaseForm.lag_days}
                  disabled={!phaseForm.predecessor_id}
                  onChange={(e) => setPhaseForm({ ...phaseForm, lag_days: Number(e.target.value) })}
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Predecessor (Finish-to-Start)</label>
              <select
                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                value={phaseForm.predecessor_id}
                onChange={(e) => setPhaseForm({ ...phaseForm, predecessor_id: e.target.value })}
              >
                <option value="">— None (anchor phase) —</option>
                {(() => {
                  // Group predecessor options: roots first, then each
                  // root's children indented so the analyst can chain
                  // child tasks ("CEQA Review → Planning Commission")
                  // as easily as root phases.
                  const roots = phases
                    .filter((p) => !p.parent_phase_id && (!editingPhase || p.id !== editingPhase.id))
                    .sort((a, b) => a.sort_order - b.sort_order);
                  const byParent = new Map<string, DevPhase[]>();
                  for (const p of phases) {
                    if (!p.parent_phase_id) continue;
                    if (editingPhase && p.id === editingPhase.id) continue;
                    const list = byParent.get(p.parent_phase_id) || [];
                    list.push(p);
                    byParent.set(p.parent_phase_id, list);
                  }
                  return roots.flatMap((root) => {
                    const kids = (byParent.get(root.id) || []).sort(
                      (a, b) => a.sort_order - b.sort_order
                    );
                    return [
                      <option key={root.id} value={root.id}>{root.label}</option>,
                      ...kids.map((k) => (
                        <option key={k.id} value={k.id}>
                          {"\u00A0\u00A0\u00A0\u00A0"}↳ {k.label}
                        </option>
                      )),
                    ];
                  });
                })()}
              </select>
              <p className="text-2xs text-muted-foreground mt-1">
                {phaseForm.predecessor_id
                  ? "Start date will be auto-computed from predecessor's end date + lag. Use this to chain child tasks (e.g. CEQA → Planning Commission)."
                  : "Anchor phase — set its start date manually below."}
              </p>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                Start Date {phaseForm.predecessor_id && <span className="text-muted-foreground/70">(computed)</span>}
              </label>
              <input
                type="date"
                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
                value={phaseForm.start_date}
                disabled={!!phaseForm.predecessor_id}
                onChange={(e) => setPhaseForm({ ...phaseForm, start_date: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">% Complete</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  value={phaseForm.pct_complete}
                  onChange={(e) => setPhaseForm({ ...phaseForm, pct_complete: Number(e.target.value) })}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Status</label>
                <select
                  className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  value={phaseForm.status}
                  onChange={(e) => setPhaseForm({ ...phaseForm, status: e.target.value as DevPhaseStatus })}
                >
                  {Object.entries(DEV_PHASE_STATUS_CONFIG).map(([k, cfg]) => (
                    <option key={k} value={k}>{cfg.label}</option>
                  ))}
                </select>
              </div>
            </div>
            {/* Child tasks: category chip + owner/assignee. Both free
                to leave blank. Owner is a free-text string so it can be
                any stakeholder (broker, architect, outside counsel…)
                without requiring a users lookup. */}
            {phaseForm.parent_phase_id && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Task Category</label>
                  <select
                    className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    value={phaseForm.task_category || ""}
                    onChange={(e) =>
                      setPhaseForm({
                        ...phaseForm,
                        task_category: e.target.value as TaskCategory | "",
                      })
                    }
                  >
                    <option value="">— None —</option>
                    {Object.entries(TASK_CATEGORY_CONFIG).map(([k, cfg]) => (
                      <option key={k} value={k}>{cfg.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Owner / Assignee</label>
                  <input
                    type="text"
                    placeholder="e.g. Project Manager, Outside Counsel"
                    className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    value={phaseForm.task_owner}
                    onChange={(e) =>
                      setPhaseForm({ ...phaseForm, task_owner: e.target.value })
                    }
                  />
                </div>
              </div>
            )}
            {phaseForm.parent_phase_id && (
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  Budget (optional)
                  <span className="text-2xs text-muted-foreground/70 ml-2">
                    rolls up under the parent phase
                  </span>
                </label>
                <div className="flex items-center border border-border rounded-md bg-background overflow-hidden">
                  <span className="px-2 text-sm text-muted-foreground bg-muted border-r">$</span>
                  <input
                    type="number"
                    min={0}
                    step={100}
                    placeholder="0"
                    className="flex-1 px-3 py-2 text-sm bg-transparent outline-none tabular-nums"
                    value={phaseForm.budget ?? ""}
                    onChange={(e) =>
                      setPhaseForm({
                        ...phaseForm,
                        budget: e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                  />
                </div>
              </div>
            )}
            {/* Document linker — child tasks only. Ties a task ("CEQA
                Review", "Application Submittal") to the actual PDFs in
                the deal's Documents tab so analysts can jump straight
                to the filing from the schedule. */}
            {phaseForm.parent_phase_id && (
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  Linked Documents
                  {phaseForm.linked_document_ids.length > 0 && (
                    <span className="text-[10px] text-muted-foreground/70 ml-1">
                      ({phaseForm.linked_document_ids.length} linked)
                    </span>
                  )}
                </label>
                {dealDocuments.length === 0 ? (
                  <p className="text-2xs text-muted-foreground/70 italic">
                    No documents uploaded yet. Upload on the Documents tab then come back to link.
                  </p>
                ) : (
                  <div className="max-h-32 overflow-y-auto border border-border rounded-md bg-background/60 p-1 space-y-0.5">
                    {dealDocuments.map((doc) => {
                      const checked = phaseForm.linked_document_ids.includes(doc.id);
                      return (
                        <label
                          key={doc.id}
                          className="flex items-center gap-2 px-2 py-1 text-xs rounded hover:bg-muted/30 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              const curr = new Set(phaseForm.linked_document_ids);
                              if (e.target.checked) curr.add(doc.id);
                              else curr.delete(doc.id);
                              setPhaseForm({
                                ...phaseForm,
                                linked_document_ids: Array.from(curr),
                              });
                            }}
                            className="rounded"
                          />
                          <span className="truncate flex-1">
                            {doc.original_name || doc.name}
                          </span>
                          {doc.category && (
                            <span className="text-[10px] text-muted-foreground/70">
                              {doc.category}
                            </span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Notes</label>
              <textarea
                rows={2}
                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                value={phaseForm.notes}
                onChange={(e) => setPhaseForm({ ...phaseForm, notes: e.target.value })}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" size="sm" onClick={() => { setPhaseDialogOpen(false); setEditingPhase(null); resetPhaseForm(); }}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleSavePhase}>{editingPhase ? "Save" : "Create"}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Cost Dialog ── */}
      <Dialog open={costDialogOpen} onOpenChange={(open) => {
        setCostDialogOpen(open);
        if (!open) { setEditingCost(null); resetCostForm(); }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingCost ? "Edit Line Item" : "New Pre-Dev Cost"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Category</label>
                <select
                  className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  value={costForm.category}
                  onChange={(e) => setCostForm({ ...costForm, category: e.target.value })}
                >
                  {PREDEV_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Status</label>
                <select
                  className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  value={costForm.status}
                  onChange={(e) => setCostForm({ ...costForm, status: e.target.value as PreDevCostStatus })}
                >
                  {Object.entries(PREDEV_COST_STATUS_CONFIG).map(([k, cfg]) => (
                    <option key={k} value={k}>{cfg.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Description</label>
              <input
                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                value={costForm.description}
                onChange={(e) => setCostForm({ ...costForm, description: e.target.value })}
                placeholder="e.g., Phase I ESA"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Vendor</label>
                <input
                  className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  value={costForm.vendor}
                  onChange={(e) => setCostForm({ ...costForm, vendor: e.target.value })}
                  placeholder="e.g., ABC Environmental"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Amount ($)</label>
                <input
                  type="number"
                  min={0}
                  className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  value={costForm.amount}
                  onChange={(e) => setCostForm({ ...costForm, amount: Number(e.target.value) })}
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Incurred Date</label>
              <input
                type="date"
                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                value={costForm.incurred_date}
                onChange={(e) => setCostForm({ ...costForm, incurred_date: e.target.value })}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Notes</label>
              <textarea
                rows={2}
                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                value={costForm.notes}
                onChange={(e) => setCostForm({ ...costForm, notes: e.target.value })}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" size="sm" onClick={() => { setCostDialogOpen(false); setEditingCost(null); resetCostForm(); }}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleSaveCost}>{editingCost ? "Save" : "Create"}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Settings Dialog ── */}
      <Dialog open={settingsDialogOpen} onOpenChange={setSettingsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approval Thresholds</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <p className="text-xs text-muted-foreground">
              Define cumulative spend levels that require additional approvals. The tracker will warn you as you approach each gate.
            </p>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Total Pre-Dev Budget ($, optional)</label>
              <input
                type="number"
                min={0}
                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                value={settingsForm.total_budget ?? ""}
                onChange={(e) => setSettingsForm({ ...settingsForm, total_budget: e.target.value ? Number(e.target.value) : null })}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Approval Gates</label>
              <div className="space-y-2">
                {settingsForm.thresholds.map((t, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      className="flex-1 bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                      placeholder="Label"
                      value={t.label}
                      onChange={(e) => {
                        const next = [...settingsForm.thresholds];
                        next[i] = { ...t, label: e.target.value };
                        setSettingsForm({ ...settingsForm, thresholds: next });
                      }}
                    />
                    <input
                      type="number"
                      className="w-32 bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                      placeholder="Amount"
                      value={t.amount}
                      onChange={(e) => {
                        const next = [...settingsForm.thresholds];
                        next[i] = { ...t, amount: Number(e.target.value) };
                        setSettingsForm({ ...settingsForm, thresholds: next });
                      }}
                    />
                    <button
                      onClick={() => {
                        const next = settingsForm.thresholds.filter((_, j) => j !== i);
                        setSettingsForm({ ...settingsForm, thresholds: next });
                      }}
                      className="text-muted-foreground hover:text-red-400"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs w-full"
                  onClick={() => setSettingsForm({
                    ...settingsForm,
                    thresholds: [...settingsForm.thresholds, { amount: 0, label: "New Gate" }],
                  })}
                >
                  <Plus className="h-3 w-3 mr-1" /> Add Threshold
                </Button>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" size="sm" onClick={() => setSettingsDialogOpen(false)}>Cancel</Button>
              <Button size="sm" onClick={handleSaveSettings}>Save</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── AI Suggest Preview ──
          Separate dialog because the phase editor is busy already, and
          the preview benefits from a wider checklist layout. Nothing is
          persisted until the analyst clicks "Add N Tasks". */}
      <Dialog open={suggestOpen} onOpenChange={setSuggestOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              AI-Suggested Entitlement Tasks
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {suggestMeta && (
              <div className="text-2xs text-muted-foreground flex items-center gap-2 flex-wrap">
                <span>For <span className="text-foreground font-medium">{suggestMeta.jurisdiction}</span></span>
                {suggestMeta.spottedBonuses.length > 0 && (
                  <>
                    <span>·</span>
                    <span>Including filings for:</span>
                    {suggestMeta.spottedBonuses.map((s) => (
                      <span key={s} className="text-emerald-400">{s}</span>
                    ))}
                  </>
                )}
              </div>
            )}
            {suggesting && (
              <div className="flex items-center gap-2 py-6 justify-center text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Asking Claude for jurisdiction-specific tasks…
              </div>
            )}
            {!suggesting && suggestions.length === 0 && (
              <div className="py-6 text-center text-sm text-muted-foreground">
                No suggestions returned. The AI may not have enough context
                yet — try filling in the deal's address and zoning first.
              </div>
            )}
            {!suggesting && suggestions.length > 0 && (
              <>
                <div className="flex items-center justify-between text-2xs text-muted-foreground">
                  <span>{suggestPicked.size} of {suggestions.length} selected</span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setSuggestPicked(new Set(suggestions.map((_, i) => i)))}
                      className="hover:text-foreground"
                    >
                      Select all
                    </button>
                    <button
                      type="button"
                      onClick={() => setSuggestPicked(new Set())}
                      className="hover:text-foreground"
                    >
                      Clear
                    </button>
                  </div>
                </div>
                <div className="max-h-[50vh] overflow-y-auto border border-border/40 rounded-md divide-y divide-border/40">
                  {suggestions.map((s, i) => {
                    const picked = suggestPicked.has(i);
                    const catCfg = TASK_CATEGORY_CONFIG[s.category];
                    return (
                      <label
                        key={i}
                        className="flex items-start gap-2 px-3 py-2 hover:bg-muted/20 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={picked}
                          onChange={(e) => {
                            const next = new Set(suggestPicked);
                            if (e.target.checked) next.add(i);
                            else next.delete(i);
                            setSuggestPicked(next);
                          }}
                          className="rounded mt-0.5"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span
                              className={cn(
                                "text-[9px] uppercase tracking-wide px-1 rounded border flex-shrink-0",
                                catCfg.color,
                                catCfg.bg,
                                catCfg.border
                              )}
                            >
                              {catCfg.label}
                            </span>
                            <span className="text-sm font-medium">{s.label}</span>
                            <span className="text-2xs text-muted-foreground">{s.duration_days}d</span>
                          </div>
                          {s.rationale && (
                            <p className="text-2xs text-muted-foreground mt-0.5">
                              {s.rationale}
                            </p>
                          )}
                        </div>
                      </label>
                    );
                  })}
                </div>
              </>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSuggestOpen(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleApplySuggestions}
                disabled={suggesting || suggestPicked.size === 0}
              >
                <Check className="h-3.5 w-3.5 mr-1" />
                Add {suggestPicked.size} Task{suggestPicked.size === 1 ? "" : "s"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Bundle-pick wizard. Opens from the inline "Seed Schedule" button
          on each track when the schedule is empty. The wizard handles
          its own POST + reload; we just refresh the local cache when it
          completes. */}
      <ScheduleSeedWizard
        dealId={dealId}
        dealName=""
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onSeeded={() => {
          loadAll();
        }}
      />
    </div>
  );
}

/**
 * Spreadsheet-style header wrapper. Drag the right edge to resize a
 * schedule column; the parent owns persistence so widths follow the
 * user per deal + track.
 */
function ResizableHeaderCell({
  children,
  onResizeStart,
}: {
  children: ReactNode;
  onResizeStart: (event: PointerEvent<HTMLSpanElement>) => void;
}) {
  return (
    <div className="group/header relative min-w-0 pr-2">
      <div className="min-w-0">{children}</div>
      <span
        role="separator"
        aria-orientation="vertical"
        tabIndex={-1}
        onPointerDown={onResizeStart}
        className="absolute right-0 top-0 h-full w-2 cursor-col-resize rounded-sm transition-colors hover:bg-primary/35 group-hover/header:bg-border/70"
        title="Drag to resize column"
      />
    </div>
  );
}

/**
 * One sortable column header. Active column shows an up/down arrow that
 * matches the current direction; inactive columns show the
 * neutral two-arrow icon on hover so it's discoverable that they're
 * sortable.
 */
function SortHeader({
  label,
  active,
  direction,
  onClick,
  align = "start",
}: {
  label: string;
  active: boolean;
  direction: "asc" | "desc";
  onClick: () => void;
  align?: "start" | "end";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 px-1 py-0.5 rounded hover:bg-muted/40 hover:text-foreground transition-colors group",
        align === "end" ? "justify-end" : "justify-start",
        active && "text-foreground"
      )}
      title={`Sort by ${label}`}
    >
      <span className="truncate">{label}</span>
      {active ? (
        direction === "asc" ? (
          <ArrowUpAZ className="h-3 w-3" />
        ) : (
          <ArrowDownAZ className="h-3 w-3" />
        )
      ) : (
        <ArrowUpDown className="h-3 w-3 opacity-0 group-hover:opacity-50" />
      )}
    </button>
  );
}

/**
 * Wraps a single entitlement child-task row in @dnd-kit's sortable
 * bindings so the user can drag it within its parent's task list.
 * The actual row markup is still rendered by the parent (via
 * `renderRow`) — we only provide transform + listeners here.
 */
function SortableChild({
  id,
  children,
}: {
  id: string;
  children: (opts: {
    setActivatorNodeRef: (el: HTMLElement | null) => void;
    listeners: Record<string, unknown> | undefined;
    attributes: Record<string, unknown>;
    isDragging: boolean;
  }) => React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  };
  return (
    <div ref={setNodeRef} style={style}>
      {children({
        setActivatorNodeRef,
        listeners: listeners as Record<string, unknown> | undefined,
        attributes: attributes as unknown as Record<string, unknown>,
        isDragging,
      })}
    </div>
  );
}
