"use client"

import { useState, useCallback } from "react"
import { useDropzone } from "react-dropzone"
import { Upload, FileText, X, CheckCircle, AlertCircle } from "lucide-react"
import { cn, formatFileSize } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"

interface UploadedFile {
  id: string
  name: string
  size: number
  type: string
  status: "uploading" | "processing" | "completed" | "error"
  progress: number
  error?: string
}

export function UploadZone() {
  const [files, setFiles] = useState<UploadedFile[]>([])
  const [isUploading, setIsUploading] = useState(false)
  const { toast } = useToast()

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    setIsUploading(true)
    
    const newFiles: UploadedFile[] = acceptedFiles.map(file => ({
      id: Math.random().toString(36).substr(2, 9),
      name: file.name,
      size: file.size,
      type: file.type,
      status: "uploading",
      progress: 0
    }))

    setFiles(prev => [...newFiles, ...prev])

    // Simulate upload progress
    for (const file of newFiles) {
      for (let progress = 0; progress <= 100; progress += 10) {
        await new Promise(resolve => setTimeout(resolve, 100))
        setFiles(prev => prev.map(f => 
          f.id === file.id ? { ...f, progress } : f
        ))
      }

      // Simulate processing
      setFiles(prev => prev.map(f => 
        f.id === file.id ? { ...f, status: "processing" } : f
      ))

      await new Promise(resolve => setTimeout(resolve, 500))

      // Mark as completed
      setFiles(prev => prev.map(f => 
        f.id === file.id ? { ...f, status: "completed" } : f
      ))

      toast({
        title: "Document uploaded",
        description: `${file.name} has been processed successfully.`,
      })
    }

    setIsUploading(false)
  }, [toast])

  const removeFile = (id: string) => {
    setFiles(prev => prev.filter(file => file.id !== id))
  }

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'text/csv': ['.csv'],
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png': ['.png'],
    },
    maxSize: 50 * 1024 * 1024, // 50MB
    multiple: true
  })

  const getStatusIcon = (status: UploadedFile["status"]) => {
    switch (status) {
      case "uploading":
        return <div className="h-3 w-3 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
      case "processing":
        return <div className="h-3 w-3 rounded-full border-2 border-yellow-500 border-t-transparent animate-spin" />
      case "completed":
        return <CheckCircle className="h-4 w-4 text-green-500" />
      case "error":
        return <AlertCircle className="h-4 w-4 text-red-500" />
    }
  }

  const getStatusColor = (status: UploadedFile["status"]) => {
    switch (status) {
      case "uploading":
        return "text-blue-600"
      case "processing":
        return "text-yellow-600"
      case "completed":
        return "text-green-600"
      case "error":
        return "text-red-600"
    }
  }

  return (
    <div className="space-y-6">
      {/* Dropzone */}
      <div
        {...getRootProps()}
        className={cn(
          "border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors",
          isDragActive 
            ? "border-primary bg-primary/5" 
            : "border-gray-300 hover:border-primary hover:bg-gray-50"
        )}
      >
        <input {...getInputProps()} />
        <div className="space-y-4">
          <div className="inline-flex p-3 bg-primary/10 rounded-full">
            <Upload className="h-8 w-8 text-primary" />
          </div>
          <div>
            <h4 className="text-lg font-semibold text-gray-900">
              {isDragActive ? "Drop files here" : "Drag & drop files"}
            </h4>
            <p className="text-sm text-gray-600 mt-1">
              or click to browse. Supports PDF, DOCX, XLSX, CSV, JPG, PNG
            </p>
            <p className="text-xs text-gray-500 mt-2">Max file size: 50MB</p>
          </div>
        </div>
      </div>

      {/* Uploaded Files List */}
      {files.length > 0 && (
        <div className="space-y-3">
          <h4 className="font-medium text-gray-900">Uploaded Files</h4>
          <div className="space-y-2 max-h-64 overflow-y-auto scrollbar-thin">
            {files.map(file => (
              <div
                key={file.id}
                className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
              >
                <div className="flex items-center space-x-3 flex-1 min-w-0">
                  <FileText className="h-5 w-5 text-gray-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-2">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {file.name}
                      </p>
                      <span className={cn("text-xs font-medium", getStatusColor(file.status))}>
                        {file.status}
                      </span>
                    </div>
                    <div className="flex items-center space-x-4 mt-1">
                      <span className="text-xs text-gray-500">
                        {formatFileSize(file.size)}
                      </span>
                      {file.status === "uploading" && (
                        <div className="flex-1 max-w-xs">
                          <div className="h-1 bg-gray-200 rounded-full overflow-hidden">
                            <div 
                              className="h-full bg-primary transition-all duration-300"
                              style={{ width: `${file.progress}%` }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  {getStatusIcon(file.status)}
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      removeFile(file.id)
                    }}
                    className="p-1 hover:bg-gray-200 rounded transition-colors"
                  >
                    <X className="h-4 w-4 text-gray-500" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Uploading Indicator */}
      {isUploading && (
        <div className="flex items-center justify-center space-x-2 text-sm text-gray-600">
          <div className="h-3 w-3 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          <span>Processing documents...</span>
        </div>
      )}
    </div>
  )
}