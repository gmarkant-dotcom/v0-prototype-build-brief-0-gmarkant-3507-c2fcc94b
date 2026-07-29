import useSWR from "swr"
import type { UsageLimitsSummary } from "@/lib/usage-tracking"

export type UsageSeverity = "ok" | "warning" | "blocked"

/** Severity for a single metric's percentage (0-100+). Pass usage.analyses.percentage or
 *  usage.projects.percentage - Enterprise's percentage is always 0 (see checkUsageLimits),
 *  so this naturally returns "ok" for unlimited plans without a separate tier check. */
export function getUsageSeverity(percentage: number): UsageSeverity {
  if (percentage >= 100) return "blocked"
  if (percentage >= 80) return "warning"
  return "ok"
}

/** SWR-backed (matches this codebase's client-fetch convention - see hooks/useFetch.ts and
 *  components/swr-provider.tsx) fetch of GET /api/agency/usage. Fetches once on mount and
 *  caches via SWR's default dedupe/cache; revalidateOnFocus/Reconnect are already off
 *  globally, so this only refetches when refresh() is called. */
export function useAgencyUsage() {
  const { data, isLoading, mutate } = useSWR<UsageLimitsSummary>("/api/agency/usage")
  return {
    usage: data ?? null,
    isLoading,
    refresh: () => mutate(),
  }
}
