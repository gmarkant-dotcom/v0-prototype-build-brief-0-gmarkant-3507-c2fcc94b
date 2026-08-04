"use client"

import Link from "next/link"
import { AgencyLayout } from "@/components/agency-layout"
import { GlassCard, GlassCardHeader } from "@/components/glass-card"
import { Progress } from "@/components/ui/progress"
import { Button } from "@/components/ui/button"
import { Loader2, ArrowRight, Sparkles } from "lucide-react"
import { cn, formatDateTime } from "@/lib/utils"
import { useAgencyUsage, getUsageSeverity, type UsageSeverity } from "@/hooks/use-agency-usage"

type TierKey = "starter" | "professional" | "enterprise"

const TIER_LIMITS: Record<TierKey, { projects: number | null; analyses: number | null; label: string }> = {
  starter: { projects: 5, analyses: 50, label: "Starter" },
  professional: { projects: 20, analyses: 250, label: "Professional" },
  enterprise: { projects: null, analyses: null, label: "Enterprise" },
}

const NEXT_TIER: Record<TierKey, TierKey | null> = {
  starter: "professional",
  professional: "enterprise",
  enterprise: null,
}

function indicatorClass(severity: UsageSeverity): string {
  if (severity === "blocked") return "[&>[data-slot=progress-indicator]]:bg-red-500"
  if (severity === "warning") return "[&>[data-slot=progress-indicator]]:bg-amber-500"
  return "[&>[data-slot=progress-indicator]]:bg-success"
}

function severityTextClass(severity: UsageSeverity): string {
  if (severity === "blocked") return "text-red-400"
  if (severity === "warning") return "text-amber-400"
  return "text-success"
}

function MetricBar({
  label,
  current,
  limit,
  resetDate,
}: {
  label: string
  current: number
  limit: number | null
  resetDate?: string
}) {
  const percentage = limit == null ? 0 : Math.min(100, Math.round((current / Math.max(limit, 1)) * 100))
  const severity = getUsageSeverity(limit, percentage)

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-wider text-foreground-muted">{label}</span>
        <span className={cn("font-mono text-xs", severityTextClass(severity))}>
          {limit == null ? "Unlimited" : `${current} of ${limit} used`}
        </span>
      </div>
      {limit != null && <Progress value={percentage} className={cn("h-2", indicatorClass(severity))} />}
      {resetDate && <p className="text-[11px] text-foreground-muted">Resets {formatDateTime(resetDate)}</p>}
    </div>
  )
}

function UpgradeCard({ tier }: { tier: TierKey }) {
  const nextTier = NEXT_TIER[tier]
  if (!nextTier) return null
  const next = TIER_LIMITS[nextTier]

  return (
    <GlassCard className="border-accent/30 bg-accent/5">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center shrink-0">
          <Sparkles className="w-5 h-5 text-accent" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-display font-bold text-foreground mb-1">Upgrade to {next.label}</div>
          <p className="text-sm text-foreground-muted mb-4">
            {next.projects == null
              ? "Unlimited projects and unlimited AI analyses."
              : `${next.projects} active projects and ${next.analyses} AI analyses a month.`}
          </p>
          <Button asChild className="bg-accent text-accent-foreground hover:bg-accent/90">
            <Link href="/pricing">
              View plans
              <ArrowRight className="w-4 h-4 ml-2" />
            </Link>
          </Button>
        </div>
      </div>
    </GlassCard>
  )
}

export default function AgencyUsagePage() {
  const { usage, isLoading } = useAgencyUsage()

  return (
    <AgencyLayout>
      <div className="p-8 max-w-3xl mx-auto space-y-8">
        <div>
          <h1 className="font-display font-black text-3xl text-foreground tracking-tight">Usage</h1>
          <p className="text-foreground-muted mt-2 text-sm max-w-2xl">
            Track your plan's active-project and AI-analysis usage for the current billing period.
          </p>
        </div>

        {isLoading && (
          <div className="flex items-center gap-2 text-foreground-muted py-16">
            <Loader2 className="w-6 h-6 animate-spin" />
            Loading usage…
          </div>
        )}

        {!isLoading && usage && (
          <>
            <GlassCard>
              <GlassCardHeader label="Current plan" title={TIER_LIMITS[usage.tier].label} />
              {usage.tier === "enterprise" ? (
                <p className="text-sm text-foreground-muted">
                  Unlimited active projects and unlimited AI analyses. Nothing to track here.
                </p>
              ) : (
                <div className="space-y-6">
                  <MetricBar label="Active projects" current={usage.projects.count} limit={usage.projects.limit} />
                  <MetricBar
                    label="AI analyses this month"
                    current={usage.analyses.count}
                    limit={usage.analyses.limit}
                    resetDate={usage.analyses.resetDate}
                  />
                </div>
              )}
            </GlassCard>

            {usage.tier !== "enterprise" && <UpgradeCard tier={usage.tier} />}
          </>
        )}
      </div>
    </AgencyLayout>
  )
}
