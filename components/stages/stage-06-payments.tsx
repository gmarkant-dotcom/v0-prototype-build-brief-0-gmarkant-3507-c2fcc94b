"use client"

import { useState } from "react"
import { StageHeader } from "@/components/stage-header"
import { EngagementContext } from "@/components/engagement-context"
import { GlassCard, GlassCardHeader } from "@/components/glass-card"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { isDemoMode } from "@/lib/demo-data"
import { EmptyState } from "@/components/empty-state"
import { TrendingUp, TrendingDown, ArrowRight, DollarSign, Calendar, AlertCircle } from "lucide-react"

interface Payment {
  id: string
  vendor: string
  milestone: string
  amount: number
  status: "paid" | "pending" | "upcoming"
  dueDate: string
  paidDate?: string
}

interface ClientPayment {
  id: string
  milestone: string
  amount: number
  status: "received" | "invoiced" | "scheduled"
  dueDate: string
  receivedDate?: string
}

// Demo data - only shown when NEXT_PUBLIC_IS_DEMO=true
const demoPayments: Payment[] = [
  { id: "1", vendor: "Sample Production Studio", milestone: "Kick-off", amount: 19400, status: "paid", dueDate: "Jan 15, 2026", paidDate: "Jan 14, 2026" },
  { id: "2", vendor: "Sample Production Studio", milestone: "Mid-point", amount: 38800, status: "paid", dueDate: "Mar 1, 2026", paidDate: "Feb 28, 2026" },
  { id: "3", vendor: "Sample Production Studio", milestone: "Delivery", amount: 29100, status: "pending", dueDate: "Apr 15, 2026" },
  { id: "4", vendor: "Sample Production Studio", milestone: "Final", amount: 9700, status: "upcoming", dueDate: "Jun 1, 2026" },
  { id: "5", vendor: "Tandem Social", milestone: "Kick-off", amount: 9600, status: "paid", dueDate: "Jan 15, 2026", paidDate: "Jan 15, 2026" },
  { id: "6", vendor: "Tandem Social", milestone: "Monthly #1", amount: 9600, status: "paid", dueDate: "Feb 1, 2026", paidDate: "Feb 1, 2026" },
  { id: "7", vendor: "Tandem Social", milestone: "Monthly #2", amount: 9600, status: "pending", dueDate: "Mar 1, 2026" },
  { id: "8", vendor: "Roster Agency", milestone: "Kick-off", amount: 8000, status: "paid", dueDate: "Jan 20, 2026", paidDate: "Jan 20, 2026" },
  { id: "9", vendor: "Roster Agency", milestone: "Talent Secured", amount: 16000, status: "pending", dueDate: "Mar 15, 2026" },
]

const demoClientPayments: ClientPayment[] = [
  { id: "c1", milestone: "Project Kick-off (30%)", amount: 75000, status: "received", dueDate: "Jan 10, 2026", receivedDate: "Jan 8, 2026" },
  { id: "c2", milestone: "Mid-Project (40%)", amount: 100000, status: "received", dueDate: "Mar 1, 2026", receivedDate: "Feb 27, 2026" },
  { id: "c3", milestone: "Final Delivery (30%)", amount: 75000, status: "invoiced", dueDate: "May 1, 2026" },
]

// Monthly cashflow data for the graph
const demoCashflowData = [
  { month: "Jan", clientIn: 75000, vendorOut: 37000, net: 38000 },
  { month: "Feb", clientIn: 0, vendorOut: 9600, net: -9600 },
  { month: "Mar", clientIn: 100000, vendorOut: 54700, net: 45300 },
  { month: "Apr", clientIn: 0, vendorOut: 29100, net: -29100 },
  { month: "May", clientIn: 75000, vendorOut: 0, net: 75000 },
  { month: "Jun", clientIn: 0, vendorOut: 9700, net: -9700 },
]

interface Contract {
  id: string
  vendor: string
  type: string
  amount: number
  status: "draft" | "sent" | "signed"
  signedDate?: string
}

const contracts: Contract[] = [
  { id: "msa-001", vendor: "Sample Production Studio", type: "MSA + SOW", amount: 97000, status: "signed", signedDate: "Jan 10, 2026" },
  { id: "msa-002", vendor: "Tandem Social", type: "MSA + SOW", amount: 48000, status: "signed", signedDate: "Jan 12, 2026" },
  { id: "msa-003", vendor: "Roster Agency", type: "MSA + SOW", amount: 40000, status: "signed", signedDate: "Jan 18, 2026" },
]

const getStatusStyle = (status: string) => {
  switch (status) {
    case "paid":
    case "signed":
    case "received":
      return "bg-green-500/10 text-green-400 border-green-500/30"
    case "pending":
    case "sent":
    case "invoiced":
      return "bg-yellow-500/10 text-yellow-400 border-yellow-500/30"
    case "upcoming":
    case "draft":
    case "scheduled":
      return "bg-white/10 text-foreground-muted border-border"
    default:
      return "bg-white/10 text-foreground-muted border-border"
  }
}

export function Stage06Payments() {
  const isDemo = isDemoMode()
  const payments = isDemo ? demoPayments : []
  const clientPayments = isDemo ? demoClientPayments : []
  const cashflowData = isDemo ? demoCashflowData : []
  
  const [activeTab, setActiveTab] = useState<"overview" | "contracts" | "payments">("overview")
  
  const totalPaid = payments.filter(p => p.status === "paid").reduce((sum, p) => sum + p.amount, 0)
  const totalPending = payments.filter(p => p.status === "pending").reduce((sum, p) => sum + p.amount, 0)
  const totalUpcoming = payments.filter(p => p.status === "upcoming").reduce((sum, p) => sum + p.amount, 0)
  
  const totalClientReceived = clientPayments.filter(p => p.status === "received").reduce((sum, p) => sum + p.amount, 0)
  const totalClientPending = clientPayments.filter(p => p.status !== "received").reduce((sum, p) => sum + p.amount, 0)
  
  const currentCashPosition = totalClientReceived - totalPaid
  const projectedMargin = isDemo ? 250000 - 185000 : 0 // Total client contract - total vendor contracts
  
  // Find max value for chart scaling
  const maxValue = cashflowData.length > 0 ? Math.max(...cashflowData.flatMap(d => [d.clientIn, d.vendorOut])) : 0
  
  if (!isDemo) {
    return (
      <div className="p-8 max-w-6xl">
        <StageHeader
          stageNumber="06"
          title="MSA + Payments"
          subtitle="Two-tier contract and payment architecture. LIGAMENT auto-populates MSAs from project parameters and tracks milestone payments."
          aiPowered
        />
        <EmptyState
          title="No Payment Activity"
          description="Payment milestones and vendor invoices will appear here once contracts are executed and projects are underway."
          icon="payments"
        />
      </div>
    )
  }
  
  return (
    <div className="p-8 max-w-6xl">
      <StageHeader
        stageNumber="06"
        title="MSA + Payments"
        subtitle="Two-tier contract and payment architecture. LIGAMENT auto-populates MSAs from project parameters and tracks milestone payments."
        aiPowered
      />
      
      <EngagementContext
        agency="Electric Animal"
        project="NWSL Creator Content Series"
        budget="$250K"
        className="mb-8"
      />
      
      {/* Cashflow Summary Graph - Lead Agency Executive View */}
      <GlassCard className="mb-8">
        <GlassCardHeader
          label="Cashflow Analysis"
          title="Client In vs. Partner Out"
        />
        
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Key Metrics */}
          <div className="space-y-4">
            <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/30">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="w-4 h-4 text-green-400" />
                <span className="font-mono text-[10px] text-green-400 uppercase tracking-wider">Client Received</span>
              </div>
              <div className="font-display font-bold text-2xl text-green-400">
                ${totalClientReceived.toLocaleString()}
              </div>
              <div className="font-mono text-[10px] text-foreground-muted mt-1">
                ${totalClientPending.toLocaleString()} pending
              </div>
            </div>
            
            <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/30">
              <div className="flex items-center gap-2 mb-2">
                <TrendingDown className="w-4 h-4 text-red-400" />
                <span className="font-mono text-[10px] text-red-400 uppercase tracking-wider">Paid to Partners</span>
              </div>
              <div className="font-display font-bold text-2xl text-red-400">
                ${totalPaid.toLocaleString()}
              </div>
              <div className="font-mono text-[10px] text-foreground-muted mt-1">
                ${(totalPending + totalUpcoming).toLocaleString()} remaining
              </div>
            </div>
            
            <div className="p-4 rounded-lg bg-accent/10 border border-accent/30">
              <div className="flex items-center gap-2 mb-2">
                <DollarSign className="w-4 h-4 text-accent" />
                <span className="font-mono text-[10px] text-accent uppercase tracking-wider">Current Position</span>
              </div>
              <div className="font-display font-bold text-2xl text-accent">
                ${currentCashPosition.toLocaleString()}
              </div>
              <div className="font-mono text-[10px] text-foreground-muted mt-1">
                Projected margin: ${projectedMargin.toLocaleString()} ({Math.round(projectedMargin / 250000 * 100)}%)
              </div>
            </div>
          </div>
          
          {/* Cashflow Bar Chart */}
          <div className="lg:col-span-3">
            <div className="flex items-center gap-4 mb-4">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-green-400" />
                <span className="font-mono text-[10px] text-foreground-muted">Client Payments In</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-red-400" />
                <span className="font-mono text-[10px] text-foreground-muted">Partner Payments Out</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-accent" />
                <span className="font-mono text-[10px] text-foreground-muted">Net Cashflow</span>
              </div>
            </div>
            
            {/* Chart Area */}
            <div className="relative h-64 border-l border-b border-border/50 ml-12">
              {/* Y-axis labels */}
              <div className="absolute -left-12 top-0 bottom-0 flex flex-col justify-between text-right pr-2">
                <span className="font-mono text-[10px] text-foreground-muted">${(maxValue / 1000).toFixed(0)}K</span>
                <span className="font-mono text-[10px] text-foreground-muted">${(maxValue / 2000).toFixed(0)}K</span>
                <span className="font-mono text-[10px] text-foreground-muted">$0</span>
              </div>
              
              {/* Grid lines */}
              <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
                <div className="border-t border-dashed border-border/30" />
                <div className="border-t border-dashed border-border/30" />
                <div />
              </div>
              
              {/* Bars */}
              <div className="absolute inset-0 flex items-end justify-around px-4">
                {cashflowData.map((data, i) => (
                  <div key={i} className="flex flex-col items-center gap-1 w-16">
                    <div className="flex items-end gap-1 h-52">
                      {/* Client In Bar */}
                      <div 
                        className="w-5 bg-green-400 rounded-t transition-all hover:bg-green-300"
                        style={{ height: `${(data.clientIn / maxValue) * 100}%` }}
                        title={`Client: $${data.clientIn.toLocaleString()}`}
                      />
                      {/* Vendor Out Bar */}
                      <div 
                        className="w-5 bg-red-400 rounded-t transition-all hover:bg-red-300"
                        style={{ height: `${(data.vendorOut / maxValue) * 100}%` }}
                        title={`Partner: $${data.vendorOut.toLocaleString()}`}
                      />
                    </div>
                    {/* Net indicator */}
                    <div className={cn(
                      "font-mono text-[9px] px-1.5 py-0.5 rounded",
                      data.net >= 0 ? "bg-accent/20 text-accent" : "bg-red-500/20 text-red-400"
                    )}>
                      {data.net >= 0 ? "+" : ""}{(data.net / 1000).toFixed(0)}K
                    </div>
                    {/* Month label */}
                    <span className="font-mono text-[10px] text-foreground-muted">{data.month}</span>
                  </div>
                ))}
              </div>
            </div>
            
            {/* Cashflow Alert */}
            {cashflowData.some(d => d.net < -20000) && (
              <div className="mt-4 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30 flex items-start gap-3">
                <AlertCircle className="w-4 h-4 text-yellow-400 mt-0.5 shrink-0" />
                <div>
                  <div className="font-display font-bold text-sm text-yellow-400">Cashflow Gap Detected</div>
                  <p className="text-xs text-foreground-muted mt-1">
                    April shows a -$29K gap before client final payment. Consider requesting client milestone adjustment or partner payment deferral.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </GlassCard>
      
      {/* Tabs */}
      <div className="flex gap-2 mb-6 border-b border-border/30">
        {(["overview", "contracts", "payments"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              "px-4 py-2 font-mono text-xs capitalize transition-colors border-b-2 -mb-px",
              activeTab === tab
                ? "border-accent text-accent"
                : "border-transparent text-foreground-muted hover:text-foreground"
            )}
          >
            {tab}
          </button>
        ))}
      </div>
      
      {activeTab === "overview" && (
        <>
          {/* Payment Summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <GlassCard className="text-center py-4">
              <div className="font-display font-bold text-2xl text-green-400 mb-1">
                ${totalPaid.toLocaleString()}
              </div>
              <div className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider">
                Paid to Partners
              </div>
            </GlassCard>
            <GlassCard className="text-center py-4">
              <div className="font-display font-bold text-2xl text-yellow-400 mb-1">
                ${totalPending.toLocaleString()}
              </div>
              <div className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider">
                Pending
              </div>
            </GlassCard>
            <GlassCard className="text-center py-4">
              <div className="font-display font-bold text-2xl text-foreground-muted mb-1">
                ${totalUpcoming.toLocaleString()}
              </div>
              <div className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider">
                Upcoming
              </div>
            </GlassCard>
            <GlassCard highlight className="text-center py-4">
              <div className="font-display font-bold text-2xl text-accent mb-1">
                $185,000
              </div>
              <div className="font-mono text-[10px] text-accent uppercase tracking-wider">
                Total Contracted
              </div>
            </GlassCard>
          </div>
          
          {/* Client Payments Flow */}
          <GlassCard className="mb-6">
            <GlassCardHeader
              label="Client Billing"
              title="Payments from Client"
            />
            
            <div className="space-y-3">
              {clientPayments.map((payment, i) => (
                <div key={payment.id} className="flex items-center gap-4">
                  <div className="flex-1 p-3 rounded-lg border border-border bg-white/5">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm text-foreground">{payment.milestone}</span>
                      <span className={cn(
                        "font-mono text-[9px] px-2 py-0.5 rounded-full border capitalize",
                        getStatusStyle(payment.status)
                      )}>
                        {payment.status}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-lg text-green-400">
                        ${payment.amount.toLocaleString()}
                      </span>
                      <span className="font-mono text-[10px] text-foreground-muted">
                        {payment.status === "received" ? `Received ${payment.receivedDate}` : `Due ${payment.dueDate}`}
                      </span>
                    </div>
                  </div>
                  {i < clientPayments.length - 1 && (
                    <ArrowRight className="w-4 h-4 text-foreground-muted shrink-0" />
                  )}
                </div>
              ))}
            </div>
          </GlassCard>
        </>
      )}
      
      {activeTab === "contracts" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Contracts */}
          <GlassCard>
            <GlassCardHeader
              label="Contracts"
              title="MSA Status"
            />
            
            <div className="space-y-3">
              {contracts.map((contract) => (
                <div
                  key={contract.id}
                  className="p-3 rounded-lg border border-border bg-white/5"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="font-display font-bold text-sm text-foreground">
                        {contract.vendor}
                      </div>
                      <div className="font-mono text-[10px] text-foreground-muted">
                        {contract.type}
                      </div>
                    </div>
                    <span className={cn(
                      "font-mono text-[9px] px-2 py-0.5 rounded-full border capitalize",
                      getStatusStyle(contract.status)
                    )}>
                      {contract.status}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sm text-foreground">
                      ${contract.amount.toLocaleString()}
                    </span>
                    {contract.signedDate && (
                      <span className="font-mono text-[10px] text-foreground-muted">
                        {contract.signedDate}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
            
            <Button 
              variant="outline" 
              className="w-full mt-4 font-mono text-xs border-border text-foreground-muted hover:text-foreground bg-transparent"
            >
              Generate New MSA
            </Button>
          </GlassCard>
          
          {/* Contract Summary */}
          <GlassCard>
            <GlassCardHeader
              label="Summary"
              title="Contract Breakdown"
            />
            
            <div className="space-y-4">
              <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/30">
                <div className="font-mono text-[10px] text-green-400 uppercase tracking-wider mb-1">
                  Client Contract Value
                </div>
                <div className="font-display font-bold text-2xl text-green-400">
                  $250,000
                </div>
              </div>
              
              <div className="p-4 rounded-lg bg-white/5 border border-border">
                <div className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider mb-1">
                  Total Partner Contracts
                </div>
                <div className="font-display font-bold text-2xl text-foreground">
                  $185,000
                </div>
              </div>
              
              <div className="p-4 rounded-lg bg-accent/10 border border-accent/30">
                <div className="font-mono text-[10px] text-accent uppercase tracking-wider mb-1">
                  Gross Margin
                </div>
                <div className="font-display font-bold text-2xl text-accent">
                  $65,000 <span className="text-lg font-normal">(26%)</span>
                </div>
              </div>
            </div>
          </GlassCard>
        </div>
      )}
      
      {activeTab === "payments" && (
        <GlassCard className="overflow-x-auto">
          <GlassCardHeader
            label="Milestone Payments"
            title="Partner Payment Schedule"
          />
          
          <table className="w-full min-w-[500px]">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left font-mono text-[10px] text-foreground-muted uppercase tracking-wider py-2 px-2">
                  Partner
                </th>
                <th className="text-left font-mono text-[10px] text-foreground-muted uppercase tracking-wider py-2 px-2">
                  Milestone
                </th>
                <th className="text-right font-mono text-[10px] text-foreground-muted uppercase tracking-wider py-2 px-2">
                  Amount
                </th>
                <th className="text-left font-mono text-[10px] text-foreground-muted uppercase tracking-wider py-2 px-2">
                  Due
                </th>
                <th className="text-center font-mono text-[10px] text-foreground-muted uppercase tracking-wider py-2 px-2">
                  Status
                </th>
                <th className="text-center font-mono text-[10px] text-foreground-muted uppercase tracking-wider py-2 px-2">
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
              {payments.map((payment) => (
                <tr key={payment.id} className="border-b border-border/50 last:border-0">
                  <td className="py-3 px-2">
                    <span className="text-sm text-foreground">{payment.vendor}</span>
                  </td>
                  <td className="py-3 px-2">
                    <span className="text-sm text-foreground-secondary">{payment.milestone}</span>
                  </td>
                  <td className="text-right py-3 px-2">
                    <span className="font-mono text-sm text-foreground">
                      ${payment.amount.toLocaleString()}
                    </span>
                  </td>
                  <td className="py-3 px-2">
                    <span className="font-mono text-xs text-foreground-muted">
                      {payment.dueDate}
                    </span>
                  </td>
                  <td className="text-center py-3 px-2">
                    <span className={cn(
                      "font-mono text-[9px] px-2 py-0.5 rounded-full border capitalize",
                      getStatusStyle(payment.status)
                    )}>
                      {payment.status}
                    </span>
                  </td>
                  <td className="text-center py-3 px-2">
                    {payment.status === "pending" && (
                      <Button size="sm" className="font-mono text-[10px] h-6 px-2 bg-accent hover:bg-accent/90 text-background">
                        Pay Now
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </GlassCard>
      )}
      
      {/* Two-Tier Notice */}
      <div className="mt-6 p-4 rounded-lg border border-accent/30 bg-accent/5">
        <div className="flex items-start gap-3">
          <span className="text-accent text-lg">✦</span>
          <div>
            <div className="font-display font-bold text-foreground mb-1">
              Two-Tier Payment Architecture
            </div>
            <p className="text-sm text-foreground-muted">
              Client pays agency on client terms. Agency pays vendors on vendor terms. 
              LIGAMENT manages the timing gap, protecting your cash flow and margin.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
