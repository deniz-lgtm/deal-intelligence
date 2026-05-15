"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Copy,
  FileSearch,
  FileText,
  FolderOpen,
  Loader2,
  Mail,
  Plus,
  Search,
  Upload,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DOCUMENT_CATEGORIES, type Deal, type Document, type DocumentCategory } from "@/lib/types";
import { formatBytes } from "@/lib/utils";
import { toast } from "sonner";

type ReviewResult = {
  document_type: string;
  executive_take: string;
  key_points: string[];
  red_flags: string[];
  missing_items: string[];
  questions_to_ask: string[];
  suggested_email: string;
  filing_suggestion: {
    category: string;
    deal_relevance: string;
  };
};

type ReviewedDoc = {
  doc: Document;
  review: ReviewResult | null;
  loading: boolean;
  error?: string | null;
  saved_note_id?: string | null;
};

type PlaybookDocument = {
  id: string;
  title: string;
  category: string;
  chunk_count: number;
};

const REVIEW_PRESETS = [
  {
    label: "Prelim site plan",
    prompt:
      "Review this preliminary site plan for deal feasibility. Focus on unit count and mix, parking, access/circulation, fire access, trash/loading, open space, setbacks/easements, grading/utilities, missing dimensions, zoning assumptions, constructability, and questions for architect/civil.",
  },
  {
    label: "Consultant proposal",
    prompt:
      "Review this proposal before I respond. Focus on scope gaps, exclusions, fee clarity, schedule, deliverables, reimbursables, assumptions, and questions to ask before signing.",
  },
  {
    label: "OM / front-end deal",
    prompt:
      "Review this front-end deal material. Focus on underwriting assumptions to verify, seller/broker claims, missing diligence, value-creation thesis, and quick BOE questions.",
  },
  {
    label: "Email response",
    prompt:
      "Review this as something I may need to respond to. Pull out the decision, risks, missing information, and draft a short practical reply.",
  },
];

export default function ReviewDocPage() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [dealsLoading, setDealsLoading] = useState(true);
  const [dealSearch, setDealSearch] = useState("");
  const [selectedDealId, setSelectedDealId] = useState<string>("");
  const [newDealName, setNewDealName] = useState("");
  const [creatingDeal, setCreatingDeal] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [focus, setFocus] = useState(
    "Review for scope gaps, red flags, missing questions, and a concise email response."
  );
  const [reviewFrameworks, setReviewFrameworks] = useState<PlaybookDocument[]>([]);
  const [selectedFrameworkId, setSelectedFrameworkId] = useState("");
  const [uploading, setUploading] = useState(false);
  const [reviewedDocs, setReviewedDocs] = useState<ReviewedDoc[]>([]);
  const [updatingCategory, setUpdatingCategory] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadDeals() {
      try {
        const res = await fetch("/api/deals");
        const json = await res.json().catch(() => ({}));
        if (!cancelled) {
          const rows = (json.data || []) as Deal[];
          setDeals(rows);
          if (!selectedDealId && rows[0]) setSelectedDealId(rows[0].id);
        }
      } catch {
        toast.error("Failed to load deal folders");
      } finally {
        if (!cancelled) setDealsLoading(false);
      }
    }
    loadDeals();
    return () => {
      cancelled = true;
    };
  }, [selectedDealId]);

  useEffect(() => {
    let cancelled = false;
    async function loadFrameworks() {
      try {
        const res = await fetch("/api/playbook/documents");
        const json = await res.json().catch(() => ({}));
        if (!res.ok) return;
        const rows = ((json.data || []) as PlaybookDocument[]).filter((doc) =>
          ["review_framework", "design_standard", "handbook"].includes(doc.category)
        );
        if (!cancelled) setReviewFrameworks(rows);
      } catch {
        // Review frameworks are optional; document review still works without them.
      }
    }
    loadFrameworks();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedDeal = deals.find((deal) => deal.id === selectedDealId) || null;
  const visibleDeals = useMemo(() => {
    const q = dealSearch.trim().toLowerCase();
    if (!q) return deals.slice(0, 20);
    return deals
      .filter((deal) =>
        [deal.name, deal.address, deal.city, deal.state]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q)
      )
      .slice(0, 20);
  }, [deals, dealSearch]);

  async function createDealFolder() {
    const name = newDealName.trim();
    if (!name) {
      toast.error("Name the deal folder first");
      return;
    }
    setCreatingDeal(true);
    try {
      const res = await fetch("/api/deals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          status: "sourcing",
          property_type: "other",
          notes: "Created from Review Doc intake.",
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not create deal folder");
      const deal = json.data as Deal;
      setDeals((prev) => [deal, ...prev]);
      setSelectedDealId(deal.id);
      setNewDealName("");
      toast.success("Deal folder created");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create deal folder");
    } finally {
      setCreatingDeal(false);
    }
  }

  async function uploadAndReview() {
    if (!selectedDealId) {
      toast.error("Pick or create a deal folder first");
      return;
    }
    if (files.length === 0) {
      toast.error("Add at least one document");
      return;
    }

    setUploading(true);
    setReviewedDocs([]);
    try {
      const formData = new FormData();
      formData.append("deal_id", selectedDealId);
      files.forEach((file) => formData.append("files", file));

      const uploadRes = await fetch("/api/documents/upload", {
        method: "POST",
        body: formData,
      });
      const uploadJson = await uploadRes.json().catch(() => ({}));
      if (!uploadRes.ok) throw new Error(uploadJson.error || "Upload failed");

      const uploaded = (uploadJson.data || []) as Document[];
      setReviewedDocs(uploaded.map((doc) => ({ doc, review: null, loading: true })));
      setFiles([]);

      for (const doc of uploaded) {
        try {
          const reviewRes = await fetch(`/api/documents/${doc.id}/review`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ focus, review_playbook_id: selectedFrameworkId || undefined }),
          });
          const reviewJson = await reviewRes.json().catch(() => ({}));
          if (!reviewRes.ok) throw new Error(reviewJson.error || "Review failed");
          const responseData = reviewJson.data || {};
          const review = (responseData.review || responseData) as ReviewResult;
          setReviewedDocs((prev) =>
            prev.map((row) =>
              row.doc.id === doc.id
                ? {
                    ...row,
                    review,
                    loading: false,
                    saved_note_id: responseData.saved_note_id || null,
                  }
                : row
            )
          );
        } catch (error) {
          setReviewedDocs((prev) =>
            prev.map((row) =>
              row.doc.id === doc.id
                ? {
                    ...row,
                    loading: false,
                    error: error instanceof Error ? error.message : "Review failed",
                  }
                : row
            )
          );
        }
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not review document");
    } finally {
      setUploading(false);
    }
  }

  async function applyCategory(docId: string, category: string) {
    if (!category) return;
    setUpdatingCategory(docId);
    try {
      const res = await fetch(`/api/documents/${docId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not update category");
      const updated = json.data as Document;
      setReviewedDocs((prev) =>
        prev.map((row) => (row.doc.id === docId ? { ...row, doc: updated } : row))
      );
      toast.success("Filing category updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update category");
    } finally {
      setUpdatingCategory(null);
    }
  }

  return (
    <AppShell>
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="border-b border-border/40 bg-card/40 px-6 py-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-muted-foreground">
                <FileSearch className="h-4 w-4 text-primary" />
                Review Doc
              </div>
              <h1 className="mt-2 font-display text-2xl">Review, then file it where it belongs.</h1>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
                Use this for consultant proposals, OMs, reports, plans, and email attachments before you reply or move a deal forward.
              </p>
            </div>
            {selectedDeal && (
              <Button asChild variant="outline" size="sm" className="gap-1.5">
                <Link href={`/deals/${selectedDeal.id}/documents`}>
                  <FolderOpen className="h-3.5 w-3.5" />
                  Open deal folder
                </Link>
              </Button>
            )}
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-6">
          <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
            <section className="space-y-4">
              <div className="rounded-xl border border-border/60 bg-card p-4">
                <div className="flex items-center gap-2">
                  <FolderOpen className="h-4 w-4 text-primary" />
                  <h2 className="text-sm font-semibold">Deal folder</h2>
                </div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Documents are saved into the selected deal's document folder before review.
                </p>

                <div className="relative mt-3">
                  <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/40" />
                  <input
                    value={dealSearch}
                    onChange={(event) => setDealSearch(event.target.value)}
                    placeholder="Search deal folders..."
                    className="w-full rounded-lg border border-border/50 bg-background/50 py-2 pl-8 pr-3 text-xs outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/15"
                  />
                </div>

                <div className="mt-3 max-h-72 space-y-1 overflow-y-auto pr-1">
                  {dealsLoading ? (
                    <div className="flex items-center gap-2 rounded-lg border border-border/50 p-3 text-xs text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Loading deals
                    </div>
                  ) : visibleDeals.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-border/60 p-3 text-xs text-muted-foreground">
                      No matching deal folder. Create one below.
                    </p>
                  ) : (
                    visibleDeals.map((deal) => (
                      <button
                        key={deal.id}
                        type="button"
                        onClick={() => setSelectedDealId(deal.id)}
                        className={`w-full rounded-lg border p-3 text-left transition-colors ${
                          selectedDealId === deal.id
                            ? "border-primary/40 bg-primary/10"
                            : "border-border/50 bg-background/40 hover:bg-muted/30"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-xs font-medium">{deal.name}</p>
                            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                              {[deal.address, deal.city, deal.state].filter(Boolean).join(", ") || "No address yet"}
                            </p>
                          </div>
                          {selectedDealId === deal.id && <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />}
                        </div>
                      </button>
                    ))
                  )}
                </div>

                <div className="mt-4 border-t border-border/50 pt-4">
                  <label className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                    New deal folder
                  </label>
                  <div className="mt-2 flex gap-2">
                    <input
                      value={newDealName}
                      onChange={(event) => setNewDealName(event.target.value)}
                      placeholder="e.g. 123 Main proposal"
                      className="min-w-0 flex-1 rounded-lg border border-border/50 bg-background/50 px-3 py-2 text-xs outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/15"
                    />
                    <Button onClick={createDealFolder} disabled={creatingDeal} size="sm" className="gap-1.5">
                      {creatingDeal ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                      Create
                    </Button>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-border/60 bg-card p-4">
                <div className="flex items-center gap-2">
                  <Upload className="h-4 w-4 text-primary" />
                  <h2 className="text-sm font-semibold">Upload</h2>
                </div>
                <label className="mt-3 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-border/60 bg-background/40 p-8 text-center transition-colors hover:border-primary/40 hover:bg-muted/20">
                  <Upload className="h-6 w-6 text-muted-foreground" />
                  <span className="mt-2 text-sm font-medium">Choose documents</span>
                  <span className="mt-1 text-xs text-muted-foreground">PDF, Word, Excel, text, or images</span>
                  <input
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(event) => setFiles(Array.from(event.target.files || []))}
                  />
                </label>
                {files.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {files.map((file) => (
                      <div key={`${file.name}-${file.size}`} className="flex items-center gap-2 rounded-lg border border-border/50 bg-background/50 p-2">
                        <FileText className="h-4 w-4 shrink-0 text-blue-400" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium">{file.name}</p>
                          <p className="text-[11px] text-muted-foreground">{formatBytes(file.size)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>

            <section className="space-y-4">
              <div className="rounded-xl border border-border/60 bg-card p-4">
                <label className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  Review focus
                </label>
                <div className="mt-2 grid gap-2 md:grid-cols-[1fr_auto]">
                  <select
                    value={selectedFrameworkId}
                    onChange={(event) => setSelectedFrameworkId(event.target.value)}
                    className="min-w-0 rounded-lg border border-border/50 bg-background/50 px-3 py-2 text-xs outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/15"
                  >
                    <option value="">No saved review framework</option>
                    {reviewFrameworks.map((framework) => (
                      <option key={framework.id} value={framework.id}>
                        {framework.title} ({framework.category.replace(/_/g, " ")})
                      </option>
                    ))}
                  </select>
                  <Button asChild variant="outline" size="sm" className="gap-1.5">
                    <Link href="/playbook">
                      Add framework
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </Button>
                </div>
                <textarea
                  value={focus}
                  onChange={(event) => setFocus(event.target.value)}
                  rows={3}
                  className="mt-2 w-full rounded-lg border border-border/50 bg-background/50 px-3 py-2 text-sm leading-6 outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/15"
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  {REVIEW_PRESETS.map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => setFocus(preset.prompt)}
                      className="rounded-full border border-border/60 bg-background/50 px-3 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs text-muted-foreground">
                    {selectedDeal ? `Filing into ${selectedDeal.name}` : "Pick a deal folder first"}
                  </p>
                  <Button onClick={uploadAndReview} disabled={uploading || !selectedDealId || files.length === 0} className="gap-1.5">
                    {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSearch className="h-4 w-4" />}
                    Review and file
                  </Button>
                </div>
              </div>

              {reviewedDocs.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border/60 bg-card/50 p-10 text-center">
                  <FileSearch className="mx-auto h-8 w-8 text-muted-foreground/40" />
                  <p className="mt-3 text-sm font-medium">No review yet</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Upload a proposal, OM, report, or plan and I will give you the practical readout.
                  </p>
                </div>
              ) : (
                reviewedDocs.map((row) => (
                  <ReviewCard
                    key={row.doc.id}
                    row={row}
                    dealId={selectedDealId}
                    updatingCategory={updatingCategory}
                    onApplyCategory={applyCategory}
                  />
                ))
              )}
            </section>
          </div>
        </main>
      </div>
    </AppShell>
  );
}

function ReviewCard({
  row,
  dealId,
  updatingCategory,
  onApplyCategory,
}: {
  row: ReviewedDoc;
  dealId: string;
  updatingCategory: string | null;
  onApplyCategory: (docId: string, category: string) => void;
}) {
  const review = row.review;
  const [taskState, setTaskState] = useState<Record<string, "saving" | "saved">>({});
  const suggestedCategory = review?.filing_suggestion.category as DocumentCategory | undefined;
  const currentCategory = row.doc.category as DocumentCategory;
  const canApplyCategory =
    suggestedCategory &&
    suggestedCategory !== currentCategory &&
    Boolean(DOCUMENT_CATEGORIES[suggestedCategory]);

  async function createTaskFromQuestion(question: string) {
    const key = question;
    setTaskState((prev) => ({ ...prev, [key]: "saving" }));
    try {
      const res = await fetch(`/api/deals/${dealId}/unified-tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: question,
          kind: "diligence",
          priority: "normal",
          status: "not_started",
          task_category: "document_review",
          notes: `Created from document review: ${row.doc.original_name || row.doc.name}`,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not create task");
      setTaskState((prev) => ({ ...prev, [key]: "saved" }));
      toast.success("Task created");
    } catch (error) {
      setTaskState((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      toast.error(error instanceof Error ? error.message : "Could not create task");
    }
  }

  return (
    <article className="rounded-xl border border-border/60 bg-card shadow-card">
      <div className="flex flex-col gap-3 border-b border-border/50 p-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="text-[10px]">
              {DOCUMENT_CATEGORIES[currentCategory]?.label || row.doc.category}
            </Badge>
            {review?.document_type && (
              <Badge variant="outline" className="text-[10px]">
                {review.document_type}
              </Badge>
            )}
            {row.saved_note_id && (
              <Badge variant="success" className="text-[10px]">
                Saved to deal
              </Badge>
            )}
          </div>
          <h2 className="mt-2 truncate text-base font-semibold">{row.doc.original_name}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Filed in this deal folder before review.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <Link href={`/api/documents/${row.doc.id}/view`} target="_blank">
              <FileText className="h-3.5 w-3.5" />
              Open
            </Link>
          </Button>
          <Button asChild size="sm" className="gap-1.5">
            <Link href={`/deals/${dealId}/documents`}>
              Folder
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>
      </div>

      {row.loading ? (
        <div className="flex items-center gap-2 p-5 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          Reviewing document
        </div>
      ) : row.error ? (
        <div className="flex items-start gap-2 p-5 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {row.error}
        </div>
      ) : review ? (
        <div className="space-y-4 p-4">
          <div className="rounded-lg border border-primary/20 bg-primary/10 p-3">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-primary">
              Bottom line
            </p>
            <p className="mt-1 text-sm leading-6">{review.executive_take}</p>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <ListBlock title="Key points" items={review.key_points} />
            <ListBlock
              title="Questions to ask"
              items={review.questions_to_ask}
              renderAction={(question) => (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={taskState[question] === "saving" || taskState[question] === "saved"}
                  onClick={() => createTaskFromQuestion(question)}
                  className="h-6 shrink-0 gap-1 px-2 text-[10px]"
                >
                  {taskState[question] === "saving" ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : taskState[question] === "saved" ? (
                    <CheckCircle2 className="h-3 w-3" />
                  ) : (
                    <Plus className="h-3 w-3" />
                  )}
                  {taskState[question] === "saved" ? "Task" : "Add task"}
                </Button>
              )}
            />
            <ListBlock title="Red flags" items={review.red_flags} tone="warning" />
            <ListBlock title="Missing items" items={review.missing_items} />
          </div>

          <div className="rounded-lg border border-border/50 bg-background/40 p-3">
            <div className="flex items-center gap-2">
              <FolderOpen className="h-4 w-4 text-primary" />
              <p className="text-sm font-medium">Filing suggestion</p>
            </div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              {review.filing_suggestion.deal_relevance}
            </p>
            {canApplyCategory && (
              <Button
                onClick={() => onApplyCategory(row.doc.id, suggestedCategory)}
                disabled={updatingCategory === row.doc.id}
                size="sm"
                variant="outline"
                className="mt-3 gap-1.5"
              >
                {updatingCategory === row.doc.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                )}
                File as {DOCUMENT_CATEGORIES[suggestedCategory]?.label}
              </Button>
            )}
          </div>

          {review.suggested_email && (
            <div className="rounded-lg border border-border/50 bg-background/40 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-primary" />
                  <p className="text-sm font-medium">Suggested email</p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 text-2xs"
                  onClick={() => {
                    navigator.clipboard.writeText(review.suggested_email);
                    toast.success("Email copied");
                  }}
                >
                  <Copy className="h-3.5 w-3.5" />
                  Copy
                </Button>
              </div>
              <pre className="mt-3 whitespace-pre-wrap rounded-md bg-black/20 p-3 text-xs leading-5 text-muted-foreground">
                {review.suggested_email}
              </pre>
            </div>
          )}
        </div>
      ) : null}
    </article>
  );
}

function ListBlock({
  title,
  items,
  tone = "default",
  renderAction,
}: {
  title: string;
  items: string[];
  tone?: "default" | "warning";
  renderAction?: (item: string) => ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border/50 bg-background/40 p-3">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {title}
      </p>
      {items.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">Nothing material flagged.</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {items.map((item, index) => (
            <li
              key={`${title}-${index}`}
              className={`flex items-start justify-between gap-2 text-xs leading-5 ${tone === "warning" ? "text-amber-200" : "text-muted-foreground"}`}
            >
              <span>{item}</span>
              {renderAction?.(item)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
