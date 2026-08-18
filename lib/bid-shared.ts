import { isVercelBlobStorageUrl, parseGuestUploadBlobPathFromUrl } from "@/lib/vercel-blob-url"
import { formatBudgetForDisplay } from "@/lib/rfp-response-fields"
import { withTermsDisclosureDefaults, formatTermsDisclosureSummary } from "@/lib/terms-disclosure"

// ── Types shared across the bids pipeline, the deep-dive sheet, and compare mode ──

export type PaymentTerms = {
  deposit_required_pct?: number | null
  payment_schedule_preference?: string | null
  additional_notes?: string | null
} | null

export type BidAttachment = { type?: string; label: string; url: string }

export type BidRow = {
  id: string
  response_id: string | null
  response_exists: boolean
  inbox_item_id: string
  vendor_org_id?: string | null
  vendor_email?: string | null
  partner_display_name: string
  project_name: string | null
  client_name: string | null
  status: string
  budget_proposal?: string
  proposal_text?: string
  timeline_proposal?: string
  payment_terms?: PaymentTerms
  terms_disclosure?: unknown
  attachments?: BidAttachment[] | null
  business_criteria_responses?: unknown
  business_criteria_required?: unknown
  /** Absent until migration 071's column is added to this row's source SELECT (S4-1 follow-up) - always read through normalizeAcknowledgments, which returns {} for undefined. */
  business_criteria_acknowledgments?: unknown
  /** P2-1/P2-2. Fetched through a separate guarded query (see app/api/agency/rfp-responses),
   *  so both are simply absent before migrations 072/076 and on every bid that carries no
   *  structured data. Always read through normalizeBudgetLines / normalizeProposalSections. */
  budget_lines?: unknown
  /** The RFP's own category list (wizard flow). Absent for guest bids - see the route. */
  budget_categories?: unknown
  proposal_sections?: unknown
  agency_feedback?: string | null
  feedback_updated_at?: string | null
  submitted_at?: string | null
  rfp_sent_at?: string | null
  awarded_at?: string | null
  created_at: string
  updated_at: string
  inbox: {
    scope_item_name?: string | null
    response_deadline?: string | null
    project_id?: string | null
    created_at?: string | null
  } | null
  versions?: { budget?: string | null; budget_currency?: string | null }[]
  ai_summary_short?: string | null
  ai_summary_detailed?: string | null
  ai_summary_generated_at?: string | null
  composite_score?: number | null
  evaluation_status?: string | null
  ranked_recommendation?: string | null
}

// ── Terms disclosure display ────────────────────────────────────────────────

/** Legacy payment_terms predates structured terms_disclosure and has no flexibility state -
 *  shown only as a fallback for bids submitted before this feature existed. */
function legacyPaymentTermsSummary(pt: PaymentTerms): string | null {
  if (!pt) return null
  const parts: string[] = []
  if (pt.deposit_required_pct != null) parts.push(`${pt.deposit_required_pct}% deposit`)
  if (pt.payment_schedule_preference) parts.push(pt.payment_schedule_preference)
  return parts.length > 0 ? parts.join(" · ") : null
}

/** Compact one-line terms summary for bid cards (list, compare view). Prefers the
 *  structured disclosure; falls back to the legacy payment_terms shape for bids that
 *  predate this feature; null means genuinely nothing disclosed - callers render
 *  "No terms disclosed" rather than leaving blank space or inventing a value. */
export function termsSummaryLine(row: Pick<BidRow, "terms_disclosure" | "payment_terms">): string | null {
  if (row.terms_disclosure) {
    const summary = formatTermsDisclosureSummary(withTermsDisclosureDefaults(row.terms_disclosure))
    if (summary) return summary
  }
  return legacyPaymentTermsSummary(row.payment_terms ?? null)
}

// ── Status config ─────────────────────────────────────────────────────────────

export const BID_STATUSES = [
  { key: "all",               label: "All RFPs" },
  { key: "awaiting_response", label: "New" },
  { key: "submitted",         label: "Submitted" },
  { key: "under_review",      label: "Changes Requested" },
  { key: "shortlisted",       label: "Shortlisted" },
  { key: "meeting_requested", label: "Meeting Requested" },
  { key: "awarded",           label: "Awarded" },
  { key: "declined",          label: "Declined" },
] as const

export type BidStatusKey = (typeof BID_STATUSES)[number]["key"]

export const STATUS_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  awaiting_response: { bg: "bg-white/10",      text: "text-foreground-muted", label: "New" },
  submitted:         { bg: "bg-sky-500/15",    text: "text-sky-300",          label: "Submitted" },
  under_review:      { bg: "bg-amber-500/15",  text: "text-amber-300",        label: "Changes Requested" },
  shortlisted:       { bg: "bg-violet-500/15", text: "text-violet-300",       label: "Shortlisted" },
  meeting_requested: { bg: "bg-cyan-500/15",   text: "text-cyan-300",         label: "Meeting Requested" },
  awarded:           { bg: "bg-emerald-500/15",text: "text-emerald-300",       label: "Awarded" },
  declined:          { bg: "bg-red-500/15",    text: "text-red-300",          label: "Declined" },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function statusBadge(status: string) {
  return STATUS_BADGE[status] ?? STATUS_BADGE.awaiting_response
}

export function formatDeadline(raw: string | null | undefined): string | null {
  if (!raw) return null
  const d = new Date(raw)
  if (isNaN(d.getTime())) return null
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

/** Guest RFP bid uploads are stored as private blobs - route them through the
 *  authenticated agency blob-download proxy instead of linking the raw blob URL directly. */
export function attachmentHref(url: string): string {
  if (isVercelBlobStorageUrl(url) && parseGuestUploadBlobPathFromUrl(url)) {
    return `/api/agency/blob-download?url=${encodeURIComponent(url)}`
  }
  return url
}

export function bestBudgetDisplay(row: BidRow): string | null {
  const v = row.versions?.[0]
  if (v?.budget && v.budget_currency) {
    const n = parseFloat(v.budget)
    if (!isNaN(n)) return `$${n.toLocaleString("en-US")} ${v.budget_currency}`
  }
  // No version history (e.g. guest bids never get a partner_rfp_response_versions row),
  // so fall back to the response's own budget_proposal column.
  if (row.budget_proposal) {
    const display = formatBudgetForDisplay(row.budget_proposal)
    return display === "-" ? null : display
  }
  return null
}

/** Numeric budget for compare-mode bar charts; null when unparseable. */
export function bestBudgetAmount(row: BidRow): number | null {
  const v = row.versions?.[0]
  if (v?.budget) {
    const n = parseFloat(v.budget)
    if (!isNaN(n)) return n
  }
  if (row.budget_proposal) {
    try {
      const parsed = JSON.parse(row.budget_proposal) as { amount?: number }
      if (typeof parsed.amount === "number" && Number.isFinite(parsed.amount)) return parsed.amount
    } catch {
      /* not JSON */
    }
  }
  return null
}

/** Comparability key for the multi-select "Compare N Bids" flow - two bids are only
 *  comparable when they're responses to the same scope item within the same project. */
export function scopeKeyForRow(row: BidRow): string | null {
  const projectId = row.inbox?.project_id
  const scopeItemName = row.inbox?.scope_item_name
  if (!projectId || !scopeItemName) return null
  return `${projectId}::${scopeItemName}`
}

// ── Ranking (Phase 2 scoring) ─────────────────────────────────────────────────

export type RankedBlock =
  | { type: "single"; row: BidRow }
  | { type: "ranked"; scopeKey: string; rows: BidRow[] }

function isScoredComplete(row: BidRow): boolean {
  return row.evaluation_status === "complete" && row.composite_score != null
}

/**
 * Groups rows into ranked clusters (2+ complete+scored bids sharing a scope key) and
 * singles (everything else), preserving each cluster's/row's original first-appearance
 * position in the input array.
 */
export function buildRankedBlocks(rows: BidRow[]): RankedBlock[] {
  const order: string[] = []
  const byScopeKey = new Map<string, BidRow[]>()

  rows.forEach((row) => {
    const key = scopeKeyForRow(row)
    if (!key) return
    if (!byScopeKey.has(key)) {
      byScopeKey.set(key, [])
      order.push(key)
    }
    byScopeKey.get(key)!.push(row)
  })

  const groupedRowIds = new Set<string>()
  for (const key of order) {
    const groupRows = byScopeKey.get(key)!
    if (groupRows.filter(isScoredComplete).length >= 2) {
      for (const r of groupRows) groupedRowIds.add(r.id)
    }
  }

  const positioned: { firstIndex: number; block: RankedBlock }[] = []
  const handledKeys = new Set<string>()

  rows.forEach((row, index) => {
    if (groupedRowIds.has(row.id)) {
      const key = scopeKeyForRow(row) as string
      if (handledKeys.has(key)) return
      handledKeys.add(key)
      positioned.push({ firstIndex: index, block: { type: "ranked", scopeKey: key, rows: byScopeKey.get(key)! } })
    } else {
      positioned.push({ firstIndex: index, block: { type: "single", row } })
    }
  })

  return positioned.sort((a, b) => a.firstIndex - b.firstIndex).map((p) => p.block)
}

/** Within a ranked block: scored+complete bids sorted desc by composite_score first
 *  (assigned rank numbers), then unscored bids after, in their original relative order. */
export function sortRankedGroup(rows: BidRow[]): { row: BidRow; rank: number | null }[] {
  const scored = rows.filter(isScoredComplete).sort((a, b) => (b.composite_score as number) - (a.composite_score as number))
  const unscored = rows.filter((r) => !isScoredComplete(r))
  return [...scored.map((row, i) => ({ row, rank: i + 1 })), ...unscored.map((row) => ({ row, rank: null }))]
}

/** Calls POST /api/agency/bids/rank - shared by the pipeline's ranked-group card and
 *  compare mode's ranking narrative, both of which just need the resulting text. */
export async function requestRanking(
  responseIds: string[],
  force: boolean
): Promise<{ ok: true; narrative: string } | { ok: false; error: string }> {
  try {
    const res = await fetch("/api/agency/bids/rank", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ response_ids: responseIds, force }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, error: data?.error || "Analysis unavailable" }
    return { ok: true, narrative: data.narrative }
  } catch {
    return { ok: false, error: "Analysis unavailable" }
  }
}
