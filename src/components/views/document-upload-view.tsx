"use client"

import { useState } from "react"
import { 
  Upload, 
  BarChart3, 
  MessageSquare, 
  FileText,
  ChevronRight,
  Clock,
  CheckCircle2,
  Sparkles
} from "lucide-react"
import { UploadZone } from "@/components/upload/upload-zone"
import { DocumentList } from "@/components/upload/document-list"
import { AnalysisDashboard } from "@/components/analysis/dashboard"
import { DocumentViewer } from "@/components/analysis/document-viewer"
import { ChatInterface } from "@/components/chat/chat-interface"
import { cn } from "@/lib/utils"

type ViewTab = 'upload' | 'analysis' | 'viewer' | 'chat'

export function DocumentUploadView() {
  const [activeTab, setActiveTab] = useState<ViewTab>('upload')
  const [hasDocument, setHasDocument] = useState(true) // Demo mode - assume document uploaded

  const tabs = [
    { id: 'upload' as const, label: 'Upload', icon: Upload },
    { id: 'viewer' as const, label: 'Document', icon: FileText, requiresDoc: true },
    { id: 'analysis' as const, label: 'Analysis', icon: BarChart3, requiresDoc: true },
    { id: 'chat' as const, label: 'Q&A', icon: MessageSquare, requiresDoc: true },
  ]

  return (
    <div className="space-y-6">
      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-blue-50 rounded-lg">
              <Clock className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">48 min</p>
              <p className="text-sm text-gray-500">→ 10 min</p>
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-2">Time saved per document</p>
        </div>
        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-green-50 rounded-lg">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">95%</p>
              <p className="text-sm text-gray-500">Accuracy</p>
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-2">Metric extraction rate</p>
        </div>
        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-purple-50 rounded-lg">
              <Sparkles className="h-5 w-5 text-purple-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">AI</p>
              <p className="text-sm text-gray-500">Powered</p>
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-2">Claude 3.5 & GPT-4</p>
        </div>
        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-amber-50 rounded-lg">
              <FileText className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">24/7</p>
              <p className="text-sm text-gray-500">Available</p>
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-2">Instant analysis</p>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="flex border-b border-gray-200">
          {tabs.map(tab => {
            const Icon = tab.icon
            const isDisabled = tab.requiresDoc && !hasDocument
            const isActive = activeTab === tab.id

            return (
              <button
                key={tab.id}
                onClick={() => !isDisabled && setActiveTab(tab.id)}
                disabled={isDisabled}
                className={cn(
                  "flex items-center space-x-2 px-6 py-4 text-sm font-medium transition-colors relative",
                  isActive 
                    ? "text-primary bg-primary/5" 
                    : isDisabled
                      ? "text-gray-300 cursor-not-allowed"
                      : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
                )}
              >
                <Icon className="h-4 w-4" />
                <span>{tab.label}</span>
                {isActive && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
                )}
              </button>
            )
          })}
        </div>

        {/* Tab Content */}
        <div className="p-6">
          {activeTab === 'upload' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl font-semibold text-gray-900 mb-2">
                    Upload Documents
                  </h2>
                  <p className="text-gray-600">
                    Upload OMs, rent rolls, financial statements, or property photos. 
                    We support PDF, DOCX, XLSX, CSV, JPG, and PNG files up to 50MB.
                  </p>
                </div>
                <UploadZone />
              </div>
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl font-semibold text-gray-900 mb-2">
                    Recent Documents
                  </h2>
                  <p className="text-gray-600">
                    Select a document to view analysis and ask questions.
                  </p>
                </div>
                <DocumentList />
              </div>
            </div>
          )}

          {activeTab === 'viewer' && hasDocument && (
            <div className="h-[700px]">
              <DocumentViewer />
            </div>
          )}

          {activeTab === 'analysis' && hasDocument && (
            <AnalysisDashboard />
          )}

          {activeTab === 'chat' && hasDocument && (
            <div className="max-w-4xl mx-auto">
              <div className="mb-6">
                <h2 className="text-xl font-semibold text-gray-900 mb-2">
                  Ask Questions About Your Document
                </h2>
                <p className="text-gray-600">
                  Chat with AI about the deal. Get instant answers with citations to specific pages.
                </p>
              </div>
              <ChatInterface />
            </div>
          )}
        </div>
      </div>

      {/* How It Works */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8">
        <h3 className="text-xl font-bold text-gray-900 mb-8 text-center">How It Works</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="text-center">
            <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Upload className="h-8 w-8 text-blue-600" />
            </div>
            <h4 className="text-lg font-semibold mb-2">1. Upload Documents</h4>
            <p className="text-gray-600 text-sm">
              Drag and drop PDFs, spreadsheets, or images. Automatic OCR for scanned documents.
            </p>
          </div>
          <div className="text-center">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <BarChart3 className="h-8 w-8 text-green-600" />
            </div>
            <h4 className="text-lg font-semibold mb-2">2. AI Analysis</h4>
            <p className="text-gray-600 text-sm">
              Our AI extracts key metrics, detects red flags, and generates a deal score.
            </p>
          </div>
          <div className="text-center">
            <div className="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <MessageSquare className="h-8 w-8 text-purple-600" />
            </div>
            <h4 className="text-lg font-semibold mb-2">3. Get Answers</h4>
            <p className="text-gray-600 text-sm">
              Ask natural language questions and get instant answers with source citations.
            </p>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-xl p-6 text-white">
          <h3 className="text-lg font-semibold mb-2">New Offering Memorandum?</h3>
          <p className="text-blue-100 text-sm mb-4">
            Upload an OM to get instant analysis, red flag detection, and financial metric extraction.
          </p>
          <button 
            onClick={() => setActiveTab('upload')}
            className="inline-flex items-center text-sm font-medium hover:underline"
          >
            Upload now
            <ChevronRight className="h-4 w-4 ml-1" />
          </button>
        </div>
        <div className="bg-gradient-to-r from-slate-700 to-slate-800 rounded-xl p-6 text-white">
          <h3 className="text-lg font-semibold mb-2">Notion Integration</h3>
          <p className="text-slate-300 text-sm mb-4">
            Sync your deal analysis directly to Notion. Keep your pipeline organized and accessible.
          </p>
          <button className="inline-flex items-center text-sm font-medium hover:underline">
            Configure integration
            <ChevronRight className="h-4 w-4 ml-1" />
          </button>
        </div>
      </div>
    </div>
  )
}
