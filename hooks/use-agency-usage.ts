import useSWR from "swr"
import type { UsageLimitsSummary } from "@/lib/usage-tracking"

export type UsageSeverity = "ok" | "warning" | "blocked"

/** Severity for a single metric. `limit` is checked first and is authoritative: null
 *  (unlimited - Enterprise, per checkUsageLimits) always returns "ok" regardless of
 *  whatever `percentage` happens to be, so no caller needs its own null-limit guard before
 *  calling this - that guard used to live ad hoc in each consumer, which is exactly how a
 *  stale percentage was able to leak through in one of them and not another. */
export function getUsageSeverity(limit: number | null, percentage: number): UsageSeverity {
  if (limit == null) return "ok"
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
