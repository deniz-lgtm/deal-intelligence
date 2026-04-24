"use client";

import { useState, useRef, useEffect, useCallback } from "react";
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
  Sparkles,
  AlertTriangle,
  MessageCircleQuestion,
  BarChart3,
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
  }> | null;
  created_at: string;
}

type UWMode = "challenge" | "whatif" | "benchmarks";

const STARTER_QUESTIONS = [
  "What are the key assumptions in the model?",
  "How sensitive is the IRR to cap rate?",
  "What's the cash-on-cash return?",
  "Summarize the documents",
];

export default function UniversalChatbot() {
  const { can } = usePermissions();
  const pageCtx = usePageContext();
  const [open, setOpen] = useState(false);
  const [uwMode, setUwMode] = useState<UWMode>("challenge");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [showMemory, setShowMemory] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load messages on mount or when deal changes
  const loadMessages = useCallback(async () => {
    if (!can("ai.chat")) return;
    try {
      const url = pageCtx.dealId
        ? `/api/universal-chat?deal_id=${pageCtx.dealId}`
        : "/api/universal-chat";
      const res = await fetch(url);
      const json = await res.json();
      if (json.data) setMessages(json.data);
    } catch (err) {
      console.error("Failed to load messages:", err);
    }
  }, [can, pageCtx.dealId]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  useStickToBottom(messagesEndRef, [messages]);

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
          deal_id: pageCtx.dealId || null,
          page_context: {
            route: pageCtx.route,
            screen_summary: pageCtx.screenSummary,
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
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-40 flex items-center gap-2 px-4 py-2.5 rounded-full gradient-gold text-primary-foreground font-medium text-xs shadow-lifted-md hover:brightness-110 transition-all"
        >
          <Bot className="h-3.5 w-3.5" />
          Deal Intelligence
        </button>
      )}

      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/20"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Main panel */}
      {open && (
        <aside className="fixed top-0 right-0 z-40 h-screen w-full sm:w-[480px] bg-card border-l border-border/60 shadow-2xl flex flex-col">
          {/* Header */}
          <header className="flex items-center justify-between px-4 py-3 border-b border-border/40 shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg gradient-gold flex items-center justify-center">
                <Bot className="h-3.5 w-3.5 text-primary-foreground" />
              </div>
              <div>
                <div className="text-sm font-semibold">Deal Intelligence</div>
                <div className="text-[10px] text-muted-foreground">
                  {pageCtx.dealName || "Workspace"}
                </div>
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            >
              <PanelRightClose className="h-4 w-4" />
            </button>
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
                          {pageCtx.dealId && " update your underwriting"}
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
                              <ActionCard key={i} action={action} />
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
                        const url = pageCtx.dealId
                          ? `/api/universal-chat?deal_id=${pageCtx.dealId}`
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
                dealId={pageCtx.dealId}
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
}: {
  action: { type: string; display: string };
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 text-xs px-3 py-2 rounded-lg border",
        action.type === "context_saved"
          ? "bg-primary/[0.05] border-primary/20 text-primary"
          : "bg-blue-500/10 border-blue-500/20 text-blue-400"
      )}
    >
      {action.type === "context_saved" ? (
        <Brain className="h-3.5 w-3.5 shrink-0 mt-0.5" />
      ) : (
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5" />
      )}
      <span>{action.display}</span>
    </div>
  );
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
