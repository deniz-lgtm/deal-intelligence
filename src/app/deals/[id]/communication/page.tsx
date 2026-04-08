"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Loader2,
  Plus,
  Trash2,
  Sparkles,
  Mail,
  Phone,
  MessageSquare,
  Users,
  Video,
  FileText,
  ArrowDownLeft,
  ArrowUpRight,
  HelpCircle,
  CheckCircle2,
  Inbox,
  Pencil,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  DEAL_PIPELINE,
  DEAL_STAGE_LABELS,
  STAKEHOLDER_LABELS,
  COMMUNICATION_CHANNEL_LABELS,
  COMMUNICATION_STATUS_CONFIG,
  QUESTION_STATUS_CONFIG,
} from "@/lib/types";
import type {
  DealCommunication,
  DealQuestion,
  StakeholderType,
  CommunicationChannel,
  CommunicationDirection,
  CommunicationStatus,
  QuestionStatus,
  DealStatus,
} from "@/lib/types";

const CHANNEL_ICONS: Record<CommunicationChannel, typeof Mail> = {
  email: Mail,
  phone: Phone,
  text: MessageSquare,
  meeting: Users,
  video: Video,
  letter: FileText,
  other: MessageSquare,
};

const QUESTION_STATUS_CYCLE: QuestionStatus[] = ["open", "asked", "answered", "na"];

function formatDate(date: string | null): string {
  if (!date) return "";
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(date: string | null): string {
  if (!date) return "";
  return new Date(date).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function toLocalInputValue(date: string | null): string {
  if (!date) return "";
  const d = new Date(date);
  const tzOffset = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - tzOffset).toISOString().slice(0, 16);
}

export default function CommunicationPage({ params }: { params: { id: string } }) {
  const [tab, setTab] = useState<"log" | "questions">("log");
  const [communications, setCommunications] = useState<DealCommunication[]>([]);
  const [questions, setQuestions] = useState<DealQuestion[]>([]);
  const [loading, setLoading] = useState(true);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [commsRes, questionsRes] = await Promise.all([
        fetch(`/api/deals/${params.id}/communications`),
        fetch(`/api/deals/${params.id}/questions`),
      ]);
      const commsJson = await commsRes.json();
      const questionsJson = await questionsRes.json();
      setCommunications(commsJson.data || []);
      setQuestions(questionsJson.data || []);
    } catch (err) {
      console.error("Failed to load communication data:", err);
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  return (
    <div className="space-y-6 animate-fade-up">
      <div>
        <h1 className="font-display text-xl">Communication</h1>
        <p className="text-sm text-muted-foreground">
          Track stakeholder correspondence and questions to ask brokers, sellers, and others at each phase of the deal.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-border/40">
        <button
          onClick={() => setTab("log")}
          className={cn(
            "px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px",
            tab === "log"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          <Inbox className="inline h-4 w-4 mr-1.5 -mt-0.5" />
          Correspondence Log
          <span className="ml-2 text-2xs text-muted-foreground">{communications.length}</span>
        </button>
        <button
          onClick={() => setTab("questions")}
          className={cn(
            "px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px",
            tab === "questions"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          <HelpCircle className="inline h-4 w-4 mr-1.5 -mt-0.5" />
          Questions
          <span className="ml-2 text-2xs text-muted-foreground">{questions.length}</span>
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : tab === "log" ? (
        <CorrespondenceLog
          dealId={params.id}
          communications={communications}
          onChange={loadAll}
        />
      ) : (
        <QuestionsPanel dealId={params.id} questions={questions} onChange={loadAll} />
      )}
    </div>
  );
}

// ─── Correspondence Log ───────────────────────────────────────────────────────

function CorrespondenceLog({
  dealId,
  communications,
  onChange,
}: {
  dealId: string;
  communications: DealCommunication[];
  onChange: () => void;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<DealCommunication | null>(null);
  const [filterType, setFilterType] = useState<StakeholderType | "all">("all");
  const [saving, setSaving] = useState(false);

  const emptyForm = {
    stakeholder_type: "broker" as StakeholderType,
    stakeholder_name: "",
    channel: "email" as CommunicationChannel,
    direction: "outbound" as CommunicationDirection,
    subject: "",
    summary: "",
    status: "open" as CommunicationStatus,
    occurred_at: toLocalInputValue(new Date().toISOString()),
    follow_up_at: "",
  };
  const [form, setForm] = useState(emptyForm);

  const openNew = () => {
    setEditing(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (c: DealCommunication) => {
    setEditing(c);
    setForm({
      stakeholder_type: c.stakeholder_type,
      stakeholder_name: c.stakeholder_name,
      channel: c.channel,
      direction: c.direction,
      subject: c.subject,
      summary: c.summary,
      status: c.status,
      occurred_at: toLocalInputValue(c.occurred_at),
      follow_up_at: toLocalInputValue(c.follow_up_at),
    });
    setDialogOpen(true);
  };

  const save = async () => {
    if (!form.subject.trim() && !form.summary.trim()) return;
    setSaving(true);
    try {
      const payload = {
        ...form,
        occurred_at: form.occurred_at ? new Date(form.occurred_at).toISOString() : new Date().toISOString(),
        follow_up_at: form.follow_up_at ? new Date(form.follow_up_at).toISOString() : null,
      };
      const url = editing
        ? `/api/deals/${dealId}/communications/${editing.id}`
        : `/api/deals/${dealId}/communications`;
      const method = editing ? "PATCH" : "POST";
      await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setDialogOpen(false);
      onChange();
    } catch (err) {
      console.error("Failed to save communication:", err);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this entry?")) return;
    await fetch(`/api/deals/${dealId}/communications/${id}`, { method: "DELETE" });
    onChange();
  };

  const filtered = communications.filter(
    (c) => filterType === "all" || c.stakeholder_type === filterType
  );

  const stakeholderTypes = Array.from(
    new Set(communications.map((c) => c.stakeholder_type))
  );

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value as StakeholderType | "all")}
          className="h-9 rounded-lg border border-border bg-background px-2.5 text-sm"
        >
          <option value="all">All stakeholders</option>
          {stakeholderTypes.map((t) => (
            <option key={t} value={t}>
              {STAKEHOLDER_LABELS[t]}
            </option>
          ))}
        </select>
        <div className="flex-1" />
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={openNew} size="sm">
              <Plus className="h-4 w-4 mr-1.5" />
              Log Communication
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle>
                {editing ? "Edit communication" : "Log a communication"}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Stakeholder type">
                  <select
                    value={form.stakeholder_type}
                    onChange={(e) =>
                      setForm({ ...form, stakeholder_type: e.target.value as StakeholderType })
                    }
                    className="w-full h-9 rounded-lg border border-border bg-background px-2.5 text-sm"
                  >
                    {Object.entries(STAKEHOLDER_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </FormField>
                <FormField label="Name / contact">
                  <input
                    type="text"
                    value={form.stakeholder_name}
                    onChange={(e) => setForm({ ...form, stakeholder_name: e.target.value })}
                    placeholder="e.g. Jane Doe @ CBRE"
                    className="w-full h-9 rounded-lg border border-border bg-background px-2.5 text-sm"
                  />
                </FormField>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <FormField label="Channel">
                  <select
                    value={form.channel}
                    onChange={(e) =>
                      setForm({ ...form, channel: e.target.value as CommunicationChannel })
                    }
                    className="w-full h-9 rounded-lg border border-border bg-background px-2.5 text-sm"
                  >
                    {Object.entries(COMMUNICATION_CHANNEL_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </FormField>
                <FormField label="Direction">
                  <select
                    value={form.direction}
                    onChange={(e) =>
                      setForm({ ...form, direction: e.target.value as CommunicationDirection })
                    }
                    className="w-full h-9 rounded-lg border border-border bg-background px-2.5 text-sm"
                  >
                    <option value="outbound">Outbound</option>
                    <option value="inbound">Inbound</option>
                  </select>
                </FormField>
                <FormField label="Status">
                  <select
                    value={form.status}
                    onChange={(e) =>
                      setForm({ ...form, status: e.target.value as CommunicationStatus })
                    }
                    className="w-full h-9 rounded-lg border border-border bg-background px-2.5 text-sm"
                  >
                    {Object.entries(COMMUNICATION_STATUS_CONFIG).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                </FormField>
              </div>

              <FormField label="Subject">
                <input
                  type="text"
                  value={form.subject}
                  onChange={(e) => setForm({ ...form, subject: e.target.value })}
                  placeholder="Short subject line"
                  className="w-full h-9 rounded-lg border border-border bg-background px-2.5 text-sm"
                />
              </FormField>

              <FormField label="Summary / notes">
                <textarea
                  value={form.summary}
                  onChange={(e) => setForm({ ...form, summary: e.target.value })}
                  rows={4}
                  placeholder="What was discussed, decided, or asked?"
                  className="w-full rounded-lg border border-border bg-background px-2.5 py-2 text-sm"
                />
              </FormField>

              <div className="grid grid-cols-2 gap-3">
                <FormField label="Occurred at">
                  <input
                    type="datetime-local"
                    value={form.occurred_at}
                    onChange={(e) => setForm({ ...form, occurred_at: e.target.value })}
                    className="w-full h-9 rounded-lg border border-border bg-background px-2.5 text-sm"
                  />
                </FormField>
                <FormField label="Follow-up by">
                  <input
                    type="datetime-local"
                    value={form.follow_up_at}
                    onChange={(e) => setForm({ ...form, follow_up_at: e.target.value })}
                    className="w-full h-9 rounded-lg border border-border bg-background px-2.5 text-sm"
                  />
                </FormField>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" size="sm" onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
                <Button size="sm" onClick={save} disabled={saving}>
                  {saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                  {editing ? "Save" : "Log"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* List */}
      <div className="border border-border/60 rounded-xl bg-card overflow-hidden shadow-card">
        {filtered.length === 0 ? (
          <div className="p-10 text-center">
            <Inbox className="h-8 w-8 mx-auto text-muted-foreground/60 mb-2" />
            <p className="text-sm text-muted-foreground">
              No correspondence logged yet.
            </p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              Track every email, call, and meeting with brokers, sellers, lenders, and partners.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border/20">
            {filtered.map((c) => {
              const Icon = CHANNEL_ICONS[c.channel] || MessageSquare;
              const statusCfg = COMMUNICATION_STATUS_CONFIG[c.status];
              return (
                <div
                  key={c.id}
                  className="flex items-start gap-3 px-4 py-3 hover:bg-muted/10 transition-colors group"
                >
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 bg-muted/40 text-muted-foreground">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-2xs uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground font-medium">
                        {STAKEHOLDER_LABELS[c.stakeholder_type]}
                      </span>
                      {c.stakeholder_name && (
                        <span className="text-sm font-medium">{c.stakeholder_name}</span>
                      )}
                      {c.direction === "inbound" ? (
                        <ArrowDownLeft className="h-3 w-3 text-blue-400" />
                      ) : (
                        <ArrowUpRight className="h-3 w-3 text-amber-400" />
                      )}
                      <span className={cn("text-2xs px-2 py-0.5 rounded-full font-medium", statusCfg.color)}>
                        {statusCfg.label}
                      </span>
                    </div>
                    {c.subject && (
                      <p className="text-sm font-medium mt-1">{c.subject}</p>
                    )}
                    {c.summary && (
                      <p className="text-sm text-muted-foreground mt-0.5 whitespace-pre-wrap">
                        {c.summary}
                      </p>
                    )}
                    <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                      <span>{formatDateTime(c.occurred_at)}</span>
                      {c.follow_up_at && (
                        <span className="text-amber-400">
                          Follow up by {formatDate(c.follow_up_at)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                    <button
                      onClick={() => openEdit(c)}
                      className="p-1.5 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground"
                      aria-label="Edit"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => remove(c.id)}
                      className="p-1.5 rounded hover:bg-muted/50 text-muted-foreground hover:text-red-400"
                      aria-label="Delete"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Questions Panel ──────────────────────────────────────────────────────────

function QuestionsPanel({
  dealId,
  questions,
  onChange,
}: {
  dealId: string;
  questions: DealQuestion[];
  onChange: () => void;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [suggestPhase, setSuggestPhase] = useState<DealStatus>("sourcing");
  const [suggesting, setSuggesting] = useState(false);
  const [saving, setSaving] = useState(false);

  const emptyForm = {
    target_role: "broker" as StakeholderType,
    phase: "sourcing" as DealStatus,
    question: "",
  };
  const [form, setForm] = useState(emptyForm);

  const addQuestion = async () => {
    if (!form.question.trim()) return;
    setSaving(true);
    try {
      await fetch(`/api/deals/${dealId}/questions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          source: "manual",
          status: "open",
        }),
      });
      setForm({ ...emptyForm, phase: form.phase, target_role: form.target_role });
      setDialogOpen(false);
      onChange();
    } catch (err) {
      console.error("Failed to add question:", err);
    } finally {
      setSaving(false);
    }
  };

  const generateForPhase = async () => {
    setSuggesting(true);
    try {
      await fetch(`/api/deals/${dealId}/questions/suggest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phase: suggestPhase, persist: true }),
      });
      onChange();
    } catch (err) {
      console.error("Failed to generate questions:", err);
    } finally {
      setSuggesting(false);
    }
  };

  const updateQuestion = async (id: string, updates: Partial<DealQuestion>) => {
    await fetch(`/api/deals/${dealId}/questions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    onChange();
  };

  const removeQuestion = async (id: string) => {
    if (!confirm("Delete this question?")) return;
    await fetch(`/api/deals/${dealId}/questions/${id}`, { method: "DELETE" });
    onChange();
  };

  // Group by phase
  const grouped = DEAL_PIPELINE.map((phase) => ({
    phase,
    items: questions.filter((q) => q.phase === phase),
  }));

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 border border-border/60 rounded-lg pl-2 pr-1 py-1 bg-card">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs text-muted-foreground">Generate for</span>
          <select
            value={suggestPhase}
            onChange={(e) => setSuggestPhase(e.target.value as DealStatus)}
            className="h-7 rounded border border-border bg-background px-1.5 text-xs"
          >
            {DEAL_PIPELINE.map((p) => (
              <option key={p} value={p}>
                {DEAL_STAGE_LABELS[p]}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs px-2"
            onClick={generateForPhase}
            disabled={suggesting}
          >
            {suggesting ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              "Generate"
            )}
          </Button>
        </div>
        <div className="flex-1" />
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" onClick={() => setDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-1.5" />
              Add Question
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add a question</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Phase">
                  <select
                    value={form.phase}
                    onChange={(e) => setForm({ ...form, phase: e.target.value as DealStatus })}
                    className="w-full h-9 rounded-lg border border-border bg-background px-2.5 text-sm"
                  >
                    {DEAL_PIPELINE.map((p) => (
                      <option key={p} value={p}>
                        {DEAL_STAGE_LABELS[p]}
                      </option>
                    ))}
                  </select>
                </FormField>
                <FormField label="Ask">
                  <select
                    value={form.target_role}
                    onChange={(e) =>
                      setForm({ ...form, target_role: e.target.value as StakeholderType })
                    }
                    className="w-full h-9 rounded-lg border border-border bg-background px-2.5 text-sm"
                  >
                    {Object.entries(STAKEHOLDER_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </FormField>
              </div>
              <FormField label="Question">
                <textarea
                  value={form.question}
                  onChange={(e) => setForm({ ...form, question: e.target.value })}
                  rows={3}
                  placeholder="What do you need to find out?"
                  className="w-full rounded-lg border border-border bg-background px-2.5 py-2 text-sm"
                />
              </FormField>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" size="sm" onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
                <Button size="sm" onClick={addQuestion} disabled={saving}>
                  {saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                  Add
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Grouped questions */}
      {questions.length === 0 ? (
        <div className="border border-border/60 rounded-xl bg-card p-10 text-center shadow-card">
          <HelpCircle className="h-8 w-8 mx-auto text-muted-foreground/60 mb-2" />
          <p className="text-sm text-muted-foreground">No questions yet.</p>
          <p className="text-xs text-muted-foreground/70 mt-1">
            Generate a starter set for the current phase, or add your own.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {grouped
            .filter((g) => g.items.length > 0)
            .map(({ phase, items }) => (
              <div
                key={phase}
                className="border border-border/60 rounded-xl bg-card overflow-hidden shadow-card"
              >
                <div className="px-4 py-2.5 border-b border-border/30 bg-muted/10 flex items-center justify-between">
                  <h3 className="font-display text-sm">{DEAL_STAGE_LABELS[phase]}</h3>
                  <span className="text-2xs text-muted-foreground">
                    {items.filter((i) => i.status === "answered").length}/{items.length} answered
                  </span>
                </div>
                <div className="divide-y divide-border/20">
                  {items.map((q) => (
                    <QuestionRow
                      key={q.id}
                      q={q}
                      onUpdate={(updates) => updateQuestion(q.id, updates)}
                      onDelete={() => removeQuestion(q.id)}
                    />
                  ))}
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

function QuestionRow({
  q,
  onUpdate,
  onDelete,
}: {
  q: DealQuestion;
  onUpdate: (updates: Partial<DealQuestion>) => void;
  onDelete: () => void;
}) {
  const [editingAnswer, setEditingAnswer] = useState(false);
  const [answerDraft, setAnswerDraft] = useState(q.answer || "");
  const statusCfg = QUESTION_STATUS_CONFIG[q.status];

  const cycleStatus = () => {
    const idx = QUESTION_STATUS_CYCLE.indexOf(q.status);
    const next = QUESTION_STATUS_CYCLE[(idx + 1) % QUESTION_STATUS_CYCLE.length];
    onUpdate({ status: next });
  };

  const saveAnswer = () => {
    onUpdate({
      answer: answerDraft.trim() || null,
      status: answerDraft.trim() ? "answered" : q.status,
    });
    setEditingAnswer(false);
  };

  return (
    <div className="px-4 py-3 hover:bg-muted/10 transition-colors group">
      <div className="flex items-start gap-3">
        <button
          onClick={cycleStatus}
          className={cn(
            "shrink-0 mt-0.5 px-2 py-0.5 rounded-full text-2xs font-medium transition-colors",
            statusCfg.color
          )}
          title="Cycle status"
        >
          {statusCfg.label}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-2xs uppercase tracking-wider text-muted-foreground font-medium">
              Ask {STAKEHOLDER_LABELS[q.target_role]}
            </span>
          </div>
          <p className="text-sm mt-0.5">{q.question}</p>

          {editingAnswer ? (
            <div className="mt-2 space-y-2">
              <textarea
                value={answerDraft}
                onChange={(e) => setAnswerDraft(e.target.value)}
                rows={2}
                placeholder="Record the answer..."
                className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm"
              />
              <div className="flex gap-2">
                <Button size="sm" className="h-7 text-xs" onClick={saveAnswer}>
                  Save
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => {
                    setAnswerDraft(q.answer || "");
                    setEditingAnswer(false);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : q.answer ? (
            <div
              className="mt-1.5 text-sm text-muted-foreground bg-muted/20 rounded-md px-2.5 py-1.5 cursor-pointer hover:bg-muted/30"
              onClick={() => setEditingAnswer(true)}
            >
              <CheckCircle2 className="inline h-3.5 w-3.5 mr-1.5 text-emerald-400 -mt-0.5" />
              {q.answer}
            </div>
          ) : (
            <button
              onClick={() => setEditingAnswer(true)}
              className="mt-1 text-xs text-muted-foreground hover:text-foreground"
            >
              + Add answer
            </button>
          )}
        </div>
        <button
          onClick={onDelete}
          className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded hover:bg-muted/50 text-muted-foreground hover:text-red-400"
          aria-label="Delete"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function FormField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}
