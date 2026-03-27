"use client"

import { ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { GlassCard } from "@/components/glass-card"
import { Plus, Users, FolderOpen, FileText, Briefcase, LayoutDashboard, ClipboardList, DollarSign, UserPlus } from "lucide-react"

type EmptyStateType = "projects" | "partners" | "documents" | "rfps" | "project" | "onboarding" | "payments"

interface EmptyStateProps {
  type?: EmptyStateType
  title?: string
  description?: string
  icon?: string
  actionLabel?: string
  onAction?: () => void
  className?: string
}

const emptyStateConfig: Record<EmptyStateType, {
  icon: ReactNode
  title: string
  description: string
  actionLabel: string
}> = {
  projects: {
    icon: <FolderOpen className="w-12 h-12 text-foreground-muted/50" />,
    title: "No projects yet",
    description: "Create your first project to start managing vendor engagements and tracking deliverables.",
    actionLabel: "Create Project"
  },
  partners: {
    icon: <Users className="w-12 h-12 text-foreground-muted/50" />,
    title: "No partners in your pool",
    description: "Add vendors, freelancers, and agencies to your partner pool to start building your network.",
    actionLabel: "Add Partner"
  },
  documents: {
    icon: <FileText className="w-12 h-12 text-foreground-muted/50" />,
    title: "No documents uploaded",
    description: "Upload contracts, briefs, and other project documents to keep everything organized.",
    actionLabel: "Upload Document"
  },
  rfps: {
    icon: <Briefcase className="w-12 h-12 text-foreground-muted/50" />,
    title: "No RFPs created",
    description: "Create an RFP to broadcast project opportunities to your partner network.",
    actionLabel: "Create RFP"
  },
  project: {
    icon: <LayoutDashboard className="w-12 h-12 text-foreground-muted/50" />,
    title: "No Active Projects",
    description: "When you award vendors and begin project work, your dashboard will appear here.",
    actionLabel: "Start Project"
  },
  onboarding: {
    icon: <UserPlus className="w-12 h-12 text-foreground-muted/50" />,
    title: "No Partners to Onboard",
    description: "When you award vendors from the Bids stage, you'll be able to onboard them here.",
    actionLabel: "View Bids"
  },
  payments: {
    icon: <DollarSign className="w-12 h-12 text-foreground-muted/50" />,
    title: "No Payment Activity",
    description: "Payment milestones and vendor invoices will appear here once projects are underway.",
    actionLabel: "View Projects"
  }
}

const iconMap: Record<string, ReactNode> = {
  project: <LayoutDashboard className="w-12 h-12 text-foreground-muted/50" />,
  onboarding: <UserPlus className="w-12 h-12 text-foreground-muted/50" />,
  payments: <DollarSign className="w-12 h-12 text-foreground-muted/50" />,
  documents: <FileText className="w-12 h-12 text-foreground-muted/50" />,
  partners: <Users className="w-12 h-12 text-foreground-muted/50" />,
  rfps: <Briefcase className="w-12 h-12 text-foreground-muted/50" />,
  projects: <FolderOpen className="w-12 h-12 text-foreground-muted/50" />,
}

export function EmptyState({ type, title, description, icon, actionLabel, onAction, className }: EmptyStateProps) {
  const config = type ? emptyStateConfig[type] : null
  
  const displayIcon = icon ? iconMap[icon] || iconMap.projects : config?.icon
  const displayTitle = title || config?.title || "No Data"
  const displayDescription = description || config?.description || ""
  const displayActionLabel = actionLabel || config?.actionLabel

  return (
    <GlassCard className={`flex flex-col items-center justify-center py-16 px-8 text-center ${className || ""}`}>
      <div className="mb-6">
        {displayIcon}
      </div>
      <h3 className="font-display font-bold text-xl text-foreground mb-2">
        {displayTitle}
      </h3>
      <p className="text-foreground-muted max-w-md mb-6">
        {displayDescription}
      </p>
      {onAction && displayActionLabel && (
        <Button 
          onClick={onAction}
          className="bg-accent text-accent-foreground hover:bg-accent/90"
        >
          <Plus className="w-4 h-4 mr-2" />
          {displayActionLabel}
        </Button>
      )}
    </GlassCard>
  )
}
