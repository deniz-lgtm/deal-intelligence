"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Loader2,
  ShieldCheck,
  FileText,
  ExternalLink,
  AlertTriangle,
  Lock,
  Download,
  MessageSquare,
  Send,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

// Public Deal Room viewer. Accessed via magic link — no Clerk auth. The
// middleware is already configured to treat /room/(.*) and /api/room/(.*)
// as public routes.
//
// Flow:
//   1. Fetch /api/room/[token]
//   2. If the server says NDA required and not accepted → show NDA gate
//      that requires the guest to type their name to accept
//   3. Otherwise show the document list, each opening in an iframe on
//      click (loaded from /api/room/[token]/documents/[docId])

interface RoomData {
  room: {
    id: string;
    name: string;
    description: string | null;
    nda_required: boolean;
    nda_text?: string | null;
  };
  deal: {
    name: string;
    address?: string;
    city?: string;
    state?: string;
  };
  nda_accepted: boolean;
  documents: Array<{
    id: string;
    name: string;
    original_name: string;
    category: string;
    mime_type: string;
    file_size: number;
  }>;
  viewer_email: string;
}

export default function RoomViewerPage({
  params,
}: {
  params: { token: string };
}) {
  const [data, setData] = useState<RoomData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/room/${params.token}`);
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "This link is invalid or has expired.");
        return;
      }
      setData(json.data);
      if (json.data?.documents?.length > 0 && !selectedDocId) {
        setSelectedDocId(json.data.documents[0].id);
      }
    } catch {
      setError("Failed to load room");
    } finally {
      setLoading(false);
    }
  }, [params.token, selectedDocId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="text-center max-w-md space-y-4">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-red-500/10 flex items-center justify-center">
            <AlertTriangle className="h-6 w-6 text-red-400" />
          </div>
          <h1 className="text-lg font-display font-semibold">
            Access not available
          </h1>
          <p className="text-sm text-muted-foreground">
            {error ||
              "This deal room link is invalid, expired, or has been revoked."}
          </p>
        </div>
      </div>
    );
  }

  // NDA gate
  if (data.room.nda_required && !data.nda_accepted) {
    return (
      <NdaGate
        token={params.token}
        roomName={data.room.name}
        dealName={data.deal.name}
        ndaText={data.room.nda_text || ""}
        viewerEmail={data.viewer_email}
        onAccepted={load}
      />
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-border/40 bg-card/80 backdrop-blur-xl shrink-0">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg gradient-gold flex items-center justify-center">
                <ShieldCheck className="h-3.5 w-3.5 text-primary-foreground" />
              </div>
              <div className="min-w-0">
                <div className="font-display text-sm text-foreground truncate">
                  {data.room.name}
                </div>
                <div className="text-[10px] text-muted-foreground truncate">
                  {data.deal.name}
                  {data.deal.city && data.deal.state
                    ? ` · ${data.deal.city}, ${data.deal.state}`
                    : ""}
                </div>
              </div>
            </div>
          </div>
          <div className="text-[10px] text-muted-foreground flex items-center gap-1.5">
            <Lock className="h-3 w-3" />
            <span className="hidden sm:inline">
              Confidential · {data.viewer_email}
            </span>
          </div>
        </div>
      </header>

      <div className="flex-1 flex min-h-0">
        {/* Document list sidebar */}
        <aside className="w-64 border-r border-border/40 bg-card/40 flex-shrink-0 overflow-y-auto">
          <div className="p-3">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground/60 mb-2 px-1">
              Documents ({data.documents.length})
            </div>
            {data.documents.length === 0 ? (
              <div className="text-[11px] text-muted-foreground px-1">
                No documents in this room.
              </div>
            ) : (
              <div className="space-y-0.5">
                {data.documents.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => setSelectedDocId(d.id)}
                    className={`w-full text-left px-2.5 py-1.5 rounded-md text-xs transition-colors ${
                      selectedDocId === d.id
                        ? "bg-primary/20 text-foreground"
                        : "text-muted-foreground hover:bg-muted/30 hover:text-foreground"
                    }`}
                  >
                    <div className="flex items-start gap-1.5">
                      <FileText className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate">{d.original_name}</div>
                        <div className="text-[9px] text-muted-foreground/80 capitalize">
                          {d.category.replace(/_/g, " ")}
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
          {data.room.description && (
            <div className="border-t border-border/30 p-3 text-[10px] text-muted-foreground">
              {data.room.description}
            </div>
          )}
        </aside>

        {/* Viewer + Q&A */}
        <main className="flex-1 min-w-0 bg-muted/5 flex flex-col">
          {selectedDocId ? (
            <>
              {/* Download bar */}
              <div className="flex items-center justify-end px-3 py-1.5 border-b border-border/30 bg-card/40 shrink-0">
                <a
                  href={`/api/room/${params.token}/documents/${selectedDocId}?download=1`}
                  className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Download className="h-3 w-3" />
                  Download
                </a>
              </div>
              <div className="flex-1 min-h-0">
                <DocumentViewer
                  token={params.token}
                  docId={selectedDocId}
                  viewerEmail={data.viewer_email}
                />
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
              Select a document to view
            </div>
          )}
        </main>
      </div>

      {/* Q&A Panel (collapsible footer) */}
      <GuestQAPanel token={params.token} viewerEmail={data.viewer_email} />
    </div>
  );
}

// ── NDA gate ──────────────────────────────────────────────────────────────

function NdaGate({
  token,
  roomName,
  dealName,
  ndaText,
  viewerEmail,
  onAccepted,
}: {
  token: string;
  roomName: string;
  dealName: string;
  ndaText: string;
  viewerEmail: string;
  onAccepted: () => void;
}) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleAccept() {
    if (name.trim().length < 2) {
      toast.error("Please type your full name");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/room/${token}/accept-nda`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || "Failed to accept");
        return;
      }
      onAccepted();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="max-w-xl w-full space-y-5">
        <div className="text-center space-y-2">
          <div className="mx-auto w-12 h-12 rounded-2xl gradient-gold flex items-center justify-center">
            <ShieldCheck className="h-5 w-5 text-primary-foreground" />
          </div>
          <h1 className="text-lg font-display font-semibold">{roomName}</h1>
          <p className="text-xs text-muted-foreground">
            {dealName} · Invited as{" "}
            <span className="text-foreground">{viewerEmail}</span>
          </p>
        </div>

        <div className="border border-border/40 rounded-xl bg-card p-5 space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-border/40">
            <Lock className="h-3.5 w-3.5 text-primary" />
            <span className="text-xs font-semibold text-foreground">
              Confidentiality Acknowledgment
            </span>
          </div>
          <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-sans leading-relaxed">
            {ndaText}
          </pre>
          <div className="border-t border-border/30 pt-4 space-y-2">
            <label className="block text-[10px] text-muted-foreground uppercase tracking-wide">
              Type your full name to accept
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your full name"
              className="w-full px-3 py-2 text-sm bg-muted/20 border border-border/40 rounded-lg outline-none focus:border-primary/40"
            />
            <Button
              onClick={handleAccept}
              disabled={submitting || name.trim().length < 2}
              className="w-full"
            >
              {submitting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
              ) : (
                <ShieldCheck className="h-3.5 w-3.5 mr-1.5" />
              )}
              Accept and Continue
            </Button>
            <p className="text-[10px] text-muted-foreground text-center pt-1">
              Your acceptance, timestamp, and IP are logged for audit purposes.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Document viewer ───────────────────────────────────────────────────────

function DocumentViewer({
  token,
  docId,
  viewerEmail,
}: {
  token: string;
  docId: string;
  viewerEmail: string;
}) {
  const src = `/api/room/${token}/documents/${docId}`;
  return (
    <div className="relative w-full h-full">
      <iframe
        key={docId}
        src={src}
        className="w-full h-full border-0"
        title="Document viewer"
      />
      {/* Corner watermark — now supplements the server-side PDF watermark */}
      <div className="pointer-events-none absolute bottom-3 right-3 text-[10px] text-foreground/40 bg-background/60 backdrop-blur px-2 py-1 rounded border border-border/30">
        <ExternalLink className="h-2.5 w-2.5 inline mr-1" />
        {viewerEmail}
      </div>
    </div>
  );
}

// ── Guest Q&A Panel ───────────────────────────────────────────────────────

interface QAThread {
  thread: {
    id: string;
    subject: string;
    author_email: string;
    resolved: boolean;
    created_at: string;
  };
  messages: Array<{
    id: string;
    author_email: string;
    author_role: "guest" | "owner";
    content: string;
    created_at: string;
  }>;
}

function GuestQAPanel({
  token,
  viewerEmail,
}: {
  token: string;
  viewerEmail: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [threads, setThreads] = useState<QAThread[]>([]);
  const [loading, setLoading] = useState(false);
  const [newSubject, setNewSubject] = useState("");
  const [newMessage, setNewMessage] = useState("");
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const loadThreads = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/room/${token}/threads`);
      const json = await res.json();
      setThreads(json.data || []);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (expanded && threads.length === 0) loadThreads();
  }, [expanded, loadThreads, threads.length]);

  async function handleNewThread() {
    if (!newSubject.trim() || !newMessage.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/room/${token}/threads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: newSubject.trim(),
          content: newMessage.trim(),
        }),
      });
      if (!res.ok) {
        toast.error("Failed to post question");
        return;
      }
      setNewSubject("");
      setNewMessage("");
      toast.success("Question posted");
      loadThreads();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReply(threadId: string) {
    if (!replyText.trim()) return;
    setSubmitting(true);
    try {
      await fetch(`/api/room/${token}/threads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ thread_id: threadId, content: replyText.trim() }),
      });
      setReplyText("");
      setReplyingTo(null);
      loadThreads();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="border-t border-border/40 bg-card/80 backdrop-blur-xl shrink-0">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-6 py-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        <div className="flex items-center gap-2">
          <MessageSquare className="h-3.5 w-3.5" />
          Q&A ({threads.length})
        </div>
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronUp className="h-3.5 w-3.5" />
        )}
      </button>

      {expanded && (
        <div className="px-6 pb-4 max-h-[40vh] overflow-y-auto space-y-3">
          {loading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {/* Existing threads */}
              {threads.map((t) => (
                <div
                  key={t.thread.id}
                  className="border border-border/40 rounded-lg p-3 space-y-2"
                >
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-medium text-foreground">
                      {t.thread.subject}
                    </span>
                    {t.thread.resolved && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 uppercase">
                        Resolved
                      </span>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    {t.messages.map((m) => (
                      <div
                        key={m.id}
                        className={`text-[11px] p-2 rounded ${
                          m.author_role === "owner"
                            ? "bg-primary/10 border border-primary/20"
                            : "bg-muted/20"
                        }`}
                      >
                        <div className="flex items-center gap-1.5 mb-0.5 text-[10px] text-muted-foreground">
                          <span
                            className={
                              m.author_role === "owner"
                                ? "text-primary font-medium"
                                : ""
                            }
                          >
                            {m.author_role === "owner" ? "Deal Team" : m.author_email}
                          </span>
                          <span>·</span>
                          <span>
                            {new Date(m.created_at).toLocaleString()}
                          </span>
                        </div>
                        <div className="text-foreground/90">{m.content}</div>
                      </div>
                    ))}
                  </div>
                  {!t.thread.resolved && (
                    <>
                      {replyingTo === t.thread.id ? (
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={replyText}
                            onChange={(e) => setReplyText(e.target.value)}
                            placeholder="Type a reply…"
                            className="flex-1 px-2 py-1 text-xs bg-muted/20 border border-border/40 rounded outline-none focus:border-primary/40"
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleReply(t.thread.id);
                            }}
                          />
                          <Button
                            size="sm"
                            onClick={() => handleReply(t.thread.id)}
                            disabled={submitting || !replyText.trim()}
                          >
                            <Send className="h-3 w-3" />
                          </Button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setReplyingTo(t.thread.id)}
                          className="text-[10px] text-primary hover:underline"
                        >
                          Reply
                        </button>
                      )}
                    </>
                  )}
                </div>
              ))}

              {/* New thread form */}
              <div className="border border-dashed border-border/40 rounded-lg p-3 space-y-2">
                <div className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">
                  Ask a question
                </div>
                <input
                  type="text"
                  value={newSubject}
                  onChange={(e) => setNewSubject(e.target.value)}
                  placeholder="Subject"
                  className="w-full px-2 py-1 text-xs bg-muted/20 border border-border/40 rounded outline-none focus:border-primary/40"
                />
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    placeholder="Your question…"
                    className="flex-1 px-2 py-1 text-xs bg-muted/20 border border-border/40 rounded outline-none focus:border-primary/40"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleNewThread();
                    }}
                  />
                  <Button
                    size="sm"
                    onClick={handleNewThread}
                    disabled={
                      submitting || !newSubject.trim() || !newMessage.trim()
                    }
                  >
                    {submitting ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Send className="h-3 w-3" />
                    )}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
