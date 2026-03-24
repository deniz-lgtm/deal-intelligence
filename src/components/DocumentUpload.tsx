"use client";

import { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import {
  Upload,
  FileText,
  File,
  X,
  CheckCircle,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, formatBytes } from "@/lib/utils";

interface UploadFile {
  file: File;
  status: "pending" | "uploading" | "done" | "error";
  error?: string;
  result?: unknown;
}

interface DocumentUploadProps {
  dealId: string;
  onUploadComplete?: () => void;
}

export default function DocumentUpload({
  dealId,
  onUploadComplete,
}: DocumentUploadProps) {
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [uploading, setUploading] = useState(false);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const newFiles = acceptedFiles.map((f) => ({
      file: f,
      status: "pending" as const,
    }));
    setFiles((prev) => [...prev, ...newFiles]);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "application/pdf": [".pdf"],
      "text/plain": [".txt"],
      "application/msword": [".doc"],
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        [".docx"],
      "application/vnd.ms-excel": [".xls"],
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [
        ".xlsx",
      ],
      "image/*": [".png", ".jpg", ".jpeg", ".webp"],
    },
    maxSize: 50 * 1024 * 1024, // 50MB
  });

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const uploadAll = async () => {
    if (files.length === 0) return;
    setUploading(true);

    const pendingFiles = files.filter((f) => f.status === "pending");
    let successCount = 0;

    for (let i = 0; i < pendingFiles.length; i++) {
      const uf = pendingFiles[i];
      const idx = files.indexOf(uf);

      setFiles((prev) =>
        prev.map((f, j) =>
          j === idx ? { ...f, status: "uploading" } : f
        )
      );

      try {
        const formData = new FormData();
        formData.append("deal_id", dealId);
        formData.append("files", uf.file);

        const res = await fetch("/api/documents/upload", {
          method: "POST",
          body: formData,
        });

        const json = await res.json();

        if (res.ok) {
          successCount++;
          setFiles((prev) =>
            prev.map((f, j) =>
              j === idx ? { ...f, status: "done", result: json.data } : f
            )
          );
        } else {
          setFiles((prev) =>
            prev.map((f, j) =>
              j === idx
                ? { ...f, status: "error", error: json.error || "Upload failed" }
                : f
            )
          );
        }
      } catch {
        setFiles((prev) =>
          prev.map((f, j) =>
            j === idx ? { ...f, status: "error", error: "Network error" } : f
          )
        );
      }
    }

    setUploading(false);
    if (successCount > 0) {
      onUploadComplete?.();
    }
  };

  const pendingCount = files.filter((f) => f.status === "pending").length;
  const doneCount = files.filter((f) => f.status === "done").length;

  return (
    <div className="space-y-4">
      <div
        {...getRootProps()}
        className={cn(
          "border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all",
          isDragActive
            ? "border-primary bg-primary/5"
            : "border-border hover:border-primary/50 hover:bg-muted/30"
        )}
      >
        <input {...getInputProps()} />
        <Upload
          className={cn(
            "mx-auto h-10 w-10 mb-3 transition-colors",
            isDragActive ? "text-primary" : "text-muted-foreground"
          )}
        />
        <p className="text-sm font-medium text-foreground">
          {isDragActive ? "Drop files here" : "Drop files or click to upload"}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          PDF, DOC, DOCX, XLS, XLSX, TXT, Images — up to 50MB each
        </p>
        <p className="text-xs text-primary mt-2 font-medium">
          AI will automatically classify and summarize each document
        </p>
      </div>

      {files.length > 0 && (
        <div className="space-y-2">
          {files.map((uf, i) => (
            <div
              key={i}
              className="flex items-center gap-3 p-3 rounded-lg border bg-card text-sm"
            >
              <FileIcon mimeType={uf.file.type} />
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{uf.file.name}</p>
                <p className="text-xs text-muted-foreground">
                  {formatBytes(uf.file.size)}
                </p>
              </div>
              <StatusIcon status={uf.status} error={uf.error} />
              {uf.status === "pending" && (
                <button
                  onClick={() => removeFile(i)}
                  className="text-muted-foreground hover:text-destructive transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}

          <div className="flex items-center justify-between pt-2">
            <p className="text-xs text-muted-foreground">
              {doneCount > 0 && `${doneCount} uploaded. `}
              {pendingCount > 0 && `${pendingCount} ready to upload.`}
            </p>
            {pendingCount > 0 && (
              <Button onClick={uploadAll} disabled={uploading} size="sm">
                {uploading ? (
                  <>
                    <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                    Uploading & analyzing...
                  </>
                ) : (
                  <>
                    <Upload className="h-3 w-3 mr-2" />
                    Upload {pendingCount} file{pendingCount !== 1 ? "s" : ""}
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function FileIcon({ mimeType }: { mimeType: string }) {
  if (mimeType === "application/pdf") {
    return <FileText className="h-5 w-5 text-red-500 shrink-0" />;
  }
  return <File className="h-5 w-5 text-blue-500 shrink-0" />;
}

function StatusIcon({
  status,
  error,
}: {
  status: UploadFile["status"];
  error?: string;
}) {
  if (status === "uploading") {
    return <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />;
  }
  if (status === "done") {
    return <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />;
  }
  if (status === "error") {
    return (
      <span
        className="text-destructive shrink-0"
        title={error || "Error"}
      >
        <AlertCircle className="h-4 w-4" />
      </span>
    );
  }
  return null;
}
