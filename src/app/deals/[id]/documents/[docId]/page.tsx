"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  FileText,
  Folder,
  History,
  Loader2,
  MessageSquare,
  Send,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DOCUMENT_CATEGORIES, type Document, type DocumentCategory } from "@/lib/types";
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

type DealNote = {
  id: string;
  text: string;
  category: string;
  source?: string | null;
  created_at: string;
};

type VersionRow = {
  id: string;
  version: number;
  original_name: string;
  uploaded_at: string;
  file_size: number;
  parent_document_id: string | null;
};

function parseSummaryBullets(summary?: string | null): string[] {
  if (!summary?.trim()) return [];
  return summary
    .split(/\n|(?<=\.) /)
    .map((line) => line.trim().replace(/^[-*]\s*/, ""))
    .filter((line) => line.length > 4)
    .slice(0, 10);
}

function listFromSection(text: string, heading: string): string[] {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`${escaped}:\\n([\\s\\S]*?)(?:\\n\\n[A-Z][^\\n:]{2,}:|$)`, "i"));
  if (!match?.[1]) return [];
  return match[1]
    .split("\n")
    .map((line) => line.trim().replace(/^[-*]\s*/, ""))
    .filter((line) => line && !line.toLowerCase().startsWith("nothing material"));
}

function textAfterLabel(text: string, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`${escaped}:\\s*([\\s\\S]*?)(?:\\n\\n|$)`, "i"));
  return match?.[1]?.trim() || "";
}

function parseReviewNote(note: DealNote): ReviewResult | null {
  if (note.source !== "document_review") return null;
  return {
    document_type: textAfterLabel(note.text, "Type") || "Document review",
    executive_take: textAfterLabel(note.text, "Bottom line") || "No bottom line saved.",
    key_points: listFromSection(note.text, "Key points"),
    red_flags: listFromSection(note.text, "Red flags"),
    missing_items: listFromSection(note.text, "Missing items"),
    questions_to_ask: listFromSection(note.text, "Questions to ask"),
    suggested_email: textAfterLabel(note.text, "Suggested email"),
    filing_suggestion: {
      category: "other",
      deal_relevance: "Saved review note.",
    },
  };
}

function matchesDocumentReview(note: DealNote, doc: Document) {
  if (note.source !== "document_review") return false;
  const haystack = note.text.toLowerCase();
  return haystack.includes(doc.original_name.toLowerCase()) || haystack.includes(doc.name.toLowerCase());
}

function formatDate(value?: string | null) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function canPreview(doc: Document) {
  return doc.mime_type === "application/pdf" || doc.mime_type.startsWith("image/");
}

export default function DocumentDetailPage({
  params,
}: {
  params: { id: string; docId: string };
}) {
  const [doc, setDoc] = useState<Document | null>(null);
  const [notes, setNotes] = useState<DealNote[]>([]);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewing, setReviewing] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [reviewFocus, setReviewFocus] = useState(
    "Review this document as my personal real estate development associate. Be concise, flag what matters, and say plainly when the file does not answer something."
  );
  const [liveReview, setLiveReview] = useState<ReviewResult | null>(null);
  const [liveReviewNoteId, setLiveReviewNoteId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [docRes, notesRes, versionsRes] = await Promise.all([
        fetch(`/api/documents/${params.docId}`),
        fetch(`/api/deals/${params.id}/notes`).catch(() => null),
        fetch(`/api/deals/${params.id}/documents/${params.docId}/versions`).catch(() => null),
      ]);
      const docJson = await docRes.json().catch(() => ({}));
      if (!docRes.ok) throw new Error(docJson.error || "Document not found");
      setDoc(docJson.data);
      const notesJson = notesRes ? await notesRes.json().catch(() => ({})) : {};
      setNotes(Array.isArray(notesJson.data) ? notesJson.data : []);
      const versionsJson = versionsRes ? await versionsRes.json().catch(() => ({})) : {};
      setVersions(Array.isArray(versionsJson.data) ? versionsJson.data : []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load document");
    } finally {
      setLoading(false);
    }
  }, [params.docId, params.id]);

  useEffect(() => {
    load();
  }, [load]);

  const savedReviews = useMemo(() => {
    if (!doc) return [];
    return notes
      .filter((note) => matchesDocumentReview(note, doc))
      .map((note) => ({ note, review: parseReviewNote(note) }))
      .filter((row): row is { note: DealNote; review: ReviewResult } => Boolean(row.review))
      .sort((a, b) => new Date(b.note.created_at).getTime() - new Date(a.note.created_at).getTime());
  }, [doc, notes]);

  const activeReview = liveReview || savedReviews[0]?.review || null;
  const activeReviewId = liveReviewNoteId || savedReviews[0]?.note.id || params.docId;
  const summaryBullets = parseSummaryBullets(doc?.ai_summary);
  const tags = useMemo(() => {
    if (!doc?.ai_tags) return [];
    try {
      const parsed = typeof doc.ai_tags === "string" ? JSON.parse(doc.ai_tags) : doc.ai_tags;
      return Array.isArray(parsed) ? parsed.map(String).slice(0, 8) : [];
    } catch {
      return [];
    }
  }, [doc?.ai_tags]);

  const runReview = async () => {
    if (!doc) return;
    setReviewing(true);
    try {
      const res = await fetch(`/api/documents/${doc.id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ focus: reviewFocus }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not review this document");
      const data = json.data || {};
      setLiveReview((data.review || data) as ReviewResult);
      setLiveReviewNoteId(data.saved_note_id || null);
      await load();
      toast.success("Review saved to this deal");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not review this document");
    } finally {
      setReviewing(false);
    }
  };

  const pushReviewToNotion = async () => {
    if (!doc || !activeReview) return;
    setPushing(true);
    try {
      const approved_items = {
        rfis: activeReview.questions_to_ask.map((question) => ({
          question,
          status: "Open",
          priority: "P2 - Medium",
          phase: "Diligence",
        })),
        risks: activeReview.red_flags.map((title) => ({
          title,
          severity: "Medium",
          status: "Open",
          phase: "Diligence",
          mitigation: "Review with the deal team and assign owner in Notion.",
        })),
        tasks: activeReview.missing_items.map((title) => ({
          title,
          status: "Not Started",
          priority: "P2 - Medium",
          phase: "Diligence",
          category: "Document Review",
        })),
        documents: [
          {
            title: doc.original_name,
            type: DOCUMENT_CATEGORIES[doc.category as DocumentCategory]?.label || doc.category,
            status: "In Review",
            link: typeof window !== "undefined" ? window.location.href : undefined,
            notes: activeReview.executive_take,
          },
        ],
        notes: [
          {
            title: `Review: ${doc.original_name}`,
            type: "Document Review",
            summary: activeReview.executive_take,
          },
        ],
      };
      const res = await fetch(`/api/review-packets/${activeReviewId}/push-to-notion`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deal_id: params.id, approved_items }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not push to Notion");
      toast.success("Review pushed to Notion");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not push to Notion");
    } finally {
      setPushing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[420px] items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        Loading document
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="rounded-xl border border-border/60 bg-card p-8 text-center">
        <FileText className="mx-auto h-8 w-8 text-muted-foreground/40" />
        <p className="mt-3 text-sm font-medium">Document not found</p>
        <Link href={`/deals/${params.id}/documents`} className="mt-3 inline-flex text-sm text-primary">
          Back to documents
        </Link>
      </div>
    );
  }

  const category = DOCUMENT_CATEGORIES[doc.category as DocumentCategory];

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <Link
            href={`/deals/${params.id}/documents`}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Documents
          </Link>
          <div className="mt-3 flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-card text-xl">
              {category?.icon || <FileText className="h-5 w-5" />}
            </span>
            <div className="min-w-0">
              <h1 className="line-clamp-2 font-display text-2xl leading-tight">{doc.original_name}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{category?.label || doc.category}</Badge>
                {doc.is_key && <Badge variant="outline" className="border-amber-500/30 text-amber-300">Key document</Badge>}
                {doc.version > 1 && <Badge variant="outline">v{doc.version}</Badge>}
                <span className="text-xs text-muted-foreground">{formatBytes(doc.file_size)}</span>
                <span className="text-xs text-muted-foreground">{formatDate(doc.uploaded_at)}</span>
              </div>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={`/api/documents/${doc.id}/view`} target="_blank" rel="noreferrer">
            <Button variant="outline" size="sm" className="gap-1.5">
              <ExternalLink className="h-3.5 w-3.5" />
              Open file
            </Button>
          </a>
          <Link href={`/deals/${params.id}/chat?prompt=${encodeURIComponent(`Use the document "${doc.original_name}" as context. Give me the key points, open questions, and recommended next action. Keep it concise.`)}`}>
            <Button variant="outline" size="sm" className="gap-1.5">
              <MessageSquare className="h-3.5 w-3.5" />
              Ask
            </Button>
          </Link>
          <Button size="sm" className="gap-1.5" onClick={runReview} disabled={reviewing}>
            {reviewing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            Run review
          </Button>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,0.95fr)_minmax(360px,0.65fr)]">
        <section className="space-y-5">
          <div className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-card">
            <div className="flex items-center justify-between border-b border-border/40 px-4 py-3">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold">File preview</h2>
              </div>
              {!canPreview(doc) && <span className="text-xs text-muted-foreground">Preview unavailable</span>}
            </div>
            {canPreview(doc) ? (
              doc.mime_type.startsWith("image/") ? (
                <div className="flex min-h-[520px] items-center justify-center bg-muted/30 p-4">
                  <img src={`/api/documents/${doc.id}/view`} alt={doc.original_name} className="max-h-[720px] max-w-full rounded-lg object-contain" />
                </div>
              ) : (
                <iframe src={`/api/documents/${doc.id}/view`} title={doc.original_name} className="h-[720px] w-full bg-muted" />
              )
            ) : (
              <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 p-8 text-center">
                <FileText className="h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm font-medium">This file type cannot be previewed inline.</p>
                <a href={`/api/documents/${doc.id}/view`} target="_blank" rel="noreferrer" className="text-sm text-primary">
                  Open original file
                </a>
              </div>
            )}
          </div>

          <DetailCard title="Extracted text" icon={<FileText className="h-4 w-4 text-blue-400" />}>
            {doc.content_text?.trim() ? (
              <div className="max-h-[460px] overflow-y-auto whitespace-pre-wrap rounded-lg border border-border/50 bg-background/50 p-3 text-xs leading-5 text-muted-foreground">
                {doc.content_text}
              </div>
            ) : (
              <EmptyState text="No extractable text was stored for this document. For drawings, run review so the assistant can use visual page snapshots where available." />
            )}
          </DetailCard>
        </section>

        <aside className="space-y-5">
          <DetailCard title="Review" icon={<Sparkles className="h-4 w-4 text-primary" />}>
            <textarea
              value={reviewFocus}
              onChange={(event) => setReviewFocus(event.target.value)}
              rows={3}
              className="mb-3 w-full rounded-lg border border-border/50 bg-background/50 px-3 py-2 text-xs leading-5 outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/15"
            />
            {activeReview ? (
              <ReviewPanel review={activeReview} />
            ) : (
              <EmptyState text="No saved review yet. Run a review to organize the findings, questions, missing items, and red flags." />
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" className="gap-1.5" onClick={runReview} disabled={reviewing}>
                {reviewing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                {activeReview ? "Refresh review" : "Run review"}
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={pushReviewToNotion} disabled={!activeReview || pushing}>
                {pushing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                Push to Notion
              </Button>
            </div>
          </DetailCard>

          <DetailCard title="AI summary" icon={<CheckCircle2 className="h-4 w-4 text-emerald-400" />}>
            {summaryBullets.length > 0 ? (
              <ul className="space-y-2">
                {summaryBullets.map((bullet, index) => (
                  <li key={index} className="flex gap-2 text-xs leading-5 text-muted-foreground">
                    <Sparkles className="mt-1 h-3 w-3 shrink-0 text-primary" />
                    <span>{bullet}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState text="No AI summary stored yet." />
            )}
          </DetailCard>

          <DetailCard title="File record" icon={<Folder className="h-4 w-4 text-amber-400" />}>
            <dl className="grid grid-cols-2 gap-3 text-xs">
              <Meta label="Category" value={category?.label || doc.category} />
              <Meta label="MIME type" value={doc.mime_type} />
              <Meta label="Uploaded" value={formatDate(doc.uploaded_at)} />
              <Meta label="Size" value={formatBytes(doc.file_size)} />
              <Meta label="Document ID" value={doc.id} mono />
              <Meta label="Deal ID" value={doc.deal_id} mono />
            </dl>
            {tags.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {tags.map((tag) => (
                  <Badge key={tag} variant="outline" className="text-[10px]">{tag}</Badge>
                ))}
              </div>
            )}
          </DetailCard>

          <DetailCard title="Review history" icon={<History className="h-4 w-4 text-purple-400" />}>
            {savedReviews.length > 0 ? (
              <div className="space-y-2">
                {savedReviews.map(({ note }) => (
                  <div key={note.id} className="rounded-lg border border-border/50 bg-background/50 p-3">
                    <p className="text-xs font-medium">{formatDate(note.created_at)}</p>
                    <p className="mt-1 line-clamp-3 text-xs leading-5 text-muted-foreground">{textAfterLabel(note.text, "Bottom line") || note.text}</p>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState text="No saved review notes found for this document." />
            )}
          </DetailCard>

          <DetailCard title="Versions" icon={<History className="h-4 w-4 text-muted-foreground" />}>
            {versions.length > 0 ? (
              <div className="space-y-2">
                {versions.map((version) => (
                  <Link
                    key={version.id}
                    href={`/deals/${params.id}/documents/${version.id}`}
                    className={`flex items-center justify-between gap-3 rounded-lg border p-3 text-xs transition-colors hover:bg-muted/30 ${
                      version.id === doc.id ? "border-primary/30 bg-primary/5" : "border-border/50 bg-background/50"
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">v{version.version} - {version.original_name}</span>
                      <span className="mt-0.5 block text-muted-foreground">{formatDate(version.uploaded_at)} - {formatBytes(version.file_size)}</span>
                    </span>
                    <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  </Link>
                ))}
              </div>
            ) : (
              <EmptyState text="No version chain found." />
            )}
          </DetailCard>
        </aside>
      </div>
    </div>
  );
}

function DetailCard({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border/60 bg-card p-4 shadow-card">
      <div className="mb-3 flex items-center gap-2">
        {icon}
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p className="rounded-lg border border-dashed border-border/60 p-3 text-xs leading-5 text-muted-foreground">{text}</p>;
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{label}</dt>
      <dd className={`mt-1 truncate text-foreground ${mono ? "font-mono text-[10px]" : ""}`}>{value || "-"}</dd>
    </div>
  );
}

function ReviewPanel({ review }: { review: ReviewResult }) {
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-primary/20 bg-primary/10 p-3">
        <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-primary">{review.document_type}</p>
        <p className="mt-1 text-sm leading-6">{review.executive_take}</p>
      </div>
      <ReviewList title="Key points" items={review.key_points} icon={<CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />} />
      <ReviewList title="Red flags" items={review.red_flags} icon={<AlertTriangle className="h-3.5 w-3.5 text-amber-400" />} />
      <ReviewList title="Missing items" items={review.missing_items} icon={<FileText className="h-3.5 w-3.5 text-blue-400" />} />
      <ReviewList title="Questions to ask" items={review.questions_to_ask} icon={<MessageSquare className="h-3.5 w-3.5 text-primary" />} />
      {review.suggested_email && (
        <div>
          <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">Suggested email</p>
          <div className="whitespace-pre-wrap rounded-lg border border-border/50 bg-background/50 p-3 text-xs leading-5 text-muted-foreground">
            {review.suggested_email}
          </div>
        </div>
      )}
    </div>
  );
}

function ReviewList({ title, items, icon }: { title: string; items: string[]; icon: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        {icon}
        {title}
      </div>
      {items.length > 0 ? (
        <ul className="space-y-1.5">
          {items.map((item, index) => (
            <li key={index} className="rounded-lg border border-border/50 bg-background/50 p-2 text-xs leading-5 text-muted-foreground">
              {item}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState text="Nothing material saved in this section." />
      )}
    </div>
  );
}
