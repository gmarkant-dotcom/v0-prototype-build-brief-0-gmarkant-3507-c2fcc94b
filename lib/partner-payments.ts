/**
 * Shared paid-vs-pending derivation for a partner's payment_milestones - used by the
 * partner dashboard's stat tiles and available to the payments page, so the two surfaces
 * can never disagree on what counts as "paid" vs "pending". A milestone counts as paid only
 * when its status is exactly "paid" (matching the status values app/api/partner/payments
 * returns and app/partner/payments/page.tsx's statusBadgeClass renders - "paid", "invoiced",
 * "pending"); everything else (invoiced, pending, or any other status) is pending.
 */

export type PartnerMilestoneForSummary = {
  amount: number
  status: string
}

export type PartnerPaymentSummary = {
  paid: number
  pending: number
}

export function summarizePartnerMilestones(milestones: PartnerMilestoneForSummary[]): PartnerPaymentSummary {
  let paid = 0
  let pending = 0
  for (const m of milestones) {
    const amount = Number(m.amount) || 0
    if (String(m.status || "").toLowerCase() === "paid") paid += amount
    else pending += amount
  }
  return { paid, pending }
}
