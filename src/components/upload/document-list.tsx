"use client"

import { useState } from "react"
import { FileText, Trash2, Eye, Clock, CheckCircle, AlertCircle } from "lucide-react"
import { cn, formatFileSize, formatDate } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"

interface Document {
  id: string
  filename: string
  filetype: string
  size: number
  uploadDate: Date
  status: 'processing' | 'processed' | 'error'
}

// Mock data for demo
const MOCK_DOCUMENTS: Document[] = [
  {
    id: "1",
    filename: "Sunset_Gardens_OM_2024.pdf",
    filetype: "application/pdf",
    size: 4523456,
    uploadDate: new Date(Date.now() - 1000 * 60 * 30), // 30 mins ago
    status: "processed"
  },
  {
    id: "2",
    filename: "Oakwood_Apartments_RentRoll.xlsx",
    filetype: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    size: 128456,
    uploadDate: new Date(Date.now() - 1000 * 60 * 60 * 2), // 2 hours ago
    status: "processed"
  },
  {
    id: "3",
    filename: "Marina_Bay_Financials.pdf",
    filetype: "application/pdf",
    size: 3256789,
    uploadDate: new Date(Date.now() - 1000 * 60 * 60 * 24), // 1 day ago
    status: "processed"
  }
]

export function DocumentList() {
  const [documents, setDocuments] = useState<Document[]>(MOCK_DOCUMENTS)
  const [selectedId, setSelectedId] = useState<string | null>("1")
  const { toast } = useToast()

  const getStatusIcon = (status: Document['status']) => {
    switch (status) {
      case 'processing':
        return <Clock className="h-4 w-4 text-yellow-500" />
      case 'processed':
        return <CheckCircle className="h-4 w-4 text-green-500" />
      case 'error':
        return <AlertCircle className="h-4 w-4 text-red-500" />
    }
  }

  const handleDelete = (id: string, filename: string) => {
    setDocuments(prev => prev.filter(doc => doc.id !== id))
    toast({
      title: "Document deleted",
      description: `${filename} has been removed.`
    })
  }

  const handleView = (id: string) => {
    setSelectedId(id)
    toast({
      title: "Document selected",
      description: "Analysis dashboard updated with document data."
    })
  }

  return (
    <div className="space-y-3">
      {documents.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <FileText className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No documents yet</p>
          <p className="text-xs text-gray-400 mt-1">Upload your first document above</p>
        </div>
      ) : (
        <div className="space-y-2">
          {documents.map(doc => (
            <div
              key={doc.id}
              className={cn(
                "group flex items-center justify-between p-3 rounded-lg border transition-all cursor-pointer",
                selectedId === doc.id
                  ? "bg-primary/5 border-primary/30"
                  : "bg-white border-gray-200 hover:border-gray-300"
              )}
              onClick={() => handleView(doc.id)}
            >
              <div className="flex items-center space-x-3 flex-1 min-w-0">
                <div className="p-2 bg-gray-100 rounded-lg flex-shrink-0">
                  <FileText className="h-4 w-4 text-gray-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {doc.filename}
                  </p>
                  <div className="flex items-center space-x-2 mt-0.5">
                    <span className="text-xs text-gray-500">
                      {formatFileSize(doc.size)}
                    </span>
                    <span className="text-xs text-gray-400">•</span>
                    <span className="text-xs text-gray-500">
                      {formatDate(doc.uploadDate)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    handleView(doc.id)
                  }}
                  className="p-1.5 hover:bg-gray-100 rounded-md transition-colors"
                  title="View document"
                >
                  <Eye className="h-4 w-4 text-gray-500" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDelete(doc.id, doc.filename)
                  }}
                  className="p-1.5 hover:bg-red-50 rounded-md transition-colors"
                  title="Delete document"
                >
                  <Trash2 className="h-4 w-4 text-red-500" />
                </button>
              </div>

              <div className="ml-2">
                {getStatusIcon(doc.status)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
