import { DocumentUploadView } from "@/components/views/document-upload-view";

export default function Home() {
  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-gray-200">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <div className="w-8 h-8 bg-gradient-to-br from-slate-900 to-slate-700 rounded-md flex items-center justify-center">
                <span className="text-white font-bold text-sm">DI</span>
              </div>
              <h1 className="text-lg font-semibold tracking-tight text-gray-900">Deal Intelligence</h1>
            </div>
            <div className="hidden md:flex items-center space-x-6 text-sm">
              <span className="text-gray-600">Powered by Claude & GPT-4</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-6 py-12">
        <DocumentUploadView />
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 mt-20">
        <div className="container mx-auto px-6 py-8">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-8">
            <div>
              <h3 className="font-semibold text-gray-900">Deal Intelligence</h3>
              <p className="text-sm text-gray-600 mt-2">AI-powered due diligence for real estate professionals</p>
            </div>
            <div className="text-sm text-gray-600">
              <p>© 2026. Made for real estate, by real estate professionals.</p>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
