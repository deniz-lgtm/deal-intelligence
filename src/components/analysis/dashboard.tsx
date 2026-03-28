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

function MetricCard({ title, value, subtitle, trend, trendValue, icon }: MetricCardProps) {
  return (
    <div className="bg-card p-4 rounded-xl border shadow-card hover:shadow-lifted transition-all duration-200">
      <div className="flex items-start justify-between">
        <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center">
          {icon}
        </div>
        {trend && (
          <div className={cn(
            "flex items-center space-x-1 text-2xs font-medium px-2 py-0.5 rounded-full",
            trend === 'up' ? "text-emerald-700 bg-emerald-50" :
            trend === 'down' ? "text-red-700 bg-red-50" :
            "text-muted-foreground bg-muted"
          )}>
            {trend === 'up' ? <ArrowUpRight className="h-3 w-3" /> :
             trend === 'down' ? <ArrowDownRight className="h-3 w-3" /> :
             <Minus className="h-3 w-3" />}
            <span>{trendValue}</span>
          </div>
        )}
      </div>
      <div className="mt-3">
        <p className="text-2xs text-muted-foreground">{title}</p>
        <p className="text-xl font-bold text-foreground mt-0.5 tabular-nums tracking-tight">{value}</p>
        {subtitle && <p className="text-2xs text-muted-foreground mt-0.5">{subtitle}</p>}
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
    critical: { label: 'Critical' },
    warning: { label: 'Warning' },
    info: { label: 'Note' },
  }

  const config = typeConfig[type]

  return (
    <div className={cn(
      "flex items-start space-x-3 p-3 rounded-xl border",
      type === 'critical' ? "bg-red-50/30 border-red-200/60" :
      type === 'warning' ? "bg-amber-50/30 border-amber-200/60" :
      "bg-blue-50/30 border-blue-200/60"
    )}>
      <div className={cn(
        "p-1.5 rounded-lg flex-shrink-0",
        type === 'critical' ? "bg-red-100" :
        type === 'warning' ? "bg-amber-100" :
        "bg-blue-100"
      )}>
        <AlertTriangle className={cn(
          "h-3.5 w-3.5",
          type === 'critical' ? "text-red-600" :
          type === 'warning' ? "text-amber-600" :
          "text-blue-600"
        )} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center space-x-2">
          <p className="text-sm font-medium text-foreground">{title}</p>
          <span className={cn(
            "text-2xs px-1.5 py-0.5 rounded-full font-medium",
            type === 'critical' ? "bg-red-100 text-red-700" :
            type === 'warning' ? "bg-amber-100 text-amber-700" :
            "bg-blue-100 text-blue-700"
          )}>
            {config.label}
          </span>
        </div>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{description}</p>
      </div>
    </div>
  )
}

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
    <div className="space-y-5">
      {/* Deal Score */}
      <div className="gradient-header rounded-xl p-6 text-white">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-white/60 text-xs font-medium uppercase tracking-wider">Overall Deal Score</p>
            <div className="flex items-baseline space-x-2 mt-2">
              <span className="text-5xl font-bold tracking-tight tabular-nums">{MOCK_ANALYSIS.score}</span>
              <span className="text-white/40 text-lg">/ 10</span>
            </div>
            <p className="text-white/70 text-sm mt-2">
              {MOCK_ANALYSIS.score >= 7 ? "Strong investment opportunity" :
               MOCK_ANALYSIS.score >= 5 ? "Moderate opportunity with caveats" :
               "Proceed with caution"}
            </p>
          </div>
          <div className="flex flex-col space-y-2">
            <Button
              variant="secondary"
              size="sm"
              className="bg-white/10 hover:bg-white/20 text-white border-0 text-xs"
              onClick={handleExportPDF}
            >
              <FileDown className="h-3.5 w-3.5 mr-1.5" />
              Export PDF
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="bg-white/10 hover:bg-white/20 text-white border-0 text-xs"
              onClick={handleSyncNotion}
            >
              <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
              Sync to Notion
            </Button>
          </div>
        </div>
      </div>

      {/* Key Metrics Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <MetricCard
          title="Purchase Price"
          value={MOCK_ANALYSIS.financial.purchasePrice}
          subtitle={`$260K per unit`}
          icon={<DollarSign className="h-4 w-4 text-muted-foreground" />}
          color="blue"
        />
        <MetricCard
          title="NOI"
          value={MOCK_ANALYSIS.financial.noi}
          subtitle="Stabilized"
          trend="up"
          trendValue="+4.2%"
          icon={<TrendingUp className="h-4 w-4 text-muted-foreground" />}
          color="green"
        />
        <MetricCard
          title="Cap Rate"
          value={MOCK_ANALYSIS.financial.capRate}
          subtitle="vs 6.2% market"
          trend="up"
          trendValue="+80 bps"
          icon={<Percent className="h-4 w-4 text-muted-foreground" />}
          color="green"
        />
        <MetricCard
          title="Cash on Cash"
          value={MOCK_ANALYSIS.financial.cashOnCash}
          subtitle="Year 1"
          icon={<TrendingUp className="h-4 w-4 text-muted-foreground" />}
          color="green"
        />
        <MetricCard
          title="GRM"
          value={MOCK_ANALYSIS.financial.grm}
          subtitle="vs 9.1x market"
          trend="down"
          trendValue="-6.6%"
          icon={<Building2 className="h-4 w-4 text-muted-foreground" />}
          color="green"
        />
        <MetricCard
          title="Projected IRR"
          value={MOCK_ANALYSIS.financial.irr}
          subtitle="5-year hold"
          trend="up"
          trendValue="Target: 15%"
          icon={<TrendingUp className="h-4 w-4 text-muted-foreground" />}
          color="green"
        />
      </div>

      {/* Property Details */}
      <div className="bg-muted/30 rounded-xl p-5 border">
        <div className="flex items-center justify-between mb-4">
          <h4 className="font-semibold text-sm flex items-center">
            <Building2 className="h-4 w-4 mr-2 text-muted-foreground" />
            Property Details
          </h4>
          <span className="text-2xs px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full font-medium">
            Class {MOCK_ANALYSIS.property.propertyClass}
          </span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <p className="text-2xs text-muted-foreground">Units</p>
            <p className="font-medium tabular-nums">{MOCK_ANALYSIS.property.units}</p>
          </div>
          <div>
            <p className="text-2xs text-muted-foreground">Year Built</p>
            <p className="font-medium tabular-nums">{MOCK_ANALYSIS.property.yearBuilt}</p>
          </div>
          <div>
            <p className="text-2xs text-muted-foreground">Total SF</p>
            <p className="font-medium tabular-nums">{MOCK_ANALYSIS.property.squareFootage}</p>
          </div>
          <div>
            <p className="text-2xs text-muted-foreground">Avg Unit</p>
            <p className="font-medium tabular-nums">{MOCK_ANALYSIS.property.avgUnitSize} SF</p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-3">{MOCK_ANALYSIS.property.address}</p>
      </div>

      {/* Red Flags */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h4 className="font-semibold text-sm flex items-center">
            <AlertTriangle className="h-4 w-4 mr-2 text-muted-foreground" />
            Red Flags & Warnings
            <span className="ml-2 px-2 py-0.5 bg-red-50 text-red-700 rounded-full text-2xs font-medium tabular-nums">
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
            className="w-full mt-3 py-2 text-xs text-muted-foreground hover:text-foreground flex items-center justify-center space-x-1 transition-colors"
          >
            {showAllFlags ? (
              <>
                <ChevronUp className="h-3.5 w-3.5" />
                <span>Show less</span>
              </>
            ) : (
              <>
                <ChevronDown className="h-3.5 w-3.5" />
                <span>Show {MOCK_ANALYSIS.redFlags.length - 3} more</span>
              </>
            )}
          </button>
        )}
      </div>
    </div>
  )
}
