"use client"

import { useState } from "react"
import { 
  TrendingUp, 
  AlertTriangle, 
  Building2, 
  DollarSign, 
  Percent,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  ChevronDown,
  ChevronUp,
  FileDown,
  ExternalLink
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"

interface MetricCardProps {
  title: string
  value: string
  subtitle?: string
  trend?: 'up' | 'down' | 'neutral'
  trendValue?: string
  icon: React.ReactNode
  color: 'blue' | 'green' | 'red' | 'amber' | 'purple'
}

function MetricCard({ title, value, subtitle, trend, trendValue, icon, color }: MetricCardProps) {
  const colorClasses = {
    blue: "bg-blue-50 text-blue-600 border-blue-200",
    green: "bg-green-50 text-green-600 border-green-200",
    red: "bg-red-50 text-red-600 border-red-200",
    amber: "bg-amber-50 text-amber-600 border-amber-200",
    purple: "bg-purple-50 text-purple-600 border-purple-200",
  }

  return (
    <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <div className="p-2.5 bg-gray-100 rounded-lg">
          {icon}
        </div>
        {trend && (
          <div className={cn(
            "flex items-center space-x-1 text-xs font-medium px-2 py-1 rounded-full",
            trend === 'up' ? "text-green-600 bg-green-50" :
            trend === 'down' ? "text-red-600 bg-red-50" :
            "text-gray-600 bg-gray-50"
          )}>
            {trend === 'up' ? <ArrowUpRight className="h-3 w-3" /> :
             trend === 'down' ? <ArrowDownRight className="h-3 w-3" /> :
             <Minus className="h-3 w-3" />}
            <span>{trendValue}</span>
          </div>
        )}
      </div>
      <div className="mt-4">
        <p className="text-sm text-gray-600">{title}</p>
        <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
        {subtitle && <p className="text-xs text-gray-500 mt-1">{subtitle}</p>}
      </div>
    </div>
  )
}

interface RedFlagProps {
  type: 'critical' | 'warning' | 'info'
  title: string
  description: string
}

function RedFlagItem({ type, title, description }: RedFlagProps) {
  const typeConfig = {
    critical: { color: 'red', label: 'Critical', icon: AlertTriangle },
    warning: { color: 'amber', label: 'Warning', icon: AlertTriangle },
    info: { color: 'blue', label: 'Note', icon: AlertTriangle },
  }

  const config = typeConfig[type]

  return (
    <div className={cn(
      "flex items-start space-x-3 p-3 rounded-lg border",
      type === 'critical' ? "bg-red-50/50 border-red-200" :
      type === 'warning' ? "bg-amber-50/50 border-amber-200" :
      "bg-blue-50/50 border-blue-200"
    )}>
      <div className={cn(
        "p-1.5 rounded-md flex-shrink-0",
        type === 'critical' ? "bg-red-100" :
        type === 'warning' ? "bg-amber-100" :
        "bg-blue-100"
      )}>
        <AlertTriangle className={cn(
          "h-4 w-4",
          type === 'critical' ? "text-red-600" :
          type === 'warning' ? "text-amber-600" :
          "text-blue-600"
        )} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center space-x-2">
          <p className="text-sm font-medium text-gray-900">{title}</p>
          <span className={cn(
            "text-xs px-1.5 py-0.5 rounded-full font-medium",
            type === 'critical' ? "bg-red-100 text-red-700" :
            type === 'warning' ? "bg-amber-100 text-amber-700" :
            "bg-blue-100 text-blue-700"
          )}>
            {config.label}
          </span>
        </div>
        <p className="text-xs text-gray-600 mt-1">{description}</p>
      </div>
    </div>
  )
}

// Mock analysis data
const MOCK_ANALYSIS = {
  score: 7.2,
  financial: {
    purchasePrice: "$12.5M",
    noi: "$875K",
    capRate: "7.0%",
    grm: "8.5x",
    cashOnCash: "12.5%",
    irr: "18.2%"
  },
  property: {
    address: "1234 Sunset Blvd, Los Angeles, CA 90026",
    units: 48,
    yearBuilt: 1985,
    propertyClass: "B",
    squareFootage: "38,400",
    avgUnitSize: "800"
  },
  redFlags: [
    { type: 'warning' as const, title: 'Above-Market Rent Assumptions', description: 'Projected 5% annual rent growth exceeds submarket average of 3.2%' },
    { type: 'critical' as const, title: 'Deferred Maintenance', description: 'Capex reserve appears insufficient based on property age and condition notes' },
    { type: 'warning' as const, title: 'Recent Eviction Activity', description: 'Rent roll shows 8 tenants with late payments in past 6 months' },
    { type: 'info' as const, title: 'Below Market Vacancy', description: 'Current 3% vacancy vs 6.5% market average - verify sustainability' },
  ]
}

export function AnalysisDashboard() {
  const [showAllFlags, setShowAllFlags] = useState(false)
  const { toast } = useToast()

  const displayedFlags = showAllFlags ? MOCK_ANALYSIS.redFlags : MOCK_ANALYSIS.redFlags.slice(0, 3)

  const handleExportPDF = () => {
    toast({
      title: "Generating PDF report",
      description: "Your analysis report will be ready shortly."
    })
  }

  const handleSyncNotion = () => {
    toast({
      title: "Syncing to Notion",
      description: "Analysis data exported to Notion database."
    })
  }

  return (
    <div className="space-y-6">
      {/* Deal Score */}
      <div className="bg-gradient-to-r from-slate-900 to-slate-800 rounded-xl p-6 text-white">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-slate-300 text-sm">Overall Deal Score</p>
            <div className="flex items-baseline space-x-3 mt-1">
              <span className="text-5xl font-bold">{MOCK_ANALYSIS.score}</span>
              <span className="text-slate-400">/ 10</span>
            </div>
            <p className="text-slate-300 text-sm mt-2">
              {MOCK_ANALYSIS.score >= 7 ? "Strong investment opportunity" :
               MOCK_ANALYSIS.score >= 5 ? "Moderate opportunity with caveats" :
               "Proceed with caution"}
            </p>
          </div>
          <div className="flex flex-col space-y-2">
            <Button 
              variant="secondary" 
              size="sm" 
              className="bg-white/10 hover:bg-white/20 text-white border-0"
              onClick={handleExportPDF}
            >
              <FileDown className="h-4 w-4 mr-2" />
              Export PDF
            </Button>
            <Button 
              variant="secondary" 
              size="sm" 
              className="bg-white/10 hover:bg-white/20 text-white border-0"
              onClick={handleSyncNotion}
            >
              <ExternalLink className="h-4 w-4 mr-2" />
              Sync to Notion
            </Button>
          </div>
        </div>
      </div>

      {/* Key Metrics Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <MetricCard
          title="Purchase Price"
          value={MOCK_ANALYSIS.financial.purchasePrice}
          subtitle={`$260K per unit`}
          icon={<DollarSign className="h-5 w-5 text-gray-600" />}
          color="blue"
        />
        <MetricCard
          title="NOI"
          value={MOCK_ANALYSIS.financial.noi}
          subtitle="Stabilized"
          trend="up"
          trendValue="+4.2%"
          icon={<TrendingUp className="h-5 w-5 text-gray-600" />}
          color="green"
        />
        <MetricCard
          title="Cap Rate"
          value={MOCK_ANALYSIS.financial.capRate}
          subtitle="vs 6.2% market"
          trend="up"
          trendValue="+80 bps"
          icon={<Percent className="h-5 w-5 text-gray-600" />}
          color="green"
        />
        <MetricCard
          title="Cash on Cash"
          value={MOCK_ANALYSIS.financial.cashOnCash}
          subtitle="Year 1"
          icon={<TrendingUp className="h-5 w-5 text-gray-600" />}
          color="green"
        />
        <MetricCard
          title="GRM"
          value={MOCK_ANALYSIS.financial.grm}
          subtitle="vs 9.1x market"
          trend="down"
          trendValue="-6.6%"
          icon={<Building2 className="h-5 w-5 text-gray-600" />}
          color="green"
        />
        <MetricCard
          title="Projected IRR"
          value={MOCK_ANALYSIS.financial.irr}
          subtitle="5-year hold"
          trend="up"
          trendValue="Target: 15%"
          icon={<TrendingUp className="h-5 w-5 text-gray-600" />}
          color="green"
        />
      </div>

      {/* Property Details */}
      <div className="bg-gray-50 rounded-xl p-5 border border-gray-200">
        <div className="flex items-center justify-between mb-4">
          <h4 className="font-semibold text-gray-900 flex items-center">
            <Building2 className="h-4 w-4 mr-2" />
            Property Details
          </h4>
          <span className="text-sm px-2 py-1 bg-blue-100 text-blue-700 rounded-full font-medium">
            Class {MOCK_ANALYSIS.property.propertyClass}
          </span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <p className="text-gray-500">Units</p>
            <p className="font-medium text-gray-900">{MOCK_ANALYSIS.property.units}</p>
          </div>
          <div>
            <p className="text-gray-500">Year Built</p>
            <p className="font-medium text-gray-900">{MOCK_ANALYSIS.property.yearBuilt}</p>
          </div>
          <div>
            <p className="text-gray-500">Total SF</p>
            <p className="font-medium text-gray-900">{MOCK_ANALYSIS.property.squareFootage}</p>
          </div>
          <div>
            <p className="text-gray-500">Avg Unit</p>
            <p className="font-medium text-gray-900">{MOCK_ANALYSIS.property.avgUnitSize} SF</p>
          </div>
        </div>
        <p className="text-sm text-gray-600 mt-3">{MOCK_ANALYSIS.property.address}</p>
      </div>

      {/* Red Flags */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h4 className="font-semibold text-gray-900 flex items-center">
            <AlertTriangle className="h-4 w-4 mr-2" />
            Red Flags & Warnings
            <span className="ml-2 px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-xs font-medium">
              {MOCK_ANALYSIS.redFlags.length}
            </span>
          </h4>
        </div>
        <div className="space-y-2">
          {displayedFlags.map((flag, idx) => (
            <RedFlagItem key={idx} {...flag} />
          ))}
        </div>
        {MOCK_ANALYSIS.redFlags.length > 3 && (
          <button
            onClick={() => setShowAllFlags(!showAllFlags)}
            className="w-full mt-3 py-2 text-sm text-gray-600 hover:text-gray-900 flex items-center justify-center space-x-1 transition-colors"
          >
            {showAllFlags ? (
              <>
                <ChevronUp className="h-4 w-4" />
                <span>Show less</span>
              </>
            ) : (
              <>
                <ChevronDown className="h-4 w-4" />
                <span>Show {MOCK_ANALYSIS.redFlags.length - 3} more</span>
              </>
            )}
          </button>
        )}
      </div>
    </div>
  )
}
