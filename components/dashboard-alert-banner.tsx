"use client"

import { Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { AlertTriangle, X, ArrowRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { useState, useEffect } from "react"
import Link from "next/link"

type AlertType = "utilization" | "payment" | "deadline" | "scope" | "partner"

// Alert data that matches what we have in the dashboard
const alertDatabase: Record<string, {
  type: AlertType
  severity: "warning" | "critical"
  title: string
  description: string
  section: string
  projectName: string
  actionItems?: string[]
}> = {
  "a1": {
    type: "utilization",
    severity: "warning",
    title: "Tandem Social approaching budget cap",
    description: "Social media management partner has used 85% of allocated budget with 35% of work remaining. Potential overage of $12,000 flagged.",
    section: "Utilization",
    projectName: "NWSL Creator Content Series",
    actionItems: [
      "Review current utilization breakdown below",
      "Discuss scope adjustment with partner",
      "Approve or reject scope change request"
    ]
  },
  "a2": {
    type: "scope",
    severity: "critical",
    title: "Scope change request pending approval",
    description: "Roster Agency has submitted a scope change request for 2 additional athletes. Review and approve or reject to unblock production.",
    section: "Utilization",
    projectName: "Summer Festival Activation",
    actionItems: [
      "Review scope change request details",
      "Assess budget impact",
      "Approve or reject request"
    ]
  },
  "a3": {
    type: "payment",
    severity: "warning",
    title: "Invoice payment overdue",
    description: "Payment to your production partner for milestone 2 is 5 days overdue. Total amount: $38,800.",
    section: "MSA + Payments",
    projectName: "Summer Festival Activation",
    actionItems: [
      "Review payment schedule below",
      "Process outstanding payment",
      "Update partner on payment status"
    ]
  },
  "a4": {
    type: "partner",
    severity: "warning",
    title: "Partner availability concern",
    description: "Primary video production partner has flagged limited availability due to conflicting project. May need to reassign or delay.",
    section: "Project Hub",
    projectName: "Product Launch - Series X",
    actionItems: [
      "Contact partner to discuss timeline",
      "Review alternative partner options",
      "Update project schedule if needed"
    ]
  }
}

function DashboardAlertBannerContent() {
  const searchParams = useSearchParams()
  const alertId = searchParams.get("alert")
  const [dismissed, setDismissed] = useState(false)
  
  // Reset dismissed state when alert changes
  useEffect(() => {
    setDismissed(false)
  }, [alertId])
  
  if (!alertId || dismissed) return null
  
  const alert = alertDatabase[alertId]
  if (!alert) return null
  
  return (
    <div className={cn(
      "mb-6 rounded-xl border overflow-hidden",
      alert.severity === "critical" 
        ? "bg-red-500/10 border-red-500/30" 
        : "bg-yellow-500/10 border-yellow-500/30"
    )}>
      {/* Header */}
      <div className={cn(
        "px-5 py-3 flex items-center justify-between",
        alert.severity === "critical" 
          ? "bg-red-500/20" 
          : "bg-yellow-500/20"
      )}>
        <div className="flex items-center gap-3">
          <div className={cn(
            "w-8 h-8 rounded-full flex items-center justify-center",
            alert.severity === "critical" 
              ? "bg-red-500/30" 
              : "bg-yellow-500/30"
          )}>
            <AlertTriangle className={cn(
              "w-4 h-4",
              alert.severity === "critical" ? "text-red-400" : "text-yellow-400"
            )} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className={cn(
                "font-mono text-[9px] px-2 py-0.5 rounded-full uppercase tracking-wider",
                alert.severity === "critical" 
                  ? "bg-red-500/30 text-red-300" 
                  : "bg-yellow-500/30 text-yellow-300"
              )}>
                {alert.severity}
              </span>
              <span className="font-mono text-[10px] text-foreground-muted">
                {alert.projectName}
              </span>
            </div>
            <h3 className="font-display font-bold text-lg text-foreground mt-0.5">
              {alert.title}
            </h3>
          </div>
        </div>
        <button 
          onClick={() => setDismissed(true)}
          className="p-2 hover:bg-white/10 rounded-lg transition-colors"
        >
          <X className="w-4 h-4 text-foreground-muted" />
        </button>
      </div>
      
      {/* Content */}
      <div className="px-5 py-4">
        <p className="text-sm text-foreground-secondary leading-relaxed mb-4">
          {alert.description}
        </p>
        
        {alert.actionItems && alert.actionItems.length > 0 && (
          <div className="bg-white/5 rounded-lg p-4">
            <div className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider mb-2">
              Recommended Actions
            </div>
            <ul className="space-y-2">
              {alert.actionItems.map((item, index) => (
                <li key={index} className="flex items-center gap-2 text-sm text-foreground-secondary">
                  <ArrowRight className="w-3 h-3 text-accent shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      
      {/* Footer */}
      <div className="px-5 py-3 bg-white/5 border-t border-white/10 flex items-center justify-between">
        <span className="font-mono text-[10px] text-foreground-muted">
          This alert relates to the {alert.section} section below
        </span>
        <Link 
          href="/agency/dashboard"
          className="font-mono text-[10px] text-accent hover:underline flex items-center gap-1"
        >
          Back to Dashboard
          <ArrowRight className="w-3 h-3" />
        </Link>
      </div>
    </div>
  )
}

export function DashboardAlertBanner() {
  return (
    <Suspense fallback={null}>
      <DashboardAlertBannerContent />
    </Suspense>
  )
}
