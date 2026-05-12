"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Send,
  Loader2,
  Trash2,
  Bot,
  User,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  PanelRightClose,
  X,
  Sparkles,
  AlertTriangle,
  MessageCircleQuestion,
  BarChart3,
  CalendarPlus,
  ExternalLink,
  ListChecks,
  Undo2,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/lib/usePermissions";
import { useStickToBottom } from "@/hooks/use-stick-to-bottom";
import { usePageContext } from "@/lib/page-context";
import type { UnderwritingSurface } from "@/lib/page-context";
import { toast } from "sonner";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  metadata?: Array<{
    type: string;
    display: string;
    fields?: Record<string, unknown>;
    note_id?: string;
    schedule_item?: {
      id?: string;
      parent_phase_id?: string | null;
      parent_phase_label?: string | null;
      kind?: string;
      label?: string;
      track?: string;
    };
    mini_schedule?: {
      parent_phase_id?: string | null;
      parent_phase_label?: string | null;
      track?: string;
      tasks?: Array<{
        id?: string;
        label?: string;
        duration_days?: number | null;
        task_owner?: string | null;
        notes?: string | null;
      }>;
    };
    checklist_item?: {
      id?: string;
      category?: string;
      item?: string;
    };
  }> | null;
  created_at: string;
}

type UWMode = "challenge" | "whatif" | "benchmarks";

type MiniScheduleTaskDraft = {
  id?: string;
  label?: string;
  duration_days?: number | null;
  task_owner?: string | null;
  notes?: string | null;
};

const STARTER_QUESTIONS = [
  "What are the key assumptions in the model?",
  "How sensitive is the IRR to cap rate?",
  "What's the cash-on-cash return?",
  "Summarize the documents",
];

type UniversalChatbotProps = {
  variant?: "floating" | "embedded";
  dealId?: string | null;
  dealName?: string | null;
  route?: string | null;
  screenSummary?: string | null;
  initialPrompt?: string | null;
};

export default function UniversalChatbot({
  variant = "floating",
  dealId,
  dealName,
  route,
  screenSummary,
  initialPrompt,
}: UniversalChatbotProps = {}) {
  const { can } = usePermissions();
  const pageCtx = usePageContext();
  const isEmbedded = variant === "embedded";
  const activeDealId = dealId ?? pageCtx.dealId;
  const activeDealName = dealName ?? pageCtx.dealName;
  const activeRoute = route ?? pageCtx.route;
  const activeScreenSummary = screenSummary ?? pageCtx.screenSummary;
  const [open, setOpen] = useState(isEmbedded);
  const [uwMode, setUwMode] = useState<UWMode>("challenge");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [showMemory, setShowMemory] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const appliedInitialPromptRef = useRef<string | null>(null);

  // Load messages on mount or when deal changes
  const loadMessages = useCallback(async () => {
    if (!can("ai.chat")) return;
    try {
      const url = activeDealId
        ? `/api/universal-chat?deal_id=${activeDealId}`
        : "/api/universal-chat";
      const res = await fetch(url);
      const json = await res.json();
      if (json.data) setMessages(json.data);
    } catch (err) {
      console.error("Failed to load messages:", err);
    }
  }, [can, activeDealId]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  useStickToBottom(messagesEndRef, [messages]);

  useEffect(() => {
    const prompt = initialPrompt?.trim();
    if (!prompt || appliedInitialPromptRef.current === prompt) return;
    appliedInitialPromptRef.current = prompt;
    setInput(prompt);
    if (isEmbedded) setOpen(true);
  }, [initialPrompt, isEmbedded]);

  const sendMessage = async (text?: string) => {
    const msg = (text || input).trim();
    if (!msg || loading) return;

    setInput("");
    setLoading(true);

    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      content: msg,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);

    try {
      const res = await fetch("/api/universal-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: msg,
          deal_id: activeDealId || null,
          page_context: {
            route: activeRoute,
            screen_summary: activeScreenSummary,
          },
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Chat failed");

      const { message: responseText, actions } = json.data;
      const assistantMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: responseText,
        metadata: actions?.length > 0 ? actions : null,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMsg]);

      // Execute underwriting patch if on UW page
      if (pageCtx.underwriting) {
        for (const action of actions || []) {
          if (action.type === "underwriting_updated" && action.fields) {
            pageCtx.underwriting.onApplyPatch(
              action.fields as Record<string, number>
            );
            toast.success("Underwriting updated — remember to Save");
          }
        }
      }
    } catch (err) {
      console.error("Chat error:", err);
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          role: "assistant",
          content: "Sorry, something went wrong. Please try again.",
          created_at: new Date().toISOString(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  if (!can("ai.chat")) {
    return null;
  }

  return (
    <>
      {/* Floating launcher button */}
      {!isEmbedded && !open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-40 flex items-center gap-2 px-4 py-2.5 rounded-full gradient-gold text-primary-foreground font-medium text-xs shadow-lifted-md hover:brightness-110 transition-all"
        >
          <Bot className="h-3.5 w-3.5" />
          Deal Intelligence
        </button>
      )}

      {/* Backdrop */}
      {!isEmbedded && open && (
        <div
          className="fixed inset-0 z-30 bg-black/20"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Main panel */}
      {(isEmbedded || open) && (
        <aside
          className={cn(
            "bg-card flex flex-col",
            isEmbedded
              ? "h-full w-full"
              : "fixed top-0 right-0 z-40 h-screen w-full sm:w-[480px] border-l border-border/60 shadow-2xl"
          )}
        >
          {/* Header */}
          <header className="flex items-center justify-between px-4 py-3 border-b border-border/40 shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg gradient-gold flex items-center justify-center">
                <Bot className="h-3.5 w-3.5 text-primary-foreground" />
              </div>
              <div>
                <div className="text-sm font-semibold">Deal Intelligence</div>
                <div className="text-[10px] text-muted-foreground">
                  {activeDealName || "Workspace"}
                </div>
              </div>
            </div>
            {!isEmbedded && (
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close assistant"
                className="flex items-center justify-center h-11 w-11 sm:h-8 sm:w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 active:bg-muted transition-colors -mr-1 sm:mr-0"
              >
                {/* Use X on mobile (universally read as "close"); the
                    PanelRightClose chevron only makes sense on desktop where
                    the panel docks to the right. */}
                <X className="h-5 w-5 sm:hidden" />
                <PanelRightClose className="h-4 w-4 hidden sm:block" />
              </button>
            )}
          </header>

          {/* Tabs: Chat vs UW Co-Pilot */}
          <div className="flex border-b border-border/40 shrink-0">
            <button
              onClick={() => setUwMode("challenge")}
              className={cn(
                "flex-1 flex items-center justify-center gap-1.5 px-2 py-2.5 text-[11px] font-medium transition-colors",
                uwMode === "challenge"
                  ? "text-foreground border-b-2 border-primary -mb-px"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              Chat
            </button>
            {pageCtx.underwriting && (
              <>
                <button
                  onClick={() => setUwMode("whatif")}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-1.5 px-2 py-2.5 text-[11px] font-medium transition-colors",
                    uwMode === "whatif"
                      ? "text-foreground border-b-2 border-primary -mb-px"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <MessageCircleQuestion className="h-3.5 w-3.5" />
                  Review
                </button>
                <button
                  onClick={() => setUwMode("benchmarks")}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-1.5 px-2 py-2.5 text-[11px] font-medium transition-colors",
                    uwMode === "benchmarks"
                      ? "text-foreground border-b-2 border-primary -mb-px"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <BarChart3 className="h-3.5 w-3.5" />
                  What-If
                </button>
              </>
            )}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto flex flex-col">
            {uwMode === "challenge" && (
              <>
                {/* Chat view */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  {messages.length === 0 && !loading && (
                    <div className="py-8">
                      <div className="text-center mb-6">
                        <div className="h-10 w-10 mx-auto rounded-2xl bg-muted/30 flex items-center justify-center mb-2">
                          <Bot className="h-5 w-5 text-muted-foreground/30" />
                        </div>
                        <p className="text-xs font-display mb-1">
                          Ask questions or take notes
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          I can answer questions, save context, and
                          {activeDealId && " update your underwriting"}
                        </p>
                      </div>
                      <div className="space-y-1.5">
                        {STARTER_QUESTIONS.map((q) => (
                          <button
                            key={q}
                            onClick={() => sendMessage(q)}
                            className="w-full text-left text-xs p-2.5 rounded-lg border border-border/40 hover:bg-muted/30 transition-all"
                          >
                            {q}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {messages.map((msg) => (
                    <div key={msg.id}>
                      <MessageBubble message={msg} />
                      {msg.role === "assistant" &&
                        msg.metadata &&
                        msg.metadata.length > 0 && (
                          <div className="mt-1.5 ml-10 space-y-1">
                            {msg.metadata.map((action, i) => (
                              <ActionCard
                                key={i}
                                action={action}
                                dealId={activeDealId}
                              />
                            ))}
                          </div>
                        )}
                    </div>
                  ))}

                  {loading && (
                    <div className="flex items-center gap-2.5 text-muted-foreground text-sm">
                      <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                      </div>
                      <div className="flex gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 animate-pulse" />
                        <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 animate-pulse [animation-delay:150ms]" />
                        <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 animate-pulse [animation-delay:300ms]" />
                      </div>
                    </div>
                  )}

                  <div ref={messagesEndRef} />
                </div>

                {/* Input */}
                <div className="p-4 border-t border-border/40 bg-card/80 backdrop-blur-xl shrink-0">
                  <div className="flex gap-2">
                    <Textarea
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder="Ask a question or save a note..."
                      className="min-h-[44px] max-h-32 resize-none text-sm rounded-xl"
                      disabled={loading}
                    />
                    <Button
                      onClick={() => sendMessage()}
                      disabled={!input.trim() || loading}
                      size="icon"
                      className="shrink-0 h-11 w-11 rounded-xl"
                    >
                      {loading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                  {messages.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={async () => {
                        const url = activeDealId
                          ? `/api/universal-chat?deal_id=${activeDealId}`
                          : "/api/universal-chat";
                        await fetch(url, { method: "DELETE" });
                        setMessages([]);
                      }}
                      className="mt-2 w-full text-xs text-muted-foreground"
                    >
                      <Trash2 className="h-3 w-3 mr-1" />
                      Clear chat
                    </Button>
                  )}
                </div>
              </>
            )}

            {/* UW Co-Pilot tabs (only visible when on UW page) */}
            {pageCtx.underwriting && uwMode !== "challenge" && (
              <UWCoPilotPane
                mode={uwMode as "whatif" | "benchmarks"}
                dealId={activeDealId}
                underwriting={pageCtx.underwriting}
              />
            )}
          </div>
        </aside>
      )}
    </>
  );
}

function MessageBubble({
  message,
}: {
  message: { id: string; role: string; content: string };
}) {
  const isUser = message.role === "user";

  return (
    <div className={cn("flex gap-2.5", isUser ? "justify-end" : "justify-start")}>
      {!isUser && (
        <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
          <Bot className="h-3.5 w-3.5 text-primary" />
        </div>
      )}
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
          isUser
            ? "gradient-gold text-primary-foreground rounded-br-md"
            : "bg-muted/50 border border-border/30 rounded-bl-md"
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : (
          <div className="prose prose-sm prose-invert max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {message.content}
            </ReactMarkdown>
          </div>
        )}
      </div>
      {isUser && (
        <div className="h-7 w-7 rounded-full bg-muted/30 border border-border/30 flex items-center justify-center shrink-0 mt-0.5">
          <User className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
      )}
    </div>
  );
}

function ActionCard({
  action,
  dealId,
}: {
  action: {
    type: string;
    display: string;
    note_id?: string;
    schedule_item?: {
      id?: string;
      parent_phase_id?: string | null;
      parent_phase_label?: string | null;
      kind?: string;
      label?: string;
      track?: string;
    };
    mini_schedule?: {
      parent_phase_id?: string | null;
      parent_phase_label?: string | null;
      track?: string;
      tasks?: Array<{
        id?: string;
        label?: string;
        duration_days?: number | null;
        task_owner?: string | null;
        notes?: string | null;
      }>;
    };
    checklist_item?: {
      id?: string;
      category?: string;
      item?: string;
    };
  };
  dealId?: string | null;
}) {
  const [undone, setUndone] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [approving, setApproving] = useState(false);
  const [approvedIds, setApprovedIds] = useState<string[]>([]);
  const [draftTasks, setDraftTasks] = useState<MiniScheduleTaskDraft[]>(
    () => action.mini_schedule?.tasks?.map((task) => ({ ...task })) ?? []
  );
  const config = getActionCardConfig(action, dealId);
  const isDraft = action.type === "mini_schedule_draft";
  const activeTasks = isDraft ? draftTasks : action.mini_schedule?.tasks ?? [];
  const effectiveUndoUrls =
    approvedIds.length > 0 && dealId
      ? approvedIds.map((id) => `/api/deals/${dealId}/schedule/${id}`)
      : config.undoUrls || (config.undoUrl ? [config.undoUrl] : []);

  const undo = async () => {
    if (!dealId || effectiveUndoUrls.length === 0 || undoing) return;
    setUndoing(true);
    try {
      for (const undoUrl of effectiveUndoUrls) {
        const res = await fetch(undoUrl, { method: "DELETE" });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || "Undo failed");
      }
      setUndone(true);
      toast.success("Action undone");
    } catch (err) {
      console.error("Undo action failed:", err);
      toast.error(err instanceof Error ? err.message : "Undo failed");
    } finally {
      setUndoing(false);
    }
  };

  const updateDraftTask = (
    index: number,
    updates: Partial<MiniScheduleTaskDraft>
  ) => {
    setDraftTasks((current) =>
      current.map((task, i) => (i === index ? { ...task, ...updates } : task))
    );
  };

  const removeDraftTask = (index: number) => {
    setDraftTasks((current) => current.filter((_, i) => i !== index));
  };

  const approveMiniSchedule = async () => {
    if (!dealId || !action.mini_schedule || approving || approvedIds.length > 0) return;
    const tasks = draftTasks
      .map((task) => ({
        label: task.label?.trim() || "",
        duration_days:
          typeof task.duration_days === "number" && Number.isFinite(task.duration_days)
            ? task.duration_days
            : null,
        task_owner: task.task_owner?.trim() || null,
        notes: task.notes?.trim() || null,
      }))
      .filter((task) => task.label);
    if (tasks.length === 0) {
      toast.error("Add at least one task name first");
      return;
    }
    setApproving(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/schedule/mini`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parent_phase_id: action.mini_schedule.parent_phase_id ?? null,
          parent_phase_label: action.mini_schedule.parent_phase_label ?? null,
          track: action.mini_schedule.track || "development",
          tasks,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to create task plan");
      const created = Array.isArray(json.data?.tasks) ? json.data.tasks : [];
      const ids = created.map((task: { id?: string }) => task.id).filter(Boolean);
      setApprovedIds(ids);
      const parentId =
        typeof json.data?.parent?.id === "string"
          ? json.data.parent.id
          : action.mini_schedule.parent_phase_id;
      toast.success("Task plan created. Opening it...");
      if (parentId) {
        window.setTimeout(() => {
          window.location.assign(`/deals/${dealId}/schedule/focus/${parentId}`);
        }, 450);
      }
    } catch (err) {
      console.error("Approve task plan failed:", err);
      toast.error(err instanceof Error ? err.message : "Failed to create task plan");
    } finally {
      setApproving(false);
    }
  };

  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2 text-xs",
        config.className,
        undone && "opacity-60"
      )}
    >
      <div className="flex items-start gap-2">
        <config.icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="font-medium">
            {undone ? "Undone" : approvedIds.length > 0 ? "Created task plan" : config.title}
          </div>
          <div className="mt-0.5 leading-5 text-current/85">{action.display}</div>
          {activeTasks.length > 0 && (
            <ul className="mt-2 space-y-1 border-t border-current/10 pt-2">
              {activeTasks.map((task, index) => (
                <li key={task.id || `${task.label}-${index}`} className="flex gap-1.5 text-[11px] leading-4 text-current/85">
                  <span className="mt-[5px] h-1 w-1 shrink-0 rounded-full bg-current/60" />
                  {isDraft && approvedIds.length === 0 ? (
                    <div className="grid min-w-0 flex-1 grid-cols-[1fr_58px_24px] gap-1.5">
                      <input
                        value={task.label || ""}
                        onChange={(e) => updateDraftTask(index, { label: e.target.value })}
                        className="min-w-0 rounded border border-current/20 bg-background/50 px-1.5 py-1 text-[11px] outline-none"
                        aria-label="Task label"
                      />
                      <input
                        type="number"
                        min={0}
                        value={task.duration_days ?? ""}
                        onChange={(e) =>
                          updateDraftTask(index, {
                            duration_days: e.target.value === "" ? null : Number(e.target.value),
                          })
                        }
                        className="rounded border border-current/20 bg-background/50 px-1.5 py-1 text-[11px] outline-none"
                        aria-label="Duration days"
                      />
                      <button
                        type="button"
                        onClick={() => removeDraftTask(index)}
                        className="flex items-center justify-center rounded border border-current/20 hover:bg-current/10"
                        aria-label="Remove task"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                      <input
                        value={task.task_owner || ""}
                        onChange={(e) => updateDraftTask(index, { task_owner: e.target.value })}
                        className="col-span-3 rounded border border-current/20 bg-background/50 px-1.5 py-1 text-[11px] outline-none"
                        placeholder="Owner"
                        aria-label="Task owner"
                      />
                    </div>
                  ) : (
                    <span>
                      {task.label}
                      {task.task_owner ? ` - ${task.task_owner}` : ""}
                      {typeof task.duration_days === "number" ? ` - ${task.duration_days}d` : ""}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {(config.href || effectiveUndoUrls.length > 0 || isDraft) && !undone && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {config.href && (approvedIds.length > 0 || !isDraft) && (
                <Link
                  href={config.href}
                  className="inline-flex items-center gap-1 rounded-md border border-current/20 px-2 py-1 text-[10px] font-medium hover:bg-current/10"
                >
                  <ExternalLink className="h-3 w-3" />
                  {config.hrefLabel}
                </Link>
              )}
              {isDraft && approvedIds.length === 0 && (
                <button
                  type="button"
                  onClick={approveMiniSchedule}
                  disabled={approving || activeTasks.length === 0}
                  className="inline-flex items-center gap-1 rounded-md border border-current/20 px-2 py-1 text-[10px] font-medium hover:bg-current/10 disabled:opacity-60"
                >
                  {approving ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-3 w-3" />
                  )}
                  Create tasks
                </button>
              )}
              {effectiveUndoUrls.length > 0 && (approvedIds.length > 0 || !isDraft) && (
                <button
                  type="button"
                  onClick={undo}
                  disabled={undoing}
                  className="inline-flex items-center gap-1 rounded-md border border-current/20 px-2 py-1 text-[10px] font-medium hover:bg-current/10 disabled:opacity-60"
                >
                  {undoing ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Undo2 className="h-3 w-3" />
                  )}
                  Undo
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function getActionCardConfig(
  action: {
    type: string;
    note_id?: string;
    schedule_item?: {
      id?: string;
      parent_phase_id?: string | null;
      kind?: string;
    };
    mini_schedule?: {
      parent_phase_id?: string | null;
      tasks?: Array<{ id?: string }>;
    };
    checklist_item?: {
      id?: string;
      item?: string;
      category?: string;
      deep_link?: string;
    };
  },
  dealId?: string | null
): {
  title: string;
  icon: typeof CheckCircle2;
  className: string;
  href: string | null;
  hrefLabel: string;
  undoUrl: string | null;
  undoUrls?: string[];
} {
  if (action.type === "checklist_item_created") {
    const itemId = action.checklist_item?.id;
    // Deep-link straight to the drawer for the just-created item so the
    // user doesn't have to hunt for it.
    const href = dealId && itemId
      ? `/deals/${dealId}/checklist?item=${itemId}`
      : dealId
        ? `/deals/${dealId}/checklist`
        : null;
    return {
      title: action.checklist_item?.item
        ? `Created: ${action.checklist_item.item}`
        : "Created checklist item",
      icon: ListChecks,
      className: "bg-amber-500/10 border-amber-500/20 text-amber-300",
      href,
      hrefLabel: "Open task",
      undoUrl: itemId ? `/api/checklist?id=${itemId}` : null,
    };
  }
  if (action.type === "note_created") {
    return {
      title: "Saved decision",
      icon: CheckCircle2,
      className: "bg-emerald-500/10 border-emerald-500/20 text-emerald-300",
      href: dealId ? `/notes?deal=${dealId}` : "/notes",
      hrefLabel: "Open notes",
      undoUrl: dealId && action.note_id ? `/api/deals/${dealId}/notes?noteId=${action.note_id}` : null,
    };
  }
  if (action.type === "schedule_item_created") {
    const itemId = action.schedule_item?.id;
    const focusId = action.schedule_item?.parent_phase_id || itemId;
    return {
      title: "Created schedule item",
      icon: CalendarPlus,
      className: "bg-emerald-500/10 border-emerald-500/20 text-emerald-300",
      href: dealId ? (focusId ? `/deals/${dealId}/schedule/focus/${focusId}` : `/deals/${dealId}/schedule`) : null,
      hrefLabel: "Open schedule",
      undoUrl: dealId && itemId ? `/api/deals/${dealId}/schedule/${itemId}` : null,
    };
  }
  if (action.type === "schedule_action_failed") {
    return {
      title: "Schedule action needs a parent",
      icon: AlertTriangle,
      className: "bg-amber-500/10 border-amber-500/20 text-amber-300",
      href: dealId ? `/deals/${dealId}/schedule` : null,
      hrefLabel: "Open schedule",
      undoUrl: null,
    };
  }
  if (action.type === "mini_schedule_created") {
    const parentId = action.mini_schedule?.parent_phase_id;
    const ids = action.mini_schedule?.tasks?.map((task) => task.id).filter(Boolean) as string[] | undefined;
    return {
      title: "Created task plan",
      icon: CalendarPlus,
      className: "bg-emerald-500/10 border-emerald-500/20 text-emerald-300",
      href: dealId ? (parentId ? `/deals/${dealId}/schedule/focus/${parentId}` : `/deals/${dealId}/schedule`) : null,
      hrefLabel: "Open task plan",
      undoUrl: null,
      undoUrls: dealId && ids ? ids.map((id) => `/api/deals/${dealId}/schedule/${id}`) : [],
    };
  }
  if (action.type === "mini_schedule_draft") {
    const parentId = action.mini_schedule?.parent_phase_id;
    return {
      title: "Ready to create task plan",
      icon: CalendarPlus,
      className: "bg-amber-500/10 border-amber-500/20 text-amber-300",
      href: dealId && parentId ? `/deals/${dealId}/schedule/focus/${parentId}` : null,
      hrefLabel: "Open task plan",
      undoUrl: null,
      undoUrls: [],
    };
  }
  if (action.type === "underwriting_updated") {
    return {
      title: "Updated underwriting",
      icon: BarChart3,
      className: "bg-blue-500/10 border-blue-500/20 text-blue-300",
      href: dealId ? `/deals/${dealId}/underwriting` : null,
      hrefLabel: "Open underwriting",
      undoUrl: null,
    };
  }
  if (action.type === "deal_updated") {
    return {
      title: "Updated deal",
      icon: CheckCircle2,
      className: "bg-blue-500/10 border-blue-500/20 text-blue-300",
      href: dealId ? `/deals/${dealId}` : null,
      hrefLabel: "Open deal",
      undoUrl: null,
    };
  }
  return {
    title: "Saved memory",
    icon: Brain,
    className: "bg-primary/[0.05] border-primary/20 text-primary",
    href: dealId ? `/notes?deal=${dealId}` : "/notes",
    hrefLabel: "Open notes",
    undoUrl: dealId && action.note_id ? `/api/deals/${dealId}/notes?noteId=${action.note_id}` : null,
  };
}

function UWCoPilotPane({
  mode,
  dealId,
  underwriting,
}: {
  mode: "whatif" | "benchmarks";
  dealId: string | null;
  underwriting: UnderwritingSurface;
}) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<unknown>(null);
  const [question, setQuestion] = useState("");

  const runAnalysis = useCallback(async () => {
    if (!dealId) return;
    setLoading(true);
    try {
      const endpoint =
        mode === "whatif"
          ? `/api/deals/${dealId}/copilot/whatif`
          : `/api/deals/${dealId}/copilot/benchmarks`;
      const res = await fetch(endpoint, {
        method: mode === "whatif" ? "POST" : "GET",
        headers: { "Content-Type": "application/json" },
        body:
          mode === "whatif"
            ? JSON.stringify({
                question,
                metrics: underwriting.metrics,
              })
            : undefined,
      });
      const json = await res.json();
      setData(json.data);
    } catch (err) {
      console.error("UW analysis failed:", err);
      toast.error("Failed to run analysis");
    } finally {
      setLoading(false);
    }
  }, [dealId, mode, question, underwriting.metrics]);

  if (mode === "whatif") {
    return (
      <div className="p-4 space-y-3 flex-1 overflow-y-auto">
        <div className="text-xs text-muted-foreground">
          Ask a scenario — I'll propose field changes and show impacts.
        </div>
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="e.g., What if vacancy runs 8%?"
          rows={3}
          className="w-full px-3 py-2 text-xs bg-muted/20 border border-border/40 rounded-lg outline-none focus:border-primary/40 resize-none"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              runAnalysis();
            }
          }}
        />
        <Button onClick={runAnalysis} disabled={loading || !question.trim()} className="w-full">
          {loading ? (
            <Loader2 className="h-3 w-3 animate-spin mr-1" />
          ) : (
            <Sparkles className="h-3 w-3 mr-1" />
          )}
          Analyze
        </Button>
        {(() => {
          // `data` is typed unknown; narrow it through a local type
          // guard so the JSX child has a concrete string, not unknown.
          // Prior attempts relied on TS narrowing the ternary result,
          // which Railway's build chain was unhappy with.
          if (!data || typeof data !== "object") return null;
          const record = data as Record<string, unknown>;
          const analysis = record.analysis;
          if (typeof analysis !== "string") return null;
          return (
            <div className="p-3 rounded-lg bg-primary/5 border border-primary/20 space-y-2">
              <p className="text-xs text-foreground/90">{analysis}</p>
            </div>
          );
        })()}
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3 flex-1 overflow-y-auto">
      <div className="text-xs text-muted-foreground">
        Benchmarks: your model vs. market defaults.
      </div>
      <Button onClick={runAnalysis} disabled={loading} className="w-full">
        {loading ? (
          <Loader2 className="h-3 w-3 animate-spin mr-1" />
        ) : (
          <BarChart3 className="h-3 w-3 mr-1" />
        )}
        Load Benchmarks
      </Button>
      {data !== null && typeof data === "object" ? (
        <div className="text-[10px] space-y-1 text-muted-foreground">
          <p>Benchmarks loaded (see full comparison in UW Co-Pilot sidebar)</p>
        </div>
      ) : null}
    </div>
  );
}
