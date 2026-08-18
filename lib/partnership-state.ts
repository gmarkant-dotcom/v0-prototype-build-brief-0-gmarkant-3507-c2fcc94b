/**
 * The one definition of what state a partnership is in.
 *
 * Three definitions used to coexist, and they disagreed on the same row:
 *  - the pool's Active column filtered on `vendor_org_id` being populated
 *  - the vendor detail route required `status = 'active'`
 *  - the Active card's date read the legacy `invited_at` while the Invited column's
 *    membership read `invitation_sent_at`
 *
 * `status` is the relationship fact and the only source of truth for it. `vendor_org_id` is an
 * account fact: it says the contact has claimed a Ligament login, nothing more. The two were
 * being conflated, and because the claim runs automatically on the vendor's next page load
 * (app/api/partner/partnerships/claim/route.ts), any invited vendor who merely signed in was
 * promoted into "Active vendors" without ever pressing Accept. lib/server/partner-pool-import.ts
 * states the intended model in its own comment: "Activation only happens via invite -> accept."
 *
 * `invitation_sent_at` (migration 063) is written only after a confirmed successful send, so it
 * is the only timestamp that means an email actually went out. The legacy `invited_at` is
 * DB-defaulted at insert and equals created_at on every row that has one, so it says "added to
 * the pool", not "invited". It is not read for state anywhere in this module.
 *
 * See docs/invitation-diagnosis.md section 0.8 for the live rows that proved each disagreement.
 */

/**
 * The three pool columns. Exhaustive and mutually exclusive - every row lands in exactly one.
 *
 * "network" is the relationship column (the pool's "Active vendors"): active, plus the paused
 * and ended states that were once active. It is deliberately NOT a synonym for
 * isActivePartnership() - a suspended or terminated partnership has moved past the invitation
 * and belongs beside the live ones, badged for what it is. Filing it under Invited would be a
 * new lie in place of the one this module removes. Within the column, the Active treatment is
 * still driven by isActivePartnership() alone.
 */
export type PartnershipPoolColumn = "network" | "invited" | "discovered"

/**
 * Accepts either spelling of the columns, because the API routes carry snake_case straight
 * from Postgres and the pool page maps them to camelCase before rendering. Both are the same
 * two facts.
 */
export type PartnershipStateInput = {
  status?: string | null
  invitation_sent_at?: string | null
  invitationSentAt?: string | null
}

function invitationSentAt(row: PartnershipStateInput): string | null {
  const v = row.invitation_sent_at ?? row.invitationSentAt ?? null
  return typeof v === "string" && v.trim() ? v : null
}

/**
 * The relationship is live. This is the ONLY test for "active" - never `vendor_org_id`, and
 * never the presence of a partnership row at all.
 */
export function isActivePartnership(row: PartnershipStateInput | null | undefined): boolean {
  return (row?.status ?? null) === "active"
}

/** An invitation email was confirmed sent for this row. */
export function wasInvitationSent(row: PartnershipStateInput | null | undefined): boolean {
  return row ? invitationSentAt(row) !== null : false
}

/**
 * Which pool column a row belongs in. `pending` is the only status that can still be awaiting
 * an answer, so it is the only one that splits on whether an invitation was actually sent.
 * Everything else has a relationship behind it and belongs in the network column.
 */
export function partnershipPoolColumn(row: PartnershipStateInput): PartnershipPoolColumn {
  const status = row.status ?? "pending"
  if (status !== "pending") return "network"
  return wasInvitationSent(row) ? "invited" : "discovered"
}

/**
 * The human label for a row's state, shared by the pool columns and by the spreadsheet
 * import's dedup-against-existing-pool step so the importer cannot describe a row one way
 * while the column it sits in describes it another.
 */
export function partnershipStateLabel(row: PartnershipStateInput): string {
  switch (partnershipPoolColumn(row)) {
    case "network":
      return isActivePartnership(row) ? "Active vendor" : `Vendor (${row.status})`
    case "invited":
      return "Invited"
    default:
      return "Discovered"
  }
}
