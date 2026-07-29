"use client"

import { createContext, useCallback, useContext, useState, type ReactNode } from "react"
import Link from "next/link"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useAgencyUsage } from "@/hooks/use-agency-usage"
// Type-only import - erased at compile time, so this never pulls lib/usage-tracking.ts's
// server-only createClient (next/headers cookies()) into client bundle code.
import type { UsageMetric } from "@/lib/usage-tracking"

type UsageLimitDetails = {
  metric: UsageMetric
  current: number
  limit: number | null
  tier: string
}

type UsageLimitModalContextType = {
  showUsageLimitModal: (details: UsageLimitDetails) => void
  /** Call with a fetch response's status and parsed body right after a non-ok response.
   *  Returns true (and opens the modal, using the server's authoritative numbers) if this
   *  was a usage_limit_reached 402 - callers should skip their own generic error handling
   *  in that case and return early. */
  handleUsageLimitError: (status: number, data: unknown) => boolean
  /** Client-side pre-check against the cached usage snapshot from useAgencyUsage. Returns
   *  false (and opens the modal) if the metric already reads at/over its limit, so a
   *  button's click handler can skip firing the request entirely - snappier than waiting
   *  for a 402 round trip. The route's own checkUsageLimit call is still the real
   *  backstop for anything this client-side snapshot misses (stale cache, another tab). */
  guardAction: (metric: UsageMetric) => boolean
}

const UsageLimitModalContext = createContext<UsageLimitModalContextType | undefined>(undefined)

function metricNoun(metric: UsageMetric): string {
  return metric === "ai_analyses" ? "AI analyses" : "projects"
}

function tierLabel(tier: string): string {
  if (tier === "professional") return "Professional"
  if (tier === "enterprise") return "Enterprise"
  return "Starter"
}

export function UsageLimitModalProvider({ children }: { children: ReactNode }) {
  const { usage } = useAgencyUsage()
  const [details, setDetails] = useState<UsageLimitDetails | null>(null)

  const showUsageLimitModal = useCallback((next: UsageLimitDetails) => {
    setDetails(next)
  }, [])

  const handleUsageLimitError = useCallback(
    (status: number, data: unknown): boolean => {
      if (status !== 402) return false
      const body = data as { error?: string; metric?: string; current?: number; limit?: number | null; tier?: string }
      if (body?.error !== "usage_limit_reached") return false
      showUsageLimitModal({
        metric: body.metric === "projects" ? "projects" : "ai_analyses",
        current: body.current ?? 0,
        limit: body.limit ?? null,
        tier: body.tier || "starter",
      })
      return true
    },
    [showUsageLimitModal]
  )

  const guardAction = useCallback(
    (metric: UsageMetric): boolean => {
      if (!usage) return true // not loaded yet - let the server-side check backstop it
      const summary = metric === "ai_analyses" ? usage.analyses : usage.projects
      if (summary.limit != null && summary.count >= summary.limit) {
        showUsageLimitModal({ metric, current: summary.count, limit: summary.limit, tier: usage.tier })
        return false
      }
      return true
    },
    [usage, showUsageLimitModal]
  )

  return (
    <UsageLimitModalContext.Provider value={{ showUsageLimitModal, handleUsageLimitError, guardAction }}>
      {children}
      <Dialog
        open={details != null}
        onOpenChange={(open) => {
          if (!open) setDetails(null)
        }}
      >
        <DialogContent className="bg-card border border-border rounded-xl">
          {details && (
            <>
              <DialogHeader>
                <DialogTitle>You have reached your {tierLabel(details.tier)} plan limit</DialogTitle>
                <DialogDescription>
                  {details.current} of {details.limit ?? "unlimited"} {metricNoun(details.metric)} used.{" "}
                  {details.metric === "ai_analyses"
                    ? "New AI analyses are blocked until next month or you upgrade."
                    : "Creating new projects is blocked until you free up a slot or upgrade."}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDetails(null)}>
                  Close
                </Button>
                <Button asChild className="bg-accent text-accent-foreground hover:bg-accent/90">
                  <Link href="/pricing">Upgrade plan</Link>
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </UsageLimitModalContext.Provider>
  )
}

export function useUsageLimitModal() {
  const ctx = useContext(UsageLimitModalContext)
  if (!ctx) throw new Error("useUsageLimitModal must be used within a UsageLimitModalProvider")
  return ctx
}
