"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Loader2, Trash2, Bot, User, Brain, CheckCircle2, ChevronDown, ChevronUp } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface ChatAction {
  type: "context_saved" | "deal_updated";
  note?: string;
  fields?: Record<string, unknown>;
  display: string;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  metadata?: ChatAction[] | null;
  created_at: string;
}

interface ChatInterfaceProps {
  dealId: string;
  dealName: string;
  contextNotes?: string | null;
  onContextUpdated?: () => void;
}

const STARTER_QUESTIONS = [
  "What are the key risks identified in the documents?",
  "Summarize the financial performance of this property",
  "What lease terms are in place with current tenants?",
  "Are there any environmental concerns?",
];

const STARTER_ACTIONS = [
  "The seller is motivated — needs to close in 30 days",
  "Update the asking price to $X",
  "Move this deal to LOI status",
  "Note: there's deferred maintenance on the roof (~$50k)",
];

export default function ChatInterface({
  dealId,
  dealName,
  contextNotes,
  onContextUpdated,
}: ChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [showMemory, setShowMemory] = useState(false);
  const [localContextNotes, setLocalContextNotes] = useState(contextNotes ?? null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadMessages();
  }, [dealId]);

  useEffect(() => {
    setLocalContextNotes(contextNotes ?? null);
  }, [contextNotes]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const loadMessages = async () => {
    try {
      const res = await fetch(`/api/chat?deal_id=${dealId}`);
      const json = await res.json();
      if (json.data) setMessages(json.data);
    } catch (err) {
      console.error("Failed to load messages:", err);
    }
  };

  const clearChat = async () => {
    await fetch(`/api/chat?deal_id=${dealId}`, { method: "DELETE" });
    setMessages([]);
  };

  const sendMessage = async (text?: string) => {
    const message = text || input.trim();
    if (!message || loading) return;

    setInput("");
    setLoading(true);

    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      content: message,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deal_id: dealId, message }),
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

      const contextSaved = actions?.find((a: ChatAction) => a.type === "context_saved");
      if (contextSaved?.note) {
        setLocalContextNotes((prev) =>
          prev ? prev + "\n\n" + contextSaved.note : contextSaved.note
        );
        onContextUpdated?.();
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

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/40 bg-card/80 backdrop-blur-xl">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg gradient-gold flex items-center justify-center shadow-sm">
            <Bot className="h-4 w-4 text-primary-foreground" />
          </div>
          <div>
            <p className="text-sm font-display">Deal Intelligence</p>
            <p className="text-2xs text-muted-foreground">{dealName}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setShowMemory((v) => !v)}
            className={cn(
              "flex items-center gap-1.5 text-2xs px-2.5 py-1.5 rounded-lg border transition-all duration-150",
              localContextNotes
                ? "border-primary/30 bg-primary/10 text-primary hover:bg-primary/15"
                : "border-border/40 text-muted-foreground hover:bg-muted/50"
            )}
          >
            <Brain className="h-3.5 w-3.5" />
            Memory
            {localContextNotes && (
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            )}
            {showMemory ? (
              <ChevronUp className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )}
          </button>
          {messages.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearChat}
              className="text-muted-foreground h-7 w-7 p-0"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Memory panel */}
      {showMemory && (
        <div className="px-4 py-3 border-b border-border/30 bg-primary/[0.05]">
          <p className="text-2xs font-semibold text-primary mb-1.5 flex items-center gap-1.5">
            <Brain className="h-3.5 w-3.5" />
            Deal Memory
          </p>
          {localContextNotes ? (
            <p className="text-xs text-foreground whitespace-pre-wrap leading-relaxed">
              {localContextNotes}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              No context saved yet. Tell me about the deal — seller motivation,
              issues, broker intel, market conditions — and I&apos;ll remember it.
            </p>
          )}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && !loading && (
          <div className="py-8">
            <div className="text-center mb-8">
              <div className="h-12 w-12 mx-auto rounded-2xl bg-muted/30 flex items-center justify-center mb-3">
                <Bot className="h-6 w-6 text-muted-foreground/30" />
              </div>
              <p className="text-sm font-display mb-1">Ask questions or give me context</p>
              <p className="text-2xs text-muted-foreground max-w-xs mx-auto">
                I can answer questions, save deal intel to memory, and update deal fields
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <p className="text-2xs text-muted-foreground font-medium mb-2 px-1 uppercase tracking-wider">Questions</p>
                <div className="space-y-1.5">
                  {STARTER_QUESTIONS.map((q) => (
                    <button
                      key={q}
                      onClick={() => sendMessage(q)}
                      className="w-full text-left text-xs p-3 rounded-lg border border-border/40 hover:bg-muted/30 hover:border-border transition-all duration-150"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-2xs text-muted-foreground font-medium mb-2 px-1 uppercase tracking-wider">Actions & Context</p>
                <div className="space-y-1.5">
                  {STARTER_ACTIONS.map((q) => (
                    <button
                      key={q}
                      onClick={() => sendMessage(q)}
                      className="w-full text-left text-xs p-3 rounded-lg border border-primary/20 bg-primary/[0.05] hover:bg-primary/[0.08] text-foreground transition-all duration-150"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id}>
            <MessageBubble message={msg} />
            {msg.role === "assistant" && msg.metadata && msg.metadata.length > 0 && (
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
      <div className="p-4 border-t border-border/40 bg-card/80 backdrop-blur-xl">
        <div className="flex gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about documents, save context, or update deal fields..."
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
        <p className="text-2xs text-muted-foreground/40 mt-2 text-center">
          Enter to send · Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}

function MessageBubble({
  message,
}: {
  message: { id: string; role: string; content: string; created_at?: string };
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

function ActionCard({ action }: { action: ChatAction }) {
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
