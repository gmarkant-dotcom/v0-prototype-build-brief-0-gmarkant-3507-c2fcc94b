import { validateTermsDisclosure, type TermsDisclosure } from "@/lib/terms-disclosure"

/**
 * Shared bid-form readiness helpers (F1) - both the portal and guest bid forms call these so
 * a collapsed section's header summary, the sticky readiness bar's count, and the actual
 * submit-time validation all agree (one source per number). Pure functions only - no state,
 * no fetching - callers pass in whatever they already compute for validation.
 */

export function getTermsReadiness(value: TermsDisclosure, required: boolean): { satisfied: boolean; label: string } {
  if (!required) return { satisfied: true, label: "Optional" }
  const result = validateTermsDisclosure(value, true)
  return { satisfied: result.ok, label: result.ok ? "Complete" : "Incomplete" }
}

/** hasTierData/requiredTotal/requiredConfirmed come straight from
 *  computeRequirementCompliance() in lib/business-criteria.ts - the same call
 *  BusinessCriteriaRequirementBlock makes internally to render its own "N of M required
 *  confirmed" line, so the collapsed-header summary can never disagree with it. */
export function getCriteriaSummaryLabel(hasTierData: boolean, requiredTotal: number, requiredConfirmed: number): string {
  if (!hasTierData) return ""
  if (requiredTotal === 0) return "Optional"
  return `${requiredConfirmed} of ${requiredTotal} required confirmed`
}

export function getAttachmentsSummaryLabel(count: number): string {
  return count === 1 ? "1 attached" : `${count} attached`
}

/** Sums however many "open required item" counts a page has (missing proposal, invalid
 *  budget/timeline, unmet terms, unconfirmed required criteria) into the sticky bar's label -
 *  negative counts never happen but are clamped defensively since callers pass arithmetic. */
export function computeReadinessLabel(...openCounts: number[]): { openCount: number; label: string } {
  const openCount = openCounts.reduce((sum, n) => sum + Math.max(0, n), 0)
  return {
    openCount,
    label: openCount <= 0 ? "Ready to submit" : `${openCount} required item${openCount === 1 ? "" : "s"} open`,
  }
}
