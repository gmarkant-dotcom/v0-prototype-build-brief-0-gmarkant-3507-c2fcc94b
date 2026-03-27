"use client"

import { GlassCard } from "./glass-card"
import { isDemoMode } from "@/lib/demo-data"

interface EngagementContextProps {
  agency: string
  project: string
  budget: string
  className?: string
}

export function EngagementContext({ agency, project, budget, className }: EngagementContextProps) {
  // Only show engagement context in demo mode or when there's real project data
  // In production, this will be populated from actual project selection
  const isDemo = isDemoMode()
  
  if (!isDemo) {
    return null
  }
  
  return (
    <GlassCard className={className}>
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-6">
          <div>
            <div className="font-mono text-[9px] text-foreground-muted tracking-wider uppercase mb-1">
              Agency
            </div>
            <div className="font-display font-bold text-lg text-foreground">
              {agency}
            </div>
          </div>
          <div className="w-px h-8 bg-border" />
          <div>
            <div className="font-mono text-[9px] text-foreground-muted tracking-wider uppercase mb-1">
              Project
            </div>
            <div className="font-sans text-sm text-foreground-secondary">
              {project}
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="font-mono text-[9px] text-foreground-muted tracking-wider uppercase mb-1">
            Client Budget
          </div>
          <div className="font-mono text-lg text-accent font-medium">
            {budget}
          </div>
        </div>
      </div>
    </GlassCard>
  )
}
