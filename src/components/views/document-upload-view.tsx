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
    <div className="space-y-6">
      {/* Impact Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { icon: Zap, label: "Time Saved", value: "10 min", sub: "vs 48 min manual" },
          { icon: Brain, label: "Accuracy", value: "95%", sub: "metric extraction" },
          { icon: TrendingUp, label: "Insight Depth", value: "Multi", sub: "document analysis" },
        ].map(({ icon: Icon, label, value, sub }) => (
          <div key={label} className="bg-card border rounded-xl p-5 shadow-card hover:shadow-lifted transition-all duration-200">
            <div className="flex items-center space-x-2 text-muted-foreground text-xs font-medium mb-3">
              <Icon className="h-3.5 w-3.5" />
              <span>{label}</span>
            </div>
            <p className="text-2xl font-bold text-foreground tracking-tight tabular-nums">{value}</p>
            <p className="text-2xs text-muted-foreground mt-0.5">{sub}</p>
          </div>
        ))}
      </div>

      {/* Main Content - Tab Interface */}
      <div className="bg-card border rounded-xl overflow-hidden shadow-card">
        {/* Tab Navigation */}
        <div className="flex border-b">
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
                  "flex-1 flex items-center justify-center space-x-2 px-6 py-3.5 text-xs font-medium transition-all duration-150 border-b-2",
                  isActive
                    ? "text-foreground border-primary bg-card"
                    : isDisabled
                      ? "text-muted-foreground/30 cursor-not-allowed border-transparent"
                      : "text-muted-foreground border-transparent hover:text-foreground hover:bg-accent/30"
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{tab.label}</span>
              </button>
            )
          })}
        </div>

        {/* Tab Content */}
        <div className="p-6 sm:p-8">
          {activeTab === 'upload' && (
            <div className="space-y-8">
              <div>
                <h2 className="text-xl font-bold text-foreground tracking-tight mb-1.5">Analyze Your Deals</h2>
                <p className="text-sm text-muted-foreground max-w-2xl">
                  Upload offering memorandums, rent rolls, financials, or property photos. We extract metrics, identify risks, and generate actionable insights in seconds.
                </p>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div>
                  <h3 className="text-sm font-semibold text-foreground mb-4">Upload Document</h3>
                  <UploadZone />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground mb-4">Recent Uploads</h3>
                  <DocumentList />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'viewer' && hasDocument && (
            <div className="space-y-4">
              <h2 className="text-xl font-bold text-foreground tracking-tight">Document Viewer</h2>
              <div className="h-[700px] bg-muted/30 rounded-xl overflow-hidden border">
                <DocumentViewer />
              </div>
            </div>
          )}

          {activeTab === 'analysis' && hasDocument && (
            <div className="space-y-4">
              <h2 className="text-xl font-bold text-foreground tracking-tight">Deal Analysis</h2>
              <AnalysisDashboard />
            </div>
          )}

          {activeTab === 'chat' && hasDocument && (
            <div className="space-y-4">
              <div>
                <h2 className="text-xl font-bold text-foreground tracking-tight mb-1.5">Ask Questions</h2>
                <p className="text-sm text-muted-foreground">
                  Chat with AI about your deal. Get instant answers with source citations.
                </p>
              </div>
              <ChatInterface />
            </div>
          )}
        </div>
      </div>

      {/* Workflow Section */}
      <div className="bg-muted/30 border rounded-xl p-6 sm:p-8">
        <h3 className="text-lg font-bold text-foreground tracking-tight mb-6">The Workflow</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            { num: '1', title: 'Upload', desc: 'Drop your documents. PDFs, spreadsheets, images all supported.' },
            { num: '2', title: 'Analyze', desc: 'AI extracts metrics, identifies red flags, scores the deal.' },
            { num: '3', title: 'Decide', desc: 'Review analysis, ask questions, make data-driven decisions.' },
          ].map((step, idx) => (
            <div key={idx} className="flex flex-col items-start">
              <div className="w-9 h-9 gradient-header text-white rounded-xl flex items-center justify-center font-bold text-xs mb-3">
                {step.num}
              </div>
              <h4 className="text-sm font-semibold text-foreground mb-1">{step.title}</h4>
              <p className="text-xs text-muted-foreground leading-relaxed">{step.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* CTA Section */}
      <div className="gradient-header text-white rounded-xl p-6 sm:p-8">
        <div className="max-w-2xl">
          <h3 className="text-xl font-bold tracking-tight mb-2">Ready to analyze your first deal?</h3>
          <p className="text-white/60 text-sm mb-5">
            Upload an offering memorandum and get instant insights. No credit card required.
          </p>
          <button
            onClick={() => setActiveTab('upload')}
            className="inline-flex items-center space-x-2 bg-white text-foreground px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-white/90 transition-colors shadow-sm"
          >
            <span>Start Analyzing</span>
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}
