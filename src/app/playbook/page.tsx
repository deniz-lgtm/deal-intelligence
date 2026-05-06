"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import {
  BookOpen,
  CheckCircle2,
  FileText,
  Loader2,
  MessageSquare,
  Trash2,
  Upload,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import UniversalChatbot from "@/components/UniversalChatbot";
import { Button } from "@/components/ui/button";
import { useSetPageContext } from "@/lib/page-context";

type PlaybookDocument = {
  id: string;
  title: string;
  category: string;
  original_name: string;
  mime_type: string;
  file_size: number;
  created_at: string;
  updated_at: string;
  chunk_count: number;
};

const CATEGORIES = [
  { value: "handbook", label: "Handbook" },
  { value: "lessons_learned", label: "Lessons learned" },
  { value: "design_standard", label: "Design standard" },
  { value: "underwriting", label: "Underwriting" },
  { value: "construction", label: "Construction" },
  { value: "entitlement", label: "Entitlement" },
  { value: "template", label: "Template" },
  { value: "other", label: "Other" },
];

const PLAYBOOK_STARTERS = [
  "What are the top design misses to check before we send this plan back to the architect?",
  "What should we verify before LOI on a multifamily development deal?",
  "Turn our playbook guidance on unit mix into checklist items for a live deal.",
  "What lessons learned should a development manager review before GMP?",
];

export default function PlaybookPage() {
  const [documents, setDocuments] = useState<PlaybookDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("handbook");
  const [file, setFile] = useState<File | null>(null);
  const [assistantPrompt, setAssistantPrompt] = useState<string | null>(null);

  useSetPageContext(
    {
      route: "playbook",
      screenSummary:
        "Development Playbook workspace. User can upload multifamily handbooks, lessons learned, design standards, underwriting guidance, and ask grounded questions with citations.",
    },
    []
  );

  useEffect(() => {
    const initialQuestion = new URLSearchParams(window.location.search).get("question")?.trim();
    if (initialQuestion) {
      setAssistantPrompt(initialQuestion);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const docRes = await fetch("/api/playbook/documents");
        const docJson = await docRes.json();
        if (!docRes.ok) throw new Error(docJson.error || "Failed to load playbook");
        if (!cancelled) {
          setDocuments(docJson.data ?? []);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load playbook");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const stats = useMemo(() => {
    const chunks = documents.reduce((sum, doc) => sum + Number(doc.chunk_count || 0), 0);
    const categories = new Set(documents.map((doc) => doc.category)).size;
    return { chunks, categories };
  }, [documents]);

  const uploadDocument = async (event: FormEvent) => {
    event.preventDefault();
    if (!file) return;
    setUploading(true);
    setError(null);
    setNotice(null);

    try {
      const form = new FormData();
      form.append("file", file);
      form.append("title", title);
      form.append("category", category);
      const res = await fetch("/api/playbook/documents", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Upload failed");
      setDocuments((prev) => [json.data, ...prev]);
      setTitle("");
      setCategory("handbook");
      setFile(null);
      const input = document.getElementById("playbook-file") as HTMLInputElement | null;
      if (input) input.value = "";
      setNotice("Source indexed into the Playbook.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const deleteDocument = async (document: PlaybookDocument) => {
    if (!window.confirm(`Remove "${document.title}" from the Playbook?`)) return;
    setDeletingId(document.id);
    setError(null);
    setNotice(null);

    try {
      const res = await fetch(`/api/playbook/documents/${encodeURIComponent(document.id)}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Delete failed");
      setDocuments((prev) => prev.filter((doc) => doc.id !== document.id));
      setNotice("Source removed from the Playbook.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <AppShell>
      <div className="flex flex-col flex-1 min-h-0">
        <header className="border-b border-border/40 shrink-0 bg-background">
          <div className="px-6 sm:px-8 h-16 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                <BookOpen className="h-4 w-4 text-primary" />
                <h1 className="font-nameplate text-xl leading-none tracking-tight">Development Playbook</h1>
              </div>
              <p className="mt-1 text-xs text-muted-foreground truncate">
                Institutional memory for underwriting, design, entitlement, and construction decisions.
              </p>
            </div>
            <div className="hidden sm:flex items-center gap-4 text-xs text-muted-foreground">
              <Metric label="Docs" value={documents.length} />
              <Metric label="Chunks" value={stats.chunks} />
              <Metric label="Topics" value={stats.categories} />
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto px-6 sm:px-8 py-6">
          {error && (
            <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}
          {notice && (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/10 px-4 py-3 text-sm text-primary">
              <CheckCircle2 className="h-4 w-4" />
              {notice}
            </div>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-[minmax(320px,420px)_1fr] gap-5">
            <section className="space-y-5">
              <form onSubmit={uploadDocument} className="rounded-lg border border-border bg-card p-5 space-y-4">
                <div>
                  <h2 className="text-base font-semibold">Add source material</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Upload PDFs, Markdown, or text files. Good first candidates are your handbook, DD checklist, basis notes, and design standards.
                  </p>
                </div>

                <label className="block space-y-1.5">
                  <span className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Title</span>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Multifamily Development Handbook"
                    className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10"
                  />
                </label>

                <label className="block space-y-1.5">
                  <span className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Category</span>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10"
                  >
                    {CATEGORIES.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block space-y-1.5">
                  <span className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">File</span>
                  <input
                    id="playbook-file"
                    type="file"
                    accept=".pdf,.txt,.md,.markdown,text/plain,application/pdf"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    className="block w-full text-sm file:mr-3 file:h-9 file:rounded-lg file:border-0 file:bg-secondary file:px-3 file:text-sm file:font-medium file:text-secondary-foreground hover:file:bg-secondary/80"
                  />
                </label>

                <Button type="submit" disabled={!file || uploading} className="w-full gap-2">
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  {uploading ? "Indexing" : "Upload to Playbook"}
                </Button>
              </form>

              <section className="rounded-lg border border-border bg-card p-5">
                <h2 className="text-base font-semibold">Repository</h2>
                <div className="mt-4 space-y-3">
                  {loading ? (
                    [0, 1, 2].map((i) => (
                      <div key={i} className="h-16 rounded-lg border border-border/40 bg-muted/30 animate-pulse" />
                    ))
                  ) : documents.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No playbook sources yet. Add your handbook to give the assistant a real house view.
                    </p>
                  ) : (
                    documents.map((doc) => (
                      <DocumentRow
                        key={doc.id}
                        document={doc}
                        deleting={deletingId === doc.id}
                        onDelete={() => deleteDocument(doc)}
                      />
                    ))
                  )}
                </div>
              </section>
            </section>

            <section className="rounded-lg border border-border bg-card min-h-[620px] flex flex-col overflow-hidden">
              <div className="border-b border-border px-5 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-base font-semibold">Ask Deal Intelligence</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      The assistant reads the Playbook, cites it in chat, and can create tasks, checklist items, or decisions on a deal.
                    </p>
                  </div>
                  <MessageSquare className="h-4 w-4 text-muted-foreground mt-1" />
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {PLAYBOOK_STARTERS.map((starter) => (
                    <button
                      key={starter}
                      type="button"
                      onClick={() => setAssistantPrompt(starter)}
                      className="rounded-lg border border-border/60 bg-background/60 px-3 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground"
                    >
                      {starter}
                    </button>
                  ))}
                </div>
              </div>
              <div className="min-h-0 flex-1">
                <UniversalChatbot
                  variant="embedded"
                  route="playbook"
                  screenSummary="Development Playbook workspace. User is asking the Deal Intelligence assistant to cite company playbook guidance and turn it into notes, checklist items, decisions, or schedule work."
                  initialPrompt={assistantPrompt}
                />
              </div>
            </section>
          </div>
        </main>
      </div>
    </AppShell>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-right">
      <div className="font-medium text-foreground tabular-nums">{value}</div>
      <div className="uppercase tracking-[0.12em]">{label}</div>
    </div>
  );
}

function DocumentRow({
  document,
  deleting,
  onDelete,
}: {
  document: PlaybookDocument;
  deleting: boolean;
  onDelete: () => void;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/60 p-3">
      <div className="flex items-start gap-3">
        <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{document.title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="capitalize">{document.category.replace(/_/g, " ")}</span>
            <span>{document.chunk_count || 0} chunks</span>
            <span>{formatDate(document.created_at)}</span>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onDelete}
          disabled={deleting}
          className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
          title="Remove source"
        >
          {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}

function formatDate(value: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(
    new Date(value)
  );
}
