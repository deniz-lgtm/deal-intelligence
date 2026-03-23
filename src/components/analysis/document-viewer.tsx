"use client"

import { useState } from "react"
import { 
  ChevronLeft, 
  ChevronRight, 
  ZoomIn, 
  ZoomOut, 
  Download,
  Maximize2,
  FileText,
  Highlighter,
  MessageSquare
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

interface DocumentViewerProps {
  documentUrl?: string
  documentName?: string
}

export function DocumentViewer({ 
  documentUrl = "/sample-om.pdf",
  documentName = "Sunset_Gardens_OM_2024.pdf"
}: DocumentViewerProps) {
  const [currentPage, setCurrentPage] = useState(1)
  const [zoom, setZoom] = useState(100)
  const [showExtracted, setShowExtracted] = useState(true)
  const [activeTab, setActiveTab] = useState<'preview' | 'extracted' | 'annotations'>('preview')

  const totalPages = 25 // Mock total pages

  const handleZoomIn = () => setZoom(prev => Math.min(prev + 25, 200))
  const handleZoomOut = () => setZoom(prev => Math.max(prev - 25, 50))

  const handlePrevious = () => setCurrentPage(prev => Math.max(prev - 1, 1))
  const handleNext = () => setCurrentPage(prev => Math.min(prev + 1, totalPages))

  return (
    <div className="flex flex-col h-full bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
        <div className="flex items-center space-x-4">
          <FileText className="h-5 w-5 text-gray-500" />
          <span className="text-sm font-medium text-gray-700 truncate max-w-xs">
            {documentName}
          </span>
        </div>
        
        <div className="flex items-center space-x-2">
          {/* Page Navigation */}
          <div className="flex items-center space-x-2 bg-white rounded-lg border border-gray-200 px-3 py-1.5">
            <button
              onClick={handlePrevious}
              disabled={currentPage === 1}
              className="p-1 hover:bg-gray-100 rounded disabled:opacity-30"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm text-gray-600 min-w-[60px] text-center">
              {currentPage} / {totalPages}
            </span>
            <button
              onClick={handleNext}
              disabled={currentPage === totalPages}
              className="p-1 hover:bg-gray-100 rounded disabled:opacity-30"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {/* Zoom Controls */}
          <div className="flex items-center space-x-1 bg-white rounded-lg border border-gray-200 px-2 py-1.5">
            <button
              onClick={handleZoomOut}
              disabled={zoom <= 50}
              className="p-1 hover:bg-gray-100 rounded disabled:opacity-30"
            >
              <ZoomOut className="h-4 w-4" />
            </button>
            <span className="text-sm text-gray-600 min-w-[50px] text-center">
              {zoom}%
            </span>
            <button
              onClick={handleZoomIn}
              disabled={zoom >= 200}
              className="p-1 hover:bg-gray-100 rounded disabled:opacity-30"
            >
              <ZoomIn className="h-4 w-4" />
            </button>
          </div>

          <Button variant="outline" size="sm">
            <Download className="h-4 w-4 mr-2" />
            Download
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* PDF Preview Area */}
        <div className="flex-1 bg-gray-100 overflow-auto p-8">
          <div 
            className="mx-auto bg-white shadow-lg transition-transform duration-200"
            style={{ 
              width: `${8.5 * zoom}px`, 
              height: `${11 * zoom}px`,
              maxWidth: '100%'
            }}
          >
            {/* Mock PDF Page */}
            <div className="w-full h-full p-8 flex flex-col items-center justify-center text-gray-400 border-2 border-dashed border-gray-300">
              <FileText className="h-16 w-16 mb-4 opacity-30" />
              <p className="text-lg font-medium">Page {currentPage}</p>
              <p className="text-sm">PDF Preview</p>
              <p className="text-xs mt-4 text-gray-300">
                (In production, this would render the actual PDF)
              </p>
            </div>
          </div>
        </div>

        {/* Side Panel */}
        <div className={cn(
          "border-l border-gray-200 bg-gray-50 transition-all duration-300",
          showExtracted ? "w-80" : "w-0 overflow-hidden"
        )}>
          {/* Tabs */}
          <div className="flex border-b border-gray-200">
            <button
              onClick={() => setActiveTab('extracted')}
              className={cn(
                "flex-1 py-3 text-sm font-medium transition-colors flex items-center justify-center space-x-2",
                activeTab === 'extracted' 
                  ? "text-primary border-b-2 border-primary bg-white" 
                  : "text-gray-600 hover:text-gray-900"
              )}
            >
              <FileText className="h-4 w-4" />
              <span>Extracted</span>
            </button>
            <button
              onClick={() => setActiveTab('annotations')}
              className={cn(
                "flex-1 py-3 text-sm font-medium transition-colors flex items-center justify-center space-x-2",
                activeTab === 'annotations' 
                  ? "text-primary border-b-2 border-primary bg-white" 
                  : "text-gray-600 hover:text-gray-900"
              )}
            >
              <Highlighter className="h-4 w-4" />
              <span>Notes</span>
            </button>
          </div>

          {/* Tab Content */}
          <div className="p-4 overflow-y-auto h-[calc(100%-49px)]">
            {activeTab === 'extracted' ? (
              <div className="space-y-4">
                <div>
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                    Key Metrics (Page 5)
                  </h4>
                  <div className="bg-white rounded-lg border border-gray-200 p-3 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Purchase Price</span>
                      <span className="font-medium">$12,500,000</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Cap Rate</span>
                      <span className="font-medium">7.0%</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">NOI</span>
                      <span className="font-medium">$875,000</span>
                    </div>
                  </div>
                </div>

                <div>
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                    Property Details (Page 3)
                  </h4>
                  <div className="bg-white rounded-lg border border-gray-200 p-3 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Address</span>
                      <span className="font-medium text-right">1234 Sunset Blvd</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">City/State</span>
                      <span className="font-medium">Los Angeles, CA</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Units</span>
                      <span className="font-medium">48</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Year Built</span>
                      <span className="font-medium">1985</span>
                    </div>
                  </div>
                </div>

                <div>
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
            Financial Projections (Page 12)
                  </h4>
                  <div className="bg-white rounded-lg border border-gray-200 p-3">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-xs text-gray-500">
                          <th className="text-left pb-2">Year</th>
                          <th className="text-right pb-2">NOI</th>
                          <th className="text-right pb-2">Growth</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        <tr>
                          <td className="py-1.5">Year 1</td>
                          <td className="text-right">$875K</td>
                          <td className="text-right text-gray-400">-</td>
                        </tr>
                        <tr>
                          <td className="py-1.5">Year 2</td>
                          <td className="text-right">$910K</td>
                          <td className="text-right text-green-600">+4%</td>
                        </tr>
                        <tr>
                          <td className="py-1.5">Year 3</td>
                          <td className="text-right">$945K</td>
                          <td className="text-right text-green-600">+3.8%</td>
                        </tr>
                        <tr>
                          <td className="py-1.5">Year 4</td>
                          <td className="text-right">$982K</td>
                          <td className="text-right text-green-600">+3.9%</td>
                        </tr>
                        <tr>
                          <td className="py-1.5">Year 5</td>
                          <td className="text-right">$1.02M</td>
                          <td className="text-right text-green-600">+3.9%</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="bg-yellow-50 rounded-lg border border-yellow-200 p-3">
                  <div className="flex items-start space-x-2">
                    <Highlighter className="h-4 w-4 text-yellow-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-gray-900">Page 12</p>
                      <p className="text-sm text-gray-600 mt-1">
                        Rent growth assumptions seem aggressive - verify with broker
                      </p>
                      <p className="text-xs text-gray-400 mt-2">2 hours ago</p>
                    </div>
                  </div>
                </div>
                <div className="bg-blue-50 rounded-lg border border-blue-200 p-3">
                  <div className="flex items-start space-x-2">
                    <MessageSquare className="h-4 w-4 text-blue-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-gray-900">Page 22</p>
                      <p className="text-sm text-gray-600 mt-1">
                        Need to follow up on HVAC replacement timeline
                      </p>
                      <p className="text-xs text-gray-400 mt-2">1 hour ago</p>
                    </div>
                  </div>
                </div>
                <button className="w-full py-2 text-sm text-gray-500 hover:text-gray-700 border border-dashed border-gray-300 rounded-lg hover:border-gray-400 transition-colors">
                  + Add note
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Toggle Side Panel */}
        <button
          onClick={() => setShowExtracted(!showExtracted)}
          className="absolute right-4 top-20 p-2 bg-white border border-gray-200 rounded-lg shadow-sm hover:shadow-md transition-all z-10"
          title={showExtracted ? "Hide side panel" : "Show side panel"}
        >
          <Maximize2 className="h-4 w-4 text-gray-500" />
        </button>
      </div>
    </div>
  )
}
