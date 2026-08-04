/**
 * Shared paid-vs-pending-vs-overdue derivation for a partner's payment_milestones - used by
 * the partner dashboard's stat tiles and Needs Your Response queue, and available to any
 * other surface that renders milestones, so they can never disagree on what counts as paid,
 * pending, or overdue.
 *
 * "Paid" (fixed here): a milestone counts as paid only when its status is exactly
 * "payment_received" - the terminal status app/partner/projects/page.tsx's
 * handleConfirmPayment writes when a partner confirms receipt. This function previously
 * checked for a status value of "paid", which the schema never writes (the real status
 * vocabulary is pending / invoiced / invoice_received / payment_sent / payment_delayed /
 * payment_received / need_more_info - see MILESTONE_LABEL in app/partner/projects/page.tsx),
 * so every real milestone was silently falling into "pending" regardless of actual payment
 * state. Fixed as part of wiring overdue, since overdue depends on an accurate unpaid set.
 *
 * Overdue (ruled in docs/ligament-design-language.md): unpaid AND due date before today,
 * compared as calendar days with no grace period. Pending and overdue are mutually
 * exclusive - an unpaid milestone is one or the other, never both, matching the doc's
 * "switches its Pending label to an OVERDUE badge" language. Date comparison is a plain
 * string comparison of "YYYY-MM-DD" values (both due_date and "today" normalized to that
 * format), not a Date-object comparison - due_date is stored as a date-only value, and
 * string comparison sidesteps any timezone/hour-of-day pitfall entirely. "Today" is the
 * viewer's local calendar date, since this always runs client-side.
 */

export type PartnerMilestoneForSummary = {
  amount: number
  status: string
  due_date?: string | null
}

export type PartnerPaymentSummary = {
  paid: number
  pending: number
  overdue: number
}

const PAID_STATUS = "payment_received"

/** The one place that knows what status string means "paid" - every other check (overdue,
 *  the upcoming-payments filter, status badges) should call this rather than repeat the
 *  literal, so a future status-vocabulary change only has to happen here. */
export function isMilestonePaid(status: string): boolean {
  return String(status || "").toLowerCase() === PAID_STATUS
}

function todayDateString(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, "0")
  const d = String(now.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

/** A milestone is overdue when it's unpaid and its due_date (YYYY-MM-DD) is strictly before
 *  today's date string. No due_date means it can never be overdue. */
export function isMilestoneOverdue(m: PartnerMilestoneForSummary, today: string = todayDateString()): boolean {
  if (isMilestonePaid(m.status)) return false
  const due = (m.due_date || "").slice(0, 10)
  if (!due) return false
  return due < today
}

export function summarizePartnerMilestones(milestones: PartnerMilestoneForSummary[]): PartnerPaymentSummary {
  const today = todayDateString()
  let paid = 0
  let pending = 0
  let overdue = 0
  for (const m of milestones) {
    const amount = Number(m.amount) || 0
    if (isMilestonePaid(m.status)) {
      paid += amount
    } else if (isMilestoneOverdue(m, today)) {
      overdue += amount
    } else {
      pending += amount
    }
  }
  return { paid, pending, overdue }
}
