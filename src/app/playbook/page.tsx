"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { BookOpen, FileText, Loader2, Search, Upload } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useSetPageContext } from "@/lib/page-context";
import { cn } from "@/lib/utils";

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

type PlaybookSource = {
  citation: number;
  document_title: string;
  document_category: string;
  chunk_index: number;
  heading: string | null;
  excerpt: string;
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

export default function PlaybookPage() {
  const [documents, setDocuments] = useState<PlaybookDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("handbook");
  const [file, setFile] = useState<File | null>(null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [sources, setSources] = useState<PlaybookSource[]>([]);

  useSetPageContext(
    {
      route: "playbook",
      screenSummary:
        "Development Playbook workspace. User can upload multifamily handbooks, lessons learned, design standards, underwriting guidance, and ask grounded questions with citations.",
    },
    []
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/playbook/documents");
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Failed to load playbook");
        if (!cancelled) setDocuments(json.data ?? []);
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const askPlaybook = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = question.trim();
    if (!trimmed) return;
    setAsking(true);
    setError(null);

    try {
      const res = await fetch("/api/playbook/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Question failed");
      setAnswer(json.data?.answer ?? "");
      setSources(json.data?.sources ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Question failed");
    } finally {
      setAsking(false);
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
                    documents.map((doc) => <DocumentRow key={doc.id} document={doc} />)
                  )}
                </div>
              </section>
            </section>

            <section className="rounded-lg border border-border bg-card p-5 min-h-[620px] flex flex-col">
              <form onSubmit={askPlaybook} className="space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-base font-semibold">Ask the playbook</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Grounded answers for underwriting judgment, design tradeoffs, entitlement paths, and lessons learned.
                    </p>
                  </div>
                  <Search className="h-4 w-4 text-muted-foreground mt-1" />
                </div>
                <Textarea
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="What are the top design misses to check before we send this multifamily plan back to the architect?"
                  className="min-h-[120px]"
                />
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">
                    Answers cite uploaded sources and avoid guessing when the handbook is thin.
                  </p>
                  <Button type="submit" disabled={asking || !question.trim()} className="gap-2">
                    {asking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                    Ask
                  </Button>
                </div>
              </form>

              <div className="mt-6 flex-1 rounded-lg border border-border/60 bg-background/60 p-5">
                {asking ? (
                  <div className="flex h-full min-h-[280px] items-center justify-center text-sm text-muted-foreground">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Reading the playbook
                  </div>
                ) : answer ? (
                  <div className="space-y-5">
                    <div className="whitespace-pre-wrap text-sm leading-6 text-foreground">{answer}</div>
                    {sources.length > 0 && (
                      <div className="border-t border-border pt-4">
                        <h3 className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Sources</h3>
                        <div className="mt-3 grid gap-3">
                          {sources.map((source) => (
                            <SourceRow key={`${source.citation}-${source.chunk_index}`} source={source} />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex h-full min-h-[280px] flex-col items-center justify-center text-center">
                    <BookOpen className="h-8 w-8 text-muted-foreground/60" />
                    <p className="mt-3 max-w-md text-sm text-muted-foreground">
                      Ask something practical: what to verify before LOI, how to pressure-test unit mix, what to watch in podium design, or what lessons apply before GMP.
                    </p>
                  </div>
                )}
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

function DocumentRow({ document }: { document: PlaybookDocument }) {
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
      </div>
    </div>
  );
}

function SourceRow({ source }: { source: PlaybookSource }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card p-3">
      <div className="flex items-center gap-2 text-xs">
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary/10 px-1.5 font-medium text-primary">
          {source.citation}
        </span>
        <span className="truncate font-medium">{source.document_title}</span>
        <span className="text-muted-foreground">chunk {source.chunk_index + 1}</span>
      </div>
      {source.heading && <div className="mt-2 text-xs font-medium text-muted-foreground">{source.heading}</div>}
      <p className={cn("mt-2 text-xs leading-5 text-muted-foreground", !source.heading && "mt-3")}>
        {source.excerpt}
        {source.excerpt.length >= 320 ? "..." : ""}
      </p>
    </div>
  );
}

function formatDate(value: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(
    new Date(value)
  );
}
