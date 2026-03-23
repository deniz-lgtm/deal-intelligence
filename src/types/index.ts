export interface Document {
  id: string
  filename: string
  filetype: string
  size: number
  uploadDate: Date
  status: 'processing' | 'processed' | 'error'
  extractedText?: string
  metadata?: Record<string, any>
}

export interface PropertyMetrics {
  address: string
  city: string
  state: string
  zipCode: string
  units: number
  yearBuilt: number
  propertyClass: 'A' | 'B' | 'C' | 'D'
  squareFootage: number
  lotSize?: number
  propertyType: string
}

export interface FinancialMetrics {
  purchasePrice: number
  noi: number
  capRate: number
  grm: number
  dscr?: number
  cashOnCash?: number
  irr?: number
  equityMultiple?: number
  grossRent: number
  operatingExpenses: number
  vacancyRate: number
}

export interface MarketMetrics {
  submarket: string
  avgRentPerUnit: number
  marketCapRate: number
  marketVacancy: number
  rentGrowth: number
}

export interface RedFlag {
  id: string
  type: 'critical' | 'warning' | 'info'
  title: string
  description: string
  field?: string
  confidence: number
}

export interface Analysis {
  id: string
  documentId: string
  property: PropertyMetrics
  financial: FinancialMetrics
  market: MarketMetrics
  assumptions: Assumption[]
  redFlags: RedFlag[]
  score: number
  summary: string
  recommendations: string[]
  generatedAt: Date
}

export interface Assumption {
  id: string
  category: 'rent' | 'expenses' | 'vacancy' | 'growth' | 'capex' | 'other'
  name: string
  value: string
  isOptimistic?: boolean
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  sources?: {
    page?: number
    text: string
  }[]
}

export interface ExportOptions {
  format: 'pdf' | 'notion' | 'email'
  includeAnalysis: boolean
  includeChat: boolean
  includeRawText: boolean
}
