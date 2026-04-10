"use client";

import { useState, useEffect, useRef } from "react";
import { useDropzone } from "react-dropzone";
import {
  Upload,
  Loader2,
  Trash2,
  Mic,
  Video,
  AlertCircle,
  CheckCircle2,
  RefreshCcw,
  FileText,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { formatBytes } from "@/lib/utils";
import type { SiteWalkRecording, RecordingProcessingStatus } from "@/lib/types";

interface Props {
  dealId: string;
  walkId: string;
  recordings: SiteWalkRecording[];
  onChanged: () => void;
}

const STATUS_LABELS: Record<RecordingProcessingStatus, string> = {
  pending: "Pending",
  uploading: "Uploading",
  transcribing: "Transcribing",
  processing: "AI processing",
  completed: "Completed",
  error: "Error",
};

const STATUS_COLORS: Record<RecordingProcessingStatus, string> = {
  pending: "text-muted-foreground",
  uploading: "text-blue-400",
  transcribing: "text-blue-400",
  processing: "text-amber-400",
  completed: "text-emerald-400",
  error: "text-red-400",
};

export default function SiteWalkRecordings({ dealId, walkId, recordings, onChanged }: Props) {
  const [uploading, setUploading] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll for status updates while any recording is still processing
  useEffect(() => {
    const hasInflight = recordings.some(
      (r) => r.processing_status !== "completed" && r.processing_status !== "error"
    );
    if (!hasInflight) {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
      return;
    }
    if (pollRef.current) return;
    pollRef.current = setInterval(() => {
      onChanged();
    }, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [recordings, onChanged]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { "audio/*": [], "video/*": [] },
    multiple: false,
    onDrop: async (files) => {
      if (files.length === 0) return;
      setUploading(true);
      try {
        for (const file of files) {
          if (file.size > 25 * 1024 * 1024) {
            toast.error(`${file.name} is larger than 25MB (Whisper limit).`);
            continue;
          }
          const formData = new FormData();
          formData.append("file", file);
          const res = await fetch(
            `/api/deals/${dealId}/site-walks/${walkId}/recordings`,
            { method: "POST", body: formData }
          );
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            toast.error(err.error || `Failed to upload ${file.name}`);
            continue;
          }
          toast.success(`Uploaded ${file.name} — transcription in progress`);
        }
        onChanged();
      } catch (err) {
        console.error(err);
        toast.error("Upload failed");
      } finally {
        setUploading(false);
      }
    },
  });

  const retry = async (id: string) => {
    setRetrying(id);
    try {
      const res = await fetch(
        `/api/deals/${dealId}/site-walks/${walkId}/recordings/${id}/process`,
        { method: "POST" }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "Retry failed");
      } else {
        toast.success("Processing complete");
        onChanged();
      }
    } catch (err) {
      console.error(err);
      toast.error("Retry failed");
    } finally {
      setRetrying(null);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this recording?")) return;
    setDeleting(id);
    try {
      await fetch(
        `/api/deals/${dealId}/site-walks/${walkId}/recordings/${id}`,
        { method: "DELETE" }
      );
      toast.success("Recording deleted");
      onChanged();
    } catch (err) {
      console.error(err);
      toast.error("Failed to delete");
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="space-y-4">
      <div
        {...getRootProps()}
        className={`rounded-lg border-2 border-dashed p-6 text-center cursor-pointer transition-colors ${
          isDragActive ? "border-primary bg-primary/5" : "border-border/60 hover:bg-muted/20"
        }`}
      >
        <input {...getInputProps()} />
        {uploading ? (
          <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
        ) : (
          <>
            <Upload className="h-6 w-6 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm font-medium">Drop audio or video recording here</p>
            <p className="text-xs text-muted-foreground mt-1">
              Voice memo or video walkthrough — max 25MB. Transcribed automatically.
            </p>
          </>
        )}
      </div>

      {recordings.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-4">No recordings yet.</p>
      ) : (
        <div className="space-y-2">
          {recordings.map((rec) => {
            const Icon = rec.media_type === "video" ? Video : Mic;
            const isExpanded = expanded[rec.id] ?? false;
            const isInflight =
              rec.processing_status !== "completed" && rec.processing_status !== "error";
            return (
              <div
                key={rec.id}
                className="rounded-lg border border-border/60 bg-card/40 p-3 space-y-2"
              >
                <div className="flex items-start gap-3">
                  <Icon className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">{rec.original_name}</p>
                      <span className={`text-[10px] flex items-center gap-1 ${STATUS_COLORS[rec.processing_status]}`}>
                        {isInflight && <Loader2 className="h-3 w-3 animate-spin" />}
                        {rec.processing_status === "completed" && <CheckCircle2 className="h-3 w-3" />}
                        {rec.processing_status === "error" && <AlertCircle className="h-3 w-3" />}
                        {STATUS_LABELS[rec.processing_status]}
                      </span>
                    </div>
                    <div className="text-[11px] text-muted-foreground flex gap-2 mt-0.5">
                      <span>{formatBytes(rec.file_size)}</span>
                      {rec.duration_seconds !== null && (
                        <span>{Math.floor(rec.duration_seconds / 60)}m {rec.duration_seconds % 60}s</span>
                      )}
                      <span>{new Date(rec.created_at).toLocaleString()}</span>
                    </div>
                    {rec.error_message && (
                      <p className="text-[11px] text-red-400 mt-1">{rec.error_message}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {rec.processing_status === "error" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => retry(rec.id)}
                        disabled={retrying === rec.id}
                      >
                        {retrying === rec.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RefreshCcw className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => remove(rec.id)}
                      disabled={deleting === rec.id}
                    >
                      {deleting === rec.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                </div>

                {rec.media_type === "audio" && rec.processing_status !== "error" && (
                  <audio
                    controls
                    className="w-full h-8"
                    src={`/api/deals/${dealId}/site-walks/${walkId}/recordings/${rec.id}?binary=1`}
                  />
                )}

                {rec.transcript_cleaned && (
                  <div className="rounded-md bg-muted/20 px-2.5 py-2">
                    <button
                      onClick={() =>
                        setExpanded((prev) => ({ ...prev, [rec.id]: !isExpanded }))
                      }
                      className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
                    >
                      {isExpanded ? (
                        <ChevronDown className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5" />
                      )}
                      <FileText className="h-3.5 w-3.5" />
                      Cleaned transcript
                    </button>
                    {isExpanded && (
                      <p className="text-xs mt-2 whitespace-pre-wrap leading-relaxed">
                        {rec.transcript_cleaned}
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
