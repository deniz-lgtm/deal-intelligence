"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Plus, Search, ClipboardList, Filter, ListChecks, Scale, ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { TaskList } from "@/components/tasks/TaskList";
import { TaskDrawer } from "@/components/tasks/TaskDrawer";
import { TASK_KINDS, TASK_KIND_CONFIG, type DevPhase, type DevPhaseKind } from "@/lib/types";
import { toast } from "sonner";

const KIND_TABS: { value: "all" | DevPhaseKind; label: string; icon: typeof ClipboardList }[] = [
  { value: "all", label: "All", icon: ClipboardList },
  { value: "general", label: "General", icon: ListChecks },
  { value: "diligence", label: "Diligence", icon: ScrollText },
  { value: "decision", label: "Decisions", icon: Scale },
];

export default function DealTasksPage() {
  const params = useParams<{ id: string }>();
  const dealId = params.id;
  const router = useRouter();
  const search = useSearchParams();
  const initialKind = (search.get("kind") ?? "all") as "all" | DevPhaseKind;

  const [tasks, setTasks] = useState<DevPhase[]>([]);
  const [loading, setLoading] = useState(true);
  const [kindTab, setKindTab] = useState<"all" | DevPhaseKind>(initialKind);
  const [query, setQuery] = useState("");
  const [showCompleted, setShowCompleted] = useState(true);
  const [editing, setEditing] = useState<DevPhase | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/unified-tasks?kind=${TASK_KINDS.join(",")}`);
      const json = await res.json();
      if (Array.isArray(json.data)) setTasks(json.data);
    } catch {
      toast.error("Failed to load tasks");
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    let list = tasks;
    if (kindTab !== "all") list = list.filter((t) => (t.kind ?? "general") === kindTab);
    if (!showCompleted) list = list.filter((t) => t.status !== "complete");
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter((t) =>
        t.label.toLowerCase().includes(q) ||
        (t.description ?? "").toLowerCase().includes(q) ||
        (t.task_owner ?? "").toLowerCase().includes(q),
      );
    }
    return list;
  }, [tasks, kindTab, query, showCompleted]);

  const counts = useMemo(() => {
    const open = tasks.filter((t) => t.status !== "complete");
    return {
      all: open.length,
      general: open.filter((t) => (t.kind ?? "general") === "general").length,
      diligence: open.filter((t) => t.kind === "diligence").length,
      decision: open.filter((t) => t.kind === "decision").length,
    };
  }, [tasks]);

  const openNew = () => {
    setEditing(null);
    setDrawerOpen(true);
  };

  const openExisting = (task: DevPhase) => {
    setEditing(task);
    setDrawerOpen(true);
  };

  const handleSaved = (saved: DevPhase) => {
    setTasks((prev) => {
      const exists = prev.some((t) => t.id === saved.id);
      return exists ? prev.map((t) => (t.id === saved.id ? saved : t)) : [saved, ...prev];
    });
  };

  const handleDeleted = (taskId: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
  };

  const handleToggleStatus = async (task: DevPhase) => {
    const nextStatus = task.status === "complete" ? "in_progress" : "complete";
    setTasks((prev) =>
      prev.map((t) =>
        t.id === task.id
          ? { ...t, status: nextStatus, completed_at: nextStatus === "complete" ? new Date().toISOString() : null }
          : t,
      ),
    );
    try {
      await fetch(`/api/deals/${dealId}/unified-tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
    } catch {
      toast.error("Failed to update status");
      load();
    }
  };

  const setKind = (k: "all" | DevPhaseKind) => {
    setKindTab(k);
    const sp = new URLSearchParams(search.toString());
    if (k === "all") sp.delete("kind");
    else sp.set("kind", k);
    const qs = sp.toString();
    router.replace(`/deals/${dealId}/tasks${qs ? `?${qs}` : ""}`);
  };

  const defaultKindForNew: DevPhaseKind = kindTab === "all" ? "general" : (kindTab as DevPhaseKind);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-border/30 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10">
            <ClipboardList className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h1 className="font-nameplate text-xl leading-none tracking-tight">Tasks</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              Everything actionable on this deal — general tasks, diligence items, open decisions.
            </p>
          </div>
        </div>
        <Button onClick={openNew} size="sm">
          <Plus className="mr-1.5 h-3.5 w-3.5" /> New Task
        </Button>
      </header>

      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/30 px-6 py-2.5">
        <nav className="flex items-center gap-1">
          {KIND_TABS.map((t) => {
            const Icon = t.icon;
            const isActive = kindTab === t.value;
            const count = counts[t.value as keyof typeof counts] ?? 0;
            return (
              <button
                key={t.value}
                onClick={() => setKind(t.value)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                  isActive
                    ? "bg-primary/15 text-foreground"
                    : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
                {count > 0 && (
                  <span className={cn("rounded-full px-1.5 py-0.5 text-2xs", isActive ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground")}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground/40" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search tasks…"
              className="w-52 rounded-md border border-border/40 bg-background/40 py-1.5 pl-7 pr-3 text-xs focus:border-primary/40 focus:bg-background focus:outline-none"
            />
          </div>
          <button
            onClick={() => setShowCompleted((v) => !v)}
            className={cn(
              "flex items-center gap-1.5 rounded-md border border-border/40 px-2.5 py-1.5 text-xs transition-colors",
              showCompleted ? "bg-background/40 text-muted-foreground hover:text-foreground" : "bg-primary/10 text-primary",
            )}
            title="Toggle completed tasks"
          >
            <Filter className="h-3 w-3" />
            {showCompleted ? "Hide done" : "Show done"}
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        {loading ? (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">Loading tasks…</div>
        ) : (
          <TaskList tasks={filtered} onSelect={openExisting} onToggleStatus={handleToggleStatus} />
        )}
      </div>

      <TaskDrawer
        dealId={dealId}
        task={editing}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onSaved={handleSaved}
        onDeleted={handleDeleted}
        defaultKind={defaultKindForNew}
      />
    </div>
  );
}
