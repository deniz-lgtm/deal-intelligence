"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Plus,
  CheckCircle2,
  Circle,
  Clock,
  AlertTriangle,
  Calendar,
  Trash2,
  ChevronDown,
  ChevronRight,
  Sparkles,
  Target,
  Flag,
  User,
  Diamond,
  Loader2,
  FileSearch,
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
  TASK_PRIORITY_CONFIG,
  TASK_STATUS_CONFIG,
  DEAL_STAGE_LABELS,
  STAGE_MILESTONE_TEMPLATES,
} from "@/lib/types";
import type {
  DealTask,
  DealMilestone,
  TaskPriority,
  TaskStatus,
  DealStatus,
} from "@/lib/types";

interface ProjectManagementProps {
  dealId: string;
}

const STATUS_CYCLE: TaskStatus[] = ["todo", "in_progress", "blocked", "done"];

const STATUS_ICONS: Record<TaskStatus, typeof Circle> = {
  todo: Circle,
  in_progress: Clock,
  blocked: AlertTriangle,
  done: CheckCircle2,
};

const PRIORITY_ICONS: Record<TaskPriority, string> = {
  low: "bg-zinc-500/20",
  medium: "bg-blue-500/20",
  high: "bg-amber-500/20",
  critical: "bg-red-500/20",
};

export default function ProjectManagement({ dealId }: ProjectManagementProps) {
  const [tasks, setTasks] = useState<DealTask[]>([]);
  const [milestones, setMilestones] = useState<DealMilestone[]>([]);
  const [dealStatus, setDealStatus] = useState<DealStatus>("sourcing");
  const [loading, setLoading] = useState(true);
  const [milestonesExpanded, setMilestonesExpanded] = useState(true);
  const [tasksExpanded, setTasksExpanded] = useState(true);
  const [timelineExpanded, setTimelineExpanded] = useState(true);
  const [filterStatus, setFilterStatus] = useState<TaskStatus | "all">("all");
  const [filterMilestone, setFilterMilestone] = useState<string | "all">("all");

  const [suggesting, setSuggesting] = useState(false);
  const [aiSuggesting, setAiSuggesting] = useState(false);

  // Dialog state
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [milestoneDialogOpen, setMilestoneDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<DealTask | null>(null);
  const [editingMilestone, setEditingMilestone] = useState<DealMilestone | null>(null);

  // Form state
  const [taskForm, setTaskForm] = useState({
    title: "",
    description: "",
    assignee: "",
    due_date: "",
    priority: "medium" as TaskPriority,
    status: "todo" as TaskStatus,
    milestone_id: "",
  });
  const [milestoneForm, setMilestoneForm] = useState({
    title: "",
    stage: "",
    target_date: "",
  });

  const loadData = useCallback(async (isInitial = false) => {
    try {
      const dealRes = await fetch(`/api/deals/${dealId}`);
      const dealJson = await dealRes.json();
      if (dealJson.data?.status) setDealStatus(dealJson.data.status);

      if (isInitial) {
        // Auto-seed defaults on first visit (no-ops if already seeded)
        const seedRes = await fetch(`/api/deals/${dealId}/tasks/seed`, { method: "POST" });
        const seedJson = await seedRes.json();
        if (seedJson.data) {
          setTasks(seedJson.data.tasks || []);
          setMilestones(seedJson.data.milestones || []);
          return;
        }
      }

      const [tasksRes, milestonesRes] = await Promise.all([
        fetch(`/api/deals/${dealId}/tasks`),
        fetch(`/api/deals/${dealId}/milestones`),
      ]);
      const [tasksJson, milestonesJson] = await Promise.all([
        tasksRes.json(),
        milestonesRes.json(),
      ]);
      setTasks(tasksJson.data || []);
      setMilestones(milestonesJson.data || []);
    } catch (error) {
      console.error("Failed to load project data:", error);
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => {
    loadData(true);
  }, [loadData]);

  // ── Stats ──
  const today = new Date().toISOString().split("T")[0];
  const totalTasks = tasks.length;
  const doneTasks = tasks.filter((t) => t.status === "done").length;
  const inProgressTasks = tasks.filter((t) => t.status === "in_progress").length;
  const overdueTasks = tasks.filter(
    (t) => t.due_date && t.due_date < today && t.status !== "done"
  ).length;
  const completionPct = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

  // ── Filtered tasks ──
  const filteredTasks = tasks.filter((t) => {
    if (filterStatus !== "all" && t.status !== filterStatus) return false;
    if (filterMilestone !== "all" && (t.milestone_id || "") !== filterMilestone) return false;
    return true;
  });

  // ── Task CRUD ──
  const handleCreateTask = async () => {
    if (!taskForm.title.trim()) return;
    try {
      await fetch(`/api/deals/${dealId}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...taskForm,
          milestone_id: taskForm.milestone_id || null,
        }),
      });
      setTaskDialogOpen(false);
      resetTaskForm();
      loadData();
    } catch (error) {
      console.error("Failed to create task:", error);
    }
  };

  const handleUpdateTask = async () => {
    if (!editingTask || !taskForm.title.trim()) return;
    try {
      await fetch(`/api/deals/${dealId}/tasks/${editingTask.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...taskForm,
          milestone_id: taskForm.milestone_id || null,
        }),
      });
      setTaskDialogOpen(false);
      setEditingTask(null);
      resetTaskForm();
      loadData();
    } catch (error) {
      console.error("Failed to update task:", error);
    }
  };

  const handleCycleTaskStatus = async (task: DealTask) => {
    const currentIdx = STATUS_CYCLE.indexOf(task.status);
    const nextStatus = STATUS_CYCLE[(currentIdx + 1) % STATUS_CYCLE.length];
    try {
      await fetch(`/api/deals/${dealId}/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      loadData();
    } catch (error) {
      console.error("Failed to update task status:", error);
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    try {
      await fetch(`/api/deals/${dealId}/tasks/${taskId}`, { method: "DELETE" });
      loadData();
    } catch (error) {
      console.error("Failed to delete task:", error);
    }
  };

  // ── Milestone CRUD ──
  const handleCreateMilestone = async () => {
    if (!milestoneForm.title.trim()) return;
    try {
      await fetch(`/api/deals/${dealId}/milestones`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...milestoneForm,
          stage: milestoneForm.stage || null,
        }),
      });
      setMilestoneDialogOpen(false);
      resetMilestoneForm();
      loadData();
    } catch (error) {
      console.error("Failed to create milestone:", error);
    }
  };

  const handleUpdateMilestone = async () => {
    if (!editingMilestone || !milestoneForm.title.trim()) return;
    try {
      await fetch(`/api/deals/${dealId}/milestones/${editingMilestone.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...milestoneForm,
          stage: milestoneForm.stage || null,
        }),
      });
      setMilestoneDialogOpen(false);
      setEditingMilestone(null);
      resetMilestoneForm();
      loadData();
    } catch (error) {
      console.error("Failed to update milestone:", error);
    }
  };

  const handleToggleMilestone = async (milestone: DealMilestone) => {
    const completed_at = milestone.completed_at ? null : new Date().toISOString();
    try {
      await fetch(`/api/deals/${dealId}/milestones/${milestone.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed_at }),
      });
      loadData();
    } catch (error) {
      console.error("Failed to toggle milestone:", error);
    }
  };

  const handleDeleteMilestone = async (milestoneId: string) => {
    try {
      await fetch(`/api/deals/${dealId}/milestones/${milestoneId}`, { method: "DELETE" });
      loadData();
    } catch (error) {
      console.error("Failed to delete milestone:", error);
    }
  };

  const handleSuggestMilestones = async () => {
    setSuggesting(true);
    try {
      const suggestions = STAGE_MILESTONE_TEMPLATES[dealStatus] || [];
      const existingTitles = new Set(milestones.map((m) => m.title.toLowerCase()));
      const newSuggestions = suggestions.filter((s) => !existingTitles.has(s.toLowerCase()));

      if (newSuggestions.length === 0) return;

      for (const title of newSuggestions) {
        await fetch(`/api/deals/${dealId}/milestones`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, stage: dealStatus }),
        });
      }
      await loadData();
    } catch (error) {
      console.error("Failed to suggest milestones:", error);
    } finally {
      setSuggesting(false);
    }
  };

  const handleAiSuggest = async () => {
    setAiSuggesting(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/tasks/ai-suggest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const json = await res.json();
      if (json.error) {
        alert(json.error);
        return;
      }
      await loadData();
    } catch (error) {
      console.error("Failed to get AI suggestions:", error);
    } finally {
      setAiSuggesting(false);
    }
  };

  // ── Form helpers ──
  const resetTaskForm = () => {
    setTaskForm({ title: "", description: "", assignee: "", due_date: "", priority: "medium", status: "todo", milestone_id: "" });
  };

  const resetMilestoneForm = () => {
    setMilestoneForm({ title: "", stage: "", target_date: "" });
  };

  const openEditTask = (task: DealTask) => {
    setEditingTask(task);
    setTaskForm({
      title: task.title,
      description: task.description || "",
      assignee: task.assignee || "",
      due_date: task.due_date || "",
      priority: task.priority,
      status: task.status,
      milestone_id: task.milestone_id || "",
    });
    setTaskDialogOpen(true);
  };

  const openEditMilestone = (milestone: DealMilestone) => {
    setEditingMilestone(milestone);
    setMilestoneForm({
      title: milestone.title,
      stage: milestone.stage || "",
      target_date: milestone.target_date || "",
    });
    setMilestoneDialogOpen(true);
  };

  // ── Timeline helpers ──
  const allDates = [
    ...tasks.filter((t) => t.due_date).map((t) => t.due_date!),
    ...milestones.filter((m) => m.target_date).map((m) => m.target_date!),
  ];
  const minDate = allDates.length > 0 ? allDates.sort()[0] : today;
  const maxDate = allDates.length > 0 ? allDates.sort().pop()! : today;
  const timelineRange = Math.max(
    1,
    (new Date(maxDate).getTime() - new Date(minDate).getTime()) / (1000 * 60 * 60 * 24)
  );

  const getTimelinePosition = (date: string) => {
    const dayOffset = (new Date(date).getTime() - new Date(minDate).getTime()) / (1000 * 60 * 60 * 24);
    return Math.min(100, Math.max(0, (dayOffset / timelineRange) * 100));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-pulse text-muted-foreground text-sm">Loading project data...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Summary Stats ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total Tasks" value={totalTasks} icon={Target} />
        <StatCard label="Overdue" value={overdueTasks} icon={AlertTriangle} className={overdueTasks > 0 ? "border-red-500/30" : ""} valueClassName={overdueTasks > 0 ? "text-red-400" : ""} />
        <StatCard label="In Progress" value={inProgressTasks} icon={Clock} valueClassName="text-blue-400" />
        <StatCard label="Done" value={doneTasks} icon={CheckCircle2} valueClassName="text-emerald-400" />
      </div>

      {/* Overall progress */}
      {totalTasks > 0 && (
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Overall Progress</span>
            <span>{completionPct}%</span>
          </div>
          <Progress value={completionPct} className="h-2" />
        </div>
      )}

      {/* ── Milestones Section ── */}
      <section className="border border-border/50 rounded-lg bg-card/50">
        <button
          onClick={() => setMilestonesExpanded(!milestonesExpanded)}
          className="flex items-center gap-2 w-full px-4 py-3 text-left hover:bg-muted/30 transition-colors rounded-t-lg"
        >
          {milestonesExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          <Diamond className="h-4 w-4 text-primary" />
          <span className="font-medium text-sm">Milestones</span>
          <Badge variant="secondary" className="ml-auto text-2xs">
            {milestones.filter((m) => m.completed_at).length}/{milestones.length}
          </Badge>
        </button>

        {milestonesExpanded && (
          <div className="px-4 pb-4 space-y-3">
            <div className="flex gap-2">
              <Dialog open={milestoneDialogOpen} onOpenChange={(open) => {
                setMilestoneDialogOpen(open);
                if (!open) { setEditingMilestone(null); resetMilestoneForm(); }
              }}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" className="text-xs">
                    <Plus className="h-3 w-3 mr-1" /> Add Milestone
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{editingMilestone ? "Edit Milestone" : "New Milestone"}</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-3 pt-2">
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">Title</label>
                      <input
                        className="w-full bg-muted/50 border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                        value={milestoneForm.title}
                        onChange={(e) => setMilestoneForm({ ...milestoneForm, title: e.target.value })}
                        placeholder="e.g., Title review complete"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">Stage</label>
                        <select
                          className="w-full bg-muted/50 border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                          value={milestoneForm.stage}
                          onChange={(e) => setMilestoneForm({ ...milestoneForm, stage: e.target.value })}
                        >
                          <option value="">No stage</option>
                          {Object.entries(DEAL_STAGE_LABELS).map(([key, label]) => (
                            <option key={key} value={key}>{label}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">Target Date</label>
                        <input
                          type="date"
                          className="w-full bg-muted/50 border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                          value={milestoneForm.target_date}
                          onChange={(e) => setMilestoneForm({ ...milestoneForm, target_date: e.target.value })}
                        />
                      </div>
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                      <Button variant="ghost" size="sm" onClick={() => { setMilestoneDialogOpen(false); setEditingMilestone(null); resetMilestoneForm(); }}>
                        Cancel
                      </Button>
                      <Button size="sm" onClick={editingMilestone ? handleUpdateMilestone : handleCreateMilestone}>
                        {editingMilestone ? "Save" : "Create"}
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>

              <Button variant="outline" size="sm" className="text-xs" onClick={handleSuggestMilestones} disabled={suggesting}>
                {suggesting ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Sparkles className="h-3 w-3 mr-1" />}
                Suggest for {DEAL_STAGE_LABELS[dealStatus]}
              </Button>

              <Button variant="outline" size="sm" className="text-xs" onClick={handleAiSuggest} disabled={aiSuggesting}>
                {aiSuggesting ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <FileSearch className="h-3 w-3 mr-1" />}
                {aiSuggesting ? "Analyzing docs..." : "AI Suggest from Docs"}
              </Button>
            </div>

            {milestones.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">
                No milestones yet. Add one or use &quot;Suggest&quot; to get started.
              </p>
            ) : (
              <div className="space-y-1">
                {milestones.map((m) => (
                  <div
                    key={m.id}
                    className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-muted/30 transition-colors group"
                  >
                    <button
                      onClick={() => handleToggleMilestone(m)}
                      className="flex-shrink-0"
                    >
                      {m.completed_at ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                      ) : (
                        <Diamond className="h-4 w-4 text-primary/60" />
                      )}
                    </button>
                    <button
                      onClick={() => openEditMilestone(m)}
                      className={cn(
                        "text-sm text-left flex-1 min-w-0 truncate",
                        m.completed_at && "line-through text-muted-foreground"
                      )}
                    >
                      {m.title}
                    </button>
                    {m.stage && (
                      <Badge variant="secondary" className="text-2xs flex-shrink-0">
                        {DEAL_STAGE_LABELS[m.stage as DealStatus] || m.stage}
                      </Badge>
                    )}
                    {m.target_date && (
                      <span className={cn(
                        "text-2xs flex-shrink-0",
                        !m.completed_at && m.target_date < today ? "text-red-400" : "text-muted-foreground"
                      )}>
                        <Calendar className="h-3 w-3 inline mr-0.5" />
                        {new Date(m.target_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </span>
                    )}
                    <button
                      onClick={() => handleDeleteMilestone(m.id)}
                      className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400 transition-all flex-shrink-0"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* ── Tasks Section ── */}
      <section className="border border-border/50 rounded-lg bg-card/50">
        <button
          onClick={() => setTasksExpanded(!tasksExpanded)}
          className="flex items-center gap-2 w-full px-4 py-3 text-left hover:bg-muted/30 transition-colors rounded-t-lg"
        >
          {tasksExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          <Flag className="h-4 w-4 text-primary" />
          <span className="font-medium text-sm">Tasks</span>
          <Badge variant="secondary" className="ml-auto text-2xs">
            {doneTasks}/{totalTasks}
          </Badge>
        </button>

        {tasksExpanded && (
          <div className="px-4 pb-4 space-y-3">
            {/* Actions & Filters */}
            <div className="flex flex-wrap items-center gap-2">
              <Dialog open={taskDialogOpen} onOpenChange={(open) => {
                setTaskDialogOpen(open);
                if (!open) { setEditingTask(null); resetTaskForm(); }
              }}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" className="text-xs">
                    <Plus className="h-3 w-3 mr-1" /> Add Task
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{editingTask ? "Edit Task" : "New Task"}</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-3 pt-2">
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">Title</label>
                      <input
                        className="w-full bg-muted/50 border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                        value={taskForm.title}
                        onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })}
                        placeholder="e.g., Review Phase I ESA report"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">Description</label>
                      <textarea
                        className="w-full bg-muted/50 border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                        rows={2}
                        value={taskForm.description}
                        onChange={(e) => setTaskForm({ ...taskForm, description: e.target.value })}
                        placeholder="Optional details..."
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">Assignee</label>
                        <input
                          className="w-full bg-muted/50 border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                          value={taskForm.assignee}
                          onChange={(e) => setTaskForm({ ...taskForm, assignee: e.target.value })}
                          placeholder="Name"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">Due Date</label>
                        <input
                          type="date"
                          className="w-full bg-muted/50 border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                          value={taskForm.due_date}
                          onChange={(e) => setTaskForm({ ...taskForm, due_date: e.target.value })}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">Priority</label>
                        <select
                          className="w-full bg-muted/50 border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                          value={taskForm.priority}
                          onChange={(e) => setTaskForm({ ...taskForm, priority: e.target.value as TaskPriority })}
                        >
                          {Object.entries(TASK_PRIORITY_CONFIG).map(([key, cfg]) => (
                            <option key={key} value={key}>{cfg.label}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">Status</label>
                        <select
                          className="w-full bg-muted/50 border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                          value={taskForm.status}
                          onChange={(e) => setTaskForm({ ...taskForm, status: e.target.value as TaskStatus })}
                        >
                          {Object.entries(TASK_STATUS_CONFIG).map(([key, cfg]) => (
                            <option key={key} value={key}>{cfg.label}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">Milestone</label>
                        <select
                          className="w-full bg-muted/50 border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                          value={taskForm.milestone_id}
                          onChange={(e) => setTaskForm({ ...taskForm, milestone_id: e.target.value })}
                        >
                          <option value="">None</option>
                          {milestones.map((m) => (
                            <option key={m.id} value={m.id}>{m.title}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                      <Button variant="ghost" size="sm" onClick={() => { setTaskDialogOpen(false); setEditingTask(null); resetTaskForm(); }}>
                        Cancel
                      </Button>
                      <Button size="sm" onClick={editingTask ? handleUpdateTask : handleCreateTask}>
                        {editingTask ? "Save" : "Create"}
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>

              <Button variant="outline" size="sm" className="text-xs" onClick={handleAiSuggest} disabled={aiSuggesting}>
                {aiSuggesting ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <FileSearch className="h-3 w-3 mr-1" />}
                {aiSuggesting ? "Analyzing..." : "AI from Docs"}
              </Button>

              <div className="flex items-center gap-1 ml-auto">
                <span className="text-2xs text-muted-foreground mr-1">Filter:</span>
                <select
                  className="bg-muted/50 border border-border rounded px-2 py-1 text-2xs focus:outline-none"
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value as TaskStatus | "all")}
                >
                  <option value="all">All Status</option>
                  {Object.entries(TASK_STATUS_CONFIG).map(([key, cfg]) => (
                    <option key={key} value={key}>{cfg.label}</option>
                  ))}
                </select>
                {milestones.length > 0 && (
                  <select
                    className="bg-muted/50 border border-border rounded px-2 py-1 text-2xs focus:outline-none"
                    value={filterMilestone}
                    onChange={(e) => setFilterMilestone(e.target.value)}
                  >
                    <option value="all">All Milestones</option>
                    <option value="">No Milestone</option>
                    {milestones.map((m) => (
                      <option key={m.id} value={m.id}>{m.title}</option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            {/* Task List */}
            {filteredTasks.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">
                {totalTasks === 0 ? "No tasks yet. Add one to get started." : "No tasks match the current filters."}
              </p>
            ) : (
              <div className="space-y-1">
                {filteredTasks.map((task) => {
                  const StatusIcon = STATUS_ICONS[task.status];
                  const isOverdue = task.due_date && task.due_date < today && task.status !== "done";
                  const milestoneName = milestones.find((m) => m.id === task.milestone_id)?.title;

                  return (
                    <div
                      key={task.id}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2 rounded-md hover:bg-muted/30 transition-colors group",
                        isOverdue && "border-l-2 border-red-500/50"
                      )}
                    >
                      {/* Status toggle */}
                      <button onClick={() => handleCycleTaskStatus(task)} className="flex-shrink-0" title={`Status: ${TASK_STATUS_CONFIG[task.status].label} (click to cycle)`}>
                        <StatusIcon className={cn("h-4 w-4", TASK_STATUS_CONFIG[task.status].color.replace(/bg-\S+/, "").replace("text-", "text-"))} />
                      </button>

                      {/* Priority indicator */}
                      <span className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", PRIORITY_ICONS[task.priority])} title={TASK_PRIORITY_CONFIG[task.priority].label} />

                      {/* Title */}
                      <button
                        onClick={() => openEditTask(task)}
                        className={cn(
                          "text-sm text-left flex-1 min-w-0 truncate",
                          task.status === "done" && "line-through text-muted-foreground"
                        )}
                      >
                        {task.title}
                      </button>

                      {/* Milestone badge */}
                      {milestoneName && (
                        <Badge variant="outline" className="text-2xs flex-shrink-0 max-w-[100px] truncate">
                          {milestoneName}
                        </Badge>
                      )}

                      {/* Assignee */}
                      {task.assignee && (
                        <span className="text-2xs text-muted-foreground flex-shrink-0 flex items-center gap-0.5">
                          <User className="h-3 w-3" />
                          {task.assignee}
                        </span>
                      )}

                      {/* Due date */}
                      {task.due_date && (
                        <span className={cn(
                          "text-2xs flex-shrink-0",
                          isOverdue ? "text-red-400 font-medium" : "text-muted-foreground"
                        )}>
                          <Calendar className="h-3 w-3 inline mr-0.5" />
                          {new Date(task.due_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        </span>
                      )}

                      {/* Delete */}
                      <button
                        onClick={() => handleDeleteTask(task.id)}
                        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400 transition-all flex-shrink-0"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </section>

      {/* ── Timeline View ── */}
      {allDates.length > 0 && (
        <section className="border border-border/50 rounded-lg bg-card/50">
          <button
            onClick={() => setTimelineExpanded(!timelineExpanded)}
            className="flex items-center gap-2 w-full px-4 py-3 text-left hover:bg-muted/30 transition-colors rounded-t-lg"
          >
            {timelineExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
            <Calendar className="h-4 w-4 text-primary" />
            <span className="font-medium text-sm">Timeline</span>
          </button>

          {timelineExpanded && (
            <div className="px-4 pb-4">
              {/* Date range labels */}
              <div className="flex justify-between text-2xs text-muted-foreground mb-2">
                <span>{new Date(minDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                <span>{new Date(maxDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
              </div>

              {/* Timeline bar */}
              <div className="relative h-2 bg-muted/50 rounded-full mb-4">
                {/* Today marker */}
                {today >= minDate && today <= maxDate && (
                  <div
                    className="absolute top-0 w-0.5 h-full bg-foreground/30"
                    style={{ left: `${getTimelinePosition(today)}%` }}
                    title="Today"
                  />
                )}
              </div>

              {/* Milestones on timeline */}
              {milestones.filter((m) => m.target_date).length > 0 && (
                <div className="mb-3">
                  <span className="text-2xs text-muted-foreground font-medium mb-1 block">Milestones</span>
                  <div className="relative h-6">
                    {milestones.filter((m) => m.target_date).map((m) => (
                      <div
                        key={m.id}
                        className="absolute top-0 transform -translate-x-1/2"
                        style={{ left: `${getTimelinePosition(m.target_date!)}%` }}
                        title={`${m.title} — ${new Date(m.target_date! + "T00:00:00").toLocaleDateString()}`}
                      >
                        <Diamond className={cn("h-3.5 w-3.5", m.completed_at ? "text-emerald-400 fill-emerald-400" : "text-primary fill-primary/20")} />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Tasks on timeline */}
              {tasks.filter((t) => t.due_date).length > 0 && (
                <div>
                  <span className="text-2xs text-muted-foreground font-medium mb-1 block">Tasks</span>
                  <div className="space-y-1">
                    {tasks.filter((t) => t.due_date).map((t) => {
                      const pos = getTimelinePosition(t.due_date!);
                      const isOverdue = t.due_date! < today && t.status !== "done";
                      return (
                        <div key={t.id} className="relative h-5 flex items-center">
                          <div
                            className={cn(
                              "absolute h-1.5 rounded-full",
                              t.status === "done" ? "bg-emerald-500/40" :
                              isOverdue ? "bg-red-500/40" :
                              "bg-blue-500/40"
                            )}
                            style={{ left: "0%", width: `${Math.max(1, pos)}%` }}
                          />
                          <div
                            className="absolute transform -translate-x-1/2"
                            style={{ left: `${pos}%` }}
                          >
                            <div
                              className={cn(
                                "w-2 h-2 rounded-full",
                                t.status === "done" ? "bg-emerald-400" :
                                isOverdue ? "bg-red-400" :
                                "bg-blue-400"
                              )}
                              title={`${t.title} — due ${new Date(t.due_date! + "T00:00:00").toLocaleDateString()}`}
                            />
                          </div>
                          <span className="text-2xs text-muted-foreground ml-2 pl-1 truncate" style={{ paddingLeft: `${Math.max(1, pos) + 2}%` }}>
                            {t.title}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

// ── Stat Card ──
function StatCard({
  label,
  value,
  icon: Icon,
  className,
  valueClassName,
}: {
  label: string;
  value: number;
  icon: typeof Circle;
  className?: string;
  valueClassName?: string;
}) {
  return (
    <div className={cn("border border-border/50 rounded-lg bg-card/50 px-4 py-3", className)}>
      <div className="flex items-center gap-2 text-muted-foreground mb-1">
        <Icon className="h-3.5 w-3.5" />
        <span className="text-2xs font-medium">{label}</span>
      </div>
      <span className={cn("text-xl font-bold", valueClassName)}>{value}</span>
    </div>
  );
}
