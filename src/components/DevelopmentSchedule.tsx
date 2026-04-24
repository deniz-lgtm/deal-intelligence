"use client";

import { useState, useEffect, useCallback } from "react";
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
  Wand2,
  Download,
  Sparkles,
  Check,
  X as XIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
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
} from "@/lib/types";
import type {
  DevPhase,
  DevPhaseStatus,
  PreDevCost,
  PreDevCostStatus,
  PreDevSettings,
  TaskCategory,
} from "@/lib/types";
import {
  ENTITLEMENT_SCENARIOS,
  findEntitlementScenario,
  findBonusCard,
} from "@/lib/bonus-catalog";
import { toast } from "sonner";

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
}

const fc = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

export default function DevelopmentSchedule({ dealId }: Props) {
  const [phases, setPhases] = useState<DevPhase[]>([]);
  const [costs, setCosts] = useState<PreDevCost[]>([]);
  const [settings, setSettings] = useState<PreDevSettings>({
    total_budget: null,
    thresholds: DEFAULT_PREDEV_THRESHOLDS,
  });
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);

  const [scheduleExpanded, setScheduleExpanded] = useState(true);
  const [budgetExpanded, setBudgetExpanded] = useState(true);

  // Phase dialog
  const [phaseDialogOpen, setPhaseDialogOpen] = useState(false);
  const [editingPhase, setEditingPhase] = useState<DevPhase | null>(null);
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
        // Filter to the development track — Acq and Construction live in
        // the same table now but render on their own pages.
        fetch(`/api/deals/${dealId}/dev-schedule?track=development`),
        fetch(`/api/deals/${dealId}/predev-costs`),
        fetch(`/api/deals/${dealId}/predev-settings`),
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
  }, [dealId]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // ── Seed default phases ──
  const handleSeedPhases = async () => {
    setSeeding(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/dev-schedule/seed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ start_date: new Date().toISOString().split("T")[0] }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        toast.error(json.error || `Seed failed (HTTP ${res.status})`);
        return;
      }
      await loadAll();
      toast.success("Default phases seeded");
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
        alert(err.error || "Failed to save phase");
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

  /** Download the schedule as CSV or ICS. */
  const handleExportSchedule = (format: "csv" | "ics") => {
    // Browser navigates to the export route with the proper Content-
    // Disposition header — simplest cross-client path to "download file".
    const url = `/api/deals/${dealId}/dev-schedule/export?format=${format}`;
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
  const showToday = todayPct !== null && todayPct >= 0 && todayPct <= 100;

  // ── Critical path detection ──
  // A phase is on the critical path if it has no slack: it's either an anchor
  // or its predecessor is also critical, and it's not yet complete.
  // Simple heuristic: phases that are in_progress or delayed with successor chains.
  const criticalPhaseIds = new Set<string>();
  const phaseById = new Map(phases.map((p) => [p.id, p]));
  // Find the longest dependency chain (critical path heuristic)
  const getChainEnd = (id: string): string | null => {
    const successors = phases.filter((p) => p.predecessor_id === id);
    if (successors.length === 0) return id;
    // Pick the successor that ends latest
    let latestEnd = "";
    let latestId = id;
    for (const s of successors) {
      const chainEnd = getChainEnd(s.id);
      const endPhase = chainEnd ? phaseById.get(chainEnd) : null;
      if (endPhase?.end_date && endPhase.end_date > latestEnd) {
        latestEnd = endPhase.end_date;
        latestId = chainEnd!;
      }
    }
    return latestId;
  };
  // Mark phases on the longest path that are not yet complete
  if (phases.length > 0) {
    // Find anchor phases (no predecessor)
    const anchors = phases.filter((p) => !p.predecessor_id);
    for (const anchor of anchors) {
      // Walk the chain
      let current: string | undefined = anchor.id;
      while (current) {
        const phase = phaseById.get(current);
        if (phase && phase.status !== "complete") {
          criticalPhaseIds.add(current);
        }
        const successors = phases.filter((p) => p.predecessor_id === current);
        // Follow the successor that ends latest (critical path)
        if (successors.length === 0) break;
        let latest = successors[0];
        for (const s of successors) {
          if ((s.end_date || "") > (latest.end_date || "")) latest = s;
        }
        current = latest.id;
      }
    }
  }

  const isDelayed = (p: DevPhase) => {
    if (p.status === "delayed") return true;
    if (p.end_date && p.status !== "complete" && new Date(p.end_date).getTime() < todayMs) return true;
    return false;
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
      <section className="border border-border/50 rounded-lg bg-card/50">
        <button
          onClick={() => setScheduleExpanded(!scheduleExpanded)}
          className="flex items-center gap-2 w-full px-4 py-3 text-left hover:bg-muted/30 transition-colors rounded-t-lg"
        >
          {scheduleExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          <GanttChart className="h-4 w-4 text-primary" />
          <span className="font-medium text-sm">Development Schedule</span>
          <Badge variant="secondary" className="ml-auto text-2xs">
            {phases.filter((p) => p.status === "complete").length}/{phases.length} phases
          </Badge>
        </button>

        {scheduleExpanded && (
          <div className="px-4 pb-4 space-y-3">
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="text-xs" onClick={openCreatePhase}>
                <Plus className="h-3 w-3 mr-1" /> Add Phase
              </Button>
              {phases.length === 0 && (
                <Button size="sm" variant="outline" className="text-xs" onClick={handleSeedPhases} disabled={seeding}>
                  {seeding ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Calendar className="h-3 w-3 mr-1" />}
                  Seed Default Phases
                </Button>
              )}
            </div>

            {phases.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">
                No phases yet. Click &quot;Seed Default Phases&quot; to start with a typical CRE timeline.
              </p>
            ) : (
              <>
                {/* Timeline range header */}
                {minDate && maxDate && (
                  <div className="flex justify-between text-2xs text-muted-foreground border-b border-border/30 pb-1 relative">
                    <span>{new Date(minDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", year: "numeric" })}</span>
                    {showToday && (
                      <span className="absolute text-[9px] text-red-400 font-medium" style={{ left: `calc(25% + ${todayPct! * 0.583}%)`, transform: "translateX(-50%)" }}>
                        Today
                      </span>
                    )}
                    <span>{new Date(maxDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", year: "numeric" })}</span>
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

                {/* Gantt rows — roots render at top level with any child
                    tasks (parent_phase_id set) nested below, indented. */}
                <div className="space-y-1.5">
                  {(() => {
                    const rootPhases = phases.filter((p) => !p.parent_phase_id);
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
                      }
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
                      return (
                        <div key={p.id} className="group">
                          <div className="grid grid-cols-12 gap-2 items-center">
                            {/* Drag handle — rendered inside the label cell
                                as an absolute-ish slot to the left. The
                                activator ref + listeners come from
                                SortableChild; regular clicks still hit the
                                label button. */}
                            {dragHandleProps && (
                              <button
                                ref={dragHandleProps.setActivatorNodeRef}
                                {...dragHandleProps.attributes}
                                {...(dragHandleProps.listeners as Record<string, unknown>)}
                                className="absolute ml-[-12px] opacity-0 group-hover:opacity-60 hover:opacity-100 text-muted-foreground cursor-grab active:cursor-grabbing transition-opacity"
                                title="Drag to reorder"
                                aria-label="Drag to reorder"
                                type="button"
                              >
                                <GripVertical className="h-3 w-3" />
                              </button>
                            )}
                            {/* Label + category chip (child rows only) */}
                            <button
                              onClick={() => openEditPhase(p)}
                              className={cn(
                                "col-span-3 text-left text-xs hover:text-primary truncate flex items-center gap-1",
                                delayed && "text-red-400",
                                isChild && "pl-4 text-muted-foreground"
                              )}
                            >
                              {isChild && <span className="text-muted-foreground/50">└</span>}
                              {!isChild && isCritical && (
                                <span title="Critical path"><AlertTriangle className="h-2.5 w-2.5 text-red-400 flex-shrink-0" /></span>
                              )}
                              {!isChild && !isCritical && !p.predecessor_id && (
                                <span className="text-2xs text-amber-400" title="Anchor phase">⚓</span>
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
                              <span className="truncate">{p.label}</span>
                              {p.duration_days && (
                                <span className="text-2xs text-muted-foreground flex-shrink-0">{p.duration_days}d</span>
                              )}
                              {isChild && p.task_owner && (
                                <span
                                  className="text-2xs text-muted-foreground/80 flex-shrink-0"
                                  title={`Owner: ${p.task_owner}`}
                                >
                                  · {p.task_owner}
                                </span>
                              )}
                              {isChild && Array.isArray(p.linked_document_ids) && p.linked_document_ids.length > 0 && (
                                <span
                                  className="flex items-center gap-0.5 text-2xs text-primary/80 flex-shrink-0"
                                  title={`${p.linked_document_ids.length} linked document${p.linked_document_ids.length === 1 ? "" : "s"}`}
                                >
                                  <Paperclip className="h-2.5 w-2.5" />
                                  {p.linked_document_ids.length}
                                </span>
                              )}
                              {isChild && p.budget != null && Number(p.budget) > 0 && (
                                <span
                                  className="text-2xs text-emerald-400/80 flex-shrink-0 tabular-nums"
                                  title="Budget"
                                >
                                  · {fc(Number(p.budget))}
                                </span>
                              )}
                              {isChild && p.status === "complete" && p.start_date && p.end_date && p.duration_days != null && (() => {
                                // Variance: actual calendar days elapsed
                                // between start and end vs the planned
                                // duration. Green = early / on-time,
                                // red = late. Muted when 0-day delta.
                                const s = new Date(p.start_date);
                                const e = new Date(p.end_date);
                                const actual = Math.max(0, Math.round((e.getTime() - s.getTime()) / 86400000));
                                const delta = actual - (p.duration_days || 0);
                                const color = delta > 0 ? "text-red-400" : delta < 0 ? "text-emerald-400" : "text-muted-foreground/80";
                                return (
                                  <span
                                    className={cn("text-2xs flex-shrink-0 tabular-nums", color)}
                                    title={`Planned ${p.duration_days}d · actual ${actual}d (${delta > 0 ? "+" : ""}${delta}d)`}
                                  >
                                    · actual {actual}d
                                  </span>
                                );
                              })()}
                            </button>
                            {/* Bar */}
                            <div className={cn("col-span-7 relative rounded", isChild ? "h-3 bg-muted/20" : "h-5 bg-muted/30")}>
                              {showToday && (
                                <div
                                  className="absolute top-0 h-full w-px bg-red-500/50 z-10"
                                  style={{ left: `${todayPct}%` }}
                                />
                              )}
                              <div
                                className={cn(
                                  "absolute top-0 h-full rounded",
                                  delayed ? "bg-red-500/30 ring-1 ring-red-500/40" :
                                  isCritical ? "ring-1 ring-red-500/30 " + cfg.bg :
                                  isChild ? "bg-primary/30" :
                                  cfg.bg
                                )}
                                style={barStyle}
                                title={`${p.label}: ${p.start_date || "?"} → ${p.end_date || "?"} (${p.pct_complete}%)${predLabel ? ` | After: ${predLabel}` : ""}${isCritical ? " [CRITICAL PATH]" : ""}${delayed ? " [DELAYED]" : ""}`}
                              >
                                {p.pct_complete > 0 && (
                                  <div
                                    className="absolute top-0 left-0 h-full bg-emerald-500/40 rounded"
                                    style={{ width: `${p.pct_complete}%` }}
                                  />
                                )}
                              </div>
                            </div>
                            {/* Status + actions. Child rows get up/down
                                arrows for manual reordering within the
                                parent's task list. */}
                            <div className="col-span-2 flex items-center justify-end gap-1">
                              {isChild && (
                                <>
                                  <button
                                    onClick={() => handleReorderChild(p, "up")}
                                    disabled={childIdx === 0 || isReordering}
                                    className={cn(
                                      "text-muted-foreground/50 hover:text-foreground transition-colors",
                                      (childIdx === 0 || isReordering) && "opacity-30 cursor-not-allowed"
                                    )}
                                    title="Move up"
                                  >
                                    <ArrowUp className="h-3 w-3" />
                                  </button>
                                  <button
                                    onClick={() => handleReorderChild(p, "down")}
                                    disabled={childIdx >= childCount - 1 || isReordering}
                                    className={cn(
                                      "text-muted-foreground/50 hover:text-foreground transition-colors",
                                      (childIdx >= childCount - 1 || isReordering) && "opacity-30 cursor-not-allowed"
                                    )}
                                    title="Move down"
                                  >
                                    <ArrowDown className="h-3 w-3" />
                                  </button>
                                </>
                              )}
                              <Badge variant="secondary" className={cn("text-2xs", delayed ? "text-red-400 bg-red-500/10" : cfg.color)}>
                                {p.pct_complete}%
                              </Badge>
                              <button
                                onClick={() => handleDeletePhase(p.id)}
                                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400 transition-all"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    };

                    return rootPhases.map((p) => {
                      const children = childrenByParent.get(p.id) || [];
                      const isEntitlement = p.phase_key === "entitlements";
                      // Children are stored by sort_order so up/down
                      // arrows can do stable pair-swaps.
                      const sortedChildren = [...children].sort(
                        (a, b) => a.sort_order - b.sort_order
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
                          {renderRow(p, false)}
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
                                        renderRow(c, true, i, sortedChildren.length, drag)
                                      }
                                    </SortableChild>
                                  ))}
                                </div>
                              </SortableContext>
                            </DndContext>
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
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 text-2xs"
                                onClick={() => handleAiSuggest(p.id)}
                                disabled={suggesting || seedingEntitlements}
                                title="Ask Claude for entitlement tasks specific to this jurisdiction, zoning, and any spotted programs. You pick which ones to add."
                              >
                                {suggesting ? (
                                  <Loader2 className="h-2.5 w-2.5 mr-1 animate-spin" />
                                ) : (
                                  <Wand2 className="h-2.5 w-2.5 mr-1" />
                                )}
                                AI Suggest
                              </Button>
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
                              {children.length > 0 && (
                                <div className="flex items-center gap-1">
                                  <Download className="h-2.5 w-2.5 text-muted-foreground" />
                                  <select
                                    value=""
                                    onChange={(e) => {
                                      const v = e.target.value;
                                      e.target.value = "";
                                      if (v === "csv" || v === "ics") handleExportSchedule(v);
                                    }}
                                    className="h-6 text-2xs bg-background border border-border/40 rounded px-1.5 outline-none hover:border-primary/40"
                                    title="Export the full schedule for handoff to PM tools / calendars"
                                  >
                                    <option value="">Export…</option>
                                    <option value="csv">CSV (Sheets / Excel)</option>
                                    <option value="ics">ICS (Calendar)</option>
                                  </select>
                                </div>
                              )}
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
                    });
                  })()}
                </div>
                <div className="text-2xs text-muted-foreground pt-1">
                  ⚓ = anchor phase (manually set start date) · linked phases auto-shift when their predecessor moves
                </div>
              </>
            )}
          </div>
        )}
      </section>

      {/* ── Pre-Development Budget Tracker ── */}
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

      {/* ── Phase Dialog ── */}
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
    </div>
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
