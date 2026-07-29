"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { AlertTriangle, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { useAgencyUsage, getUsageSeverity, type UsageSeverity } from "@/hooks/use-agency-usage"

type MetricKey = "analyses" | "projects"

function metricNoun(metric: MetricKey): string {
  return metric === "analyses" ? "AI analyses" : "active projects"
}

function metricCopy(metric: MetricKey, current: number, limit: number | null): string {
  if (limit == null) return ""
  const suffix = metric === "analyses" ? " this month" : ""
  return `${current} of ${limit} ${metricNoun(metric)}${suffix}`
}

function dismissalKey(metric: MetricKey, severity: UsageSeverity): string {
  return `usage-banner-dismissed:${metric}:${severity}`
}

function isDismissed(metric: MetricKey, severity: UsageSeverity): boolean {
  if (typeof window === "undefined") return false
  try {
    return window.sessionStorage.getItem(dismissalKey(metric, severity)) === "1"
  } catch {
    return false
  }
}

function persistDismissal(metric: MetricKey, severity: UsageSeverity) {
  if (typeof window === "undefined") return
  try {
    window.sessionStorage.setItem(dismissalKey(metric, severity), "1")
  } catch {
    // sessionStorage unavailable (private mode, etc.) - dismissal just won't persist
  }
}

/**
 * Mounted once in the agency layout so it appears on every agency page (see
 * components/agency-layout.tsx). Never rendered in the partner portal.
 *
 * Picks one metric to lead the copy with - whichever is more severe (blocked beats
 * warning), tie-broken by higher percentage - and mentions the other metric too if it's
 * also at warning/blocked. Blocked banners are never dismissible and never consult
 * sessionStorage (there is no X button to have set a dismissal key with); warning banners
 * are, keyed by metric + severity so escalating from warning to blocked - or a different
 * metric crossing 80% later - always shows again even if an earlier warning was dismissed.
 */
export function UsageLimitBanner() {
  const { usage, isLoading } = useAgencyUsage()
  const [, forceRerender] = useState(0)

  useEffect(() => {
    // Dismissal reads sessionStorage, which is only available client-side - re-render once
    // mounted so a dismissed banner from earlier this session is hidden on first paint
    // instead of flashing before disappearing.
    forceRerender((n) => n + 1)
  }, [])

  if (isLoading || !usage) return null

  const candidates: { metric: MetricKey; severity: UsageSeverity; current: number; limit: number | null }[] = (
    ["analyses", "projects"] as const
  )
    .map((metric) => {
      const summary = usage[metric]
      return { metric, severity: getUsageSeverity(summary.percentage), current: summary.count, limit: summary.limit }
    })
    .filter((c) => c.severity !== "ok")
    .filter((c) => c.severity === "blocked" || !isDismissed(c.metric, c.severity))
    .sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === "blocked" ? -1 : 1
      const aPct = usage[a.metric].percentage
      const bPct = usage[b.metric].percentage
      return bPct - aPct
    })

  if (candidates.length === 0) return null

  const primary = candidates[0]
  const secondary = candidates.find((c) => c.metric !== primary.metric)
  const blocked = primary.severity === "blocked"

  const primaryCopy = metricCopy(primary.metric, primary.current, primary.limit)
  const secondaryCopy = secondary ? metricCopy(secondary.metric, secondary.current, secondary.limit) : null

  const message = blocked
    ? `You have reached your plan's limit for ${metricNoun(primary.metric)} (${primaryCopy}).${
        secondaryCopy ? ` You are also close to your ${metricNoun(secondary!.metric)} limit (${secondaryCopy}).` : ""
      }`
    : `You have used ${primaryCopy}.${secondaryCopy ? ` You are also close to your ${metricNoun(secondary!.metric)} limit (${secondaryCopy}).` : ""}`

  const blockedNote =
    primary.metric === "analyses"
      ? "New AI analyses are blocked until next month or you upgrade."
      : "Creating new projects is blocked until you free up a slot or upgrade."

  const handleDismiss = () => {
    persistDismissal(primary.metric, primary.severity)
    forceRerender((n) => n + 1)
  }

  return (
    <div
      className={cn(
        "w-full px-4 py-3 flex items-center gap-3 border-b",
        blocked ? "bg-red-500/10 border-red-500/30" : "bg-amber-500/10 border-amber-500/30"
      )}
    >
      <AlertTriangle className={cn("w-4 h-4 shrink-0", blocked ? "text-red-400" : "text-amber-400")} />
      <div className="flex-1 min-w-0 text-sm text-foreground">
        <span>{message}</span>
        {blocked && <span className="text-foreground-muted"> {blockedNote}</span>}
      </div>
      <div className="flex items-center gap-4 shrink-0">
        <Link href="/agency/usage" className="text-xs font-mono uppercase tracking-wider text-foreground hover:text-accent transition-colors">
          View usage
        </Link>
        <Link href="/pricing" className="text-xs font-mono uppercase tracking-wider text-accent hover:text-accent/80 transition-colors">
          Upgrade
        </Link>
        {!blocked && (
          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Dismiss"
            className="text-foreground-muted hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  )
}
