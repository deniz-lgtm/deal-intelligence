import { DocumentUploadView } from "@/components/views/document-upload-view";
import { FileText, Zap } from "lucide-react";

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white">
      {/* Header */}
      <header className="border-b bg-white/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <FileText className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">OM Intelligence</h1>
                <p className="text-sm text-gray-600">AI-powered document analysis for real estate due diligence</p>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <div className="hidden md:flex items-center space-x-2 text-sm text-gray-600">
                <Zap className="h-4 w-4" />
                <span>Powered by Claude 3.5 & GPT-4</span>
              </div>
              <button className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors">
                Get Started
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        <DocumentUploadView />
      </main>

      {/* Footer */}
      <footer className="border-t bg-white mt-16">
        <div className="container mx-auto px-4 py-8">
          <div className="flex flex-col md:flex-row justify-between items-center">
            <div className="mb-4 md:mb-0">
              <div className="flex items-center space-x-2">
                <FileText className="h-6 w-6 text-primary" />
                <span className="text-lg font-semibold">OM Intelligence</span>
              </div>
              <p className="text-sm text-gray-600 mt-2">© 2026 Moxie Management. All rights reserved.</p>
            </div>
            <div className="text-sm text-gray-600">
              <p>Built for real estate professionals by real estate professionals</p>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
