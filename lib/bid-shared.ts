import { isVercelBlobStorageUrl, parseGuestUploadBlobPathFromUrl } from "@/lib/vercel-blob-url"
import { formatBudgetForDisplay } from "@/lib/rfp-response-fields"

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
  partner_id?: string | null
  vendor_email?: string | null
  partner_display_name: string
  project_name: string | null
  client_name: string | null
  status: string
  budget_proposal?: string
  proposal_text?: string
  timeline_proposal?: string
  payment_terms?: PaymentTerms
  attachments?: BidAttachment[] | null
  business_criteria_responses?: unknown
  business_criteria_required?: unknown
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
    return display === "—" ? null : display
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
