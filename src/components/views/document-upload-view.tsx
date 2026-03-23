"use client"

import { useState } from "react"
import { 
  Upload, 
  BarChart3, 
  MessageSquare, 
  FileText,
  ChevronRight,
  Zap,
  TrendingUp,
  Brain
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
  const [hasDocument, setHasDocument] = useState(true)

  const tabs = [
    { id: 'upload' as const, label: 'Upload', icon: Upload },
    { id: 'viewer' as const, label: 'Document', icon: FileText, requiresDoc: true },
    { id: 'analysis' as const, label: 'Analysis', icon: BarChart3, requiresDoc: true },
    { id: 'chat' as const, label: 'Q&A', icon: MessageSquare, requiresDoc: true },
  ]

  return (
    <div className="space-y-8">
      {/* Impact Metrics - Refined Card Design */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="group relative bg-white border border-gray-200 rounded-lg p-6 hover:shadow-md transition-shadow duration-300">
          <div className="flex items-start justify-between">
            <div className="space-y-2">
              <div className="flex items-center space-x-2 text-gray-600 text-sm font-medium">
                <Zap className="h-4 w-4" />
                <span>Time Saved</span>
              </div>
              <p className="text-3xl font-bold text-gray-900">10 min</p>
              <p className="text-xs text-gray-500">vs 48 min manual</p>
            </div>
          </div>
          <div className="absolute inset-0 border border-gray-100 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
        </div>

        <div className="group relative bg-white border border-gray-200 rounded-lg p-6 hover:shadow-md transition-shadow duration-300">
          <div className="flex items-start justify-between">
            <div className="space-y-2">
              <div className="flex items-center space-x-2 text-gray-600 text-sm font-medium">
                <Brain className="h-4 w-4" />
                <span>Accuracy</span>
              </div>
              <p className="text-3xl font-bold text-gray-900">95%</p>
              <p className="text-xs text-gray-500">metric extraction</p>
            </div>
          </div>
        </div>

        <div className="group relative bg-white border border-gray-200 rounded-lg p-6 hover:shadow-md transition-shadow duration-300">
          <div className="flex items-start justify-between">
            <div className="space-y-2">
              <div className="flex items-center space-x-2 text-gray-600 text-sm font-medium">
                <TrendingUp className="h-4 w-4" />
                <span>Insight Depth</span>
              </div>
              <p className="text-3xl font-bold text-gray-900">Multi</p>
              <p className="text-xs text-gray-500">document analysis</p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content - Clean Tab Interface */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        {/* Tab Navigation - Minimal, Clean */}
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
                  "flex-1 flex items-center justify-center space-x-2 px-6 py-4 text-sm font-medium transition-all duration-200 border-b-2",
                  isActive 
                    ? "text-gray-900 border-gray-900 bg-white" 
                    : isDisabled
                      ? "text-gray-300 cursor-not-allowed border-transparent"
                      : "text-gray-600 border-transparent hover:text-gray-900"
                )}
              >
                <Icon className="h-4 w-4" />
                <span>{tab.label}</span>
              </button>
            )
          })}
        </div>

        {/* Tab Content - Generous Padding */}
        <div className="p-8">
          {activeTab === 'upload' && (
            <div className="space-y-8">
              <div>
                <h2 className="text-2xl font-bold text-gray-900 mb-2">Analyze Your Deals</h2>
                <p className="text-gray-600 max-w-2xl">
                  Upload offering memorandums, rent rolls, financials, or property photos. We extract metrics, identify risks, and generate actionable insights in seconds.
                </p>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Upload Document</h3>
                  <UploadZone />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Recent Uploads</h3>
                  <DocumentList />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'viewer' && hasDocument && (
            <div className="space-y-4">
              <h2 className="text-2xl font-bold text-gray-900">Document Viewer</h2>
              <div className="h-[700px] bg-gray-50 rounded-lg overflow-hidden border border-gray-200">
                <DocumentViewer />
              </div>
            </div>
          )}

          {activeTab === 'analysis' && hasDocument && (
            <div className="space-y-4">
              <h2 className="text-2xl font-bold text-gray-900">Deal Analysis</h2>
              <AnalysisDashboard />
            </div>
          )}

          {activeTab === 'chat' && hasDocument && (
            <div className="space-y-4">
              <div>
                <h2 className="text-2xl font-bold text-gray-900 mb-2">Ask Questions</h2>
                <p className="text-gray-600">
                  Chat with AI about your deal. Get instant answers with source citations.
                </p>
              </div>
              <ChatInterface />
            </div>
          )}
        </div>
      </div>

      {/* Workflow Section - Bold & Clear */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-8">
        <h3 className="text-xl font-bold text-gray-900 mb-8">The Workflow</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            { num: '1', title: 'Upload', desc: 'Drop your documents. PDFs, spreadsheets, images all supported.' },
            { num: '2', title: 'Analyze', desc: 'AI extracts metrics, identifies red flags, scores the deal.' },
            { num: '3', title: 'Decide', desc: 'Review analysis, ask questions, make data-driven decisions.' },
          ].map((step, idx) => (
            <div key={idx} className="flex flex-col items-start">
              <div className="w-10 h-10 bg-gray-900 text-white rounded-full flex items-center justify-center font-bold text-sm mb-4">
                {step.num}
              </div>
              <h4 className="text-lg font-semibold text-gray-900 mb-1">{step.title}</h4>
              <p className="text-sm text-gray-600">{step.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* CTA Section - Minimal, Effective */}
      <div className="bg-gray-900 text-white rounded-lg p-8 md:p-10">
        <div className="max-w-2xl">
          <h3 className="text-2xl font-bold mb-3">Ready to analyze your first deal?</h3>
          <p className="text-gray-300 mb-6">
            Upload an offering memorandum and get instant insights. No credit card required.
          </p>
          <button 
            onClick={() => setActiveTab('upload')}
            className="inline-flex items-center space-x-2 bg-white text-gray-900 px-6 py-3 rounded-lg font-medium hover:bg-gray-100 transition-colors duration-200"
          >
            <span>Start Analyzing</span>
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
