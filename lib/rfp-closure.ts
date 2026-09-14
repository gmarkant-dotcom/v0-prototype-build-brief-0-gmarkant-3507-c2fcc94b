/**
 * RFP CLOSURE. The shared vocabulary for R7's two closure events.
 *
 * ---------------------------------------------------------------------------
 * THE TWO STATUSES ARE DIFFERENT MESSAGES AND MUST NOT COLLAPSE
 *
 *   closed        the opportunity ended, for every vendor at once
 *   not_selected  this vendor specifically was not chosen, while others stay open
 *
 * NEITHER IS THE EXISTING `declined`. `declined` on partner_rfp_inbox means a
 * vendor who SUBMITTED A BID AND LOST - it is written by the agency's bid
 * decision PATCH through mapResponseStatusToInboxStatus. The two values here
 * mean a vendor who was ASKED AND NEVER ANSWERED. Collapsing them would make
 * the two indistinguishable in that vendor's own history, which is the whole
 * thing R7 exists to prevent.
 *
 * Both are permitted by partner_rfp_inbox_status_check only after migration 099.
 * Before it they raise 23514 and write nothing.
 */

/** The two values migration 099 adds to partner_rfp_inbox.status. */
export const RFP_CLOSURE_STATUSES = ["closed", "not_selected"] as const
export type RfpClosureStatus = (typeof RFP_CLOSURE_STATUSES)[number]

export function isRfpClosureStatus(value: unknown): value is RfpClosureStatus {
  return typeof value === "string" && (RFP_CLOSURE_STATUSES as readonly string[]).includes(value)
}

/**
 * THE TWO UNITS R7 DEFINES.
 *
 *   "rfp"     close the whole RFP: every open row for that project plus scope
 *             item, in one act, for every vendor at once.
 *   "vendor"  decline one vendor: one row, while every other vendor on that
 *             same RFP stays open.
 */
export const RFP_CLOSURE_UNITS = ["rfp", "vendor"] as const
export type RfpClosureUnit = (typeof RFP_CLOSURE_UNITS)[number]

export function isRfpClosureUnit(value: unknown): value is RfpClosureUnit {
  return typeof value === "string" && (RFP_CLOSURE_UNITS as readonly string[]).includes(value)
}

/** Each unit writes exactly one status. The mapping is total and has no default. */
export function statusForUnit(unit: RfpClosureUnit): RfpClosureStatus {
  return unit === "rfp" ? "closed" : "not_selected"
}

/**
 * >>> THE STATUSES A CLOSURE MAY TOUCH. THIS IS THE WHOLE OF 3a's RULING AND
 * >>> IT IS DELIBERATELY AN ALLOW-LIST.
 *
 * TOUCHED:     new, viewed
 * NEVER TOUCHED: bid_submitted, revision_submitted, feedback_received,
 *                shortlisted, meeting_requested, awarded, declined,
 *                and (for idempotency) closed and not_selected themselves.
 *
 * The rule in one sentence: a closure ends a request that was never answered,
 * and every status outside this pair means the vendor answered or the agency
 * already decided.
 *
 *   bid_submitted / revision_submitted  a bid exists. A submitted bid is not an
 *                                       unanswered request, and closing it would
 *                                       destroy the only record that the vendor
 *                                       did the work of responding.
 *   feedback_received                   a bid exists and the agency wrote on it.
 *   shortlisted / meeting_requested     the agency advanced this vendor.
 *   awarded                             the vendor WON. Closing this would be
 *                                       the worst possible write in this file.
 *   declined                            already terminal, and a different fact.
 *   closed / not_selected               already closed. 3d: re-closing is a
 *                                       no-op, not an error and not a second
 *                                       notification.
 *
 * AN ALLOW-LIST RATHER THAN A DENY-LIST, DELIBERATELY. A deny-list would have to
 * be extended every time a status is added to the vocabulary, and the failure
 * mode of forgetting is that a closure silently eats a status it should never
 * have touched. The failure mode of forgetting to extend an allow-list is that a
 * closure declines to act, which is visible and harmless.
 */
export const RFP_CLOSABLE_STATUSES = ["new", "viewed"] as const

export function isClosableStatus(value: unknown): boolean {
  return typeof value === "string" && (RFP_CLOSABLE_STATUSES as readonly string[]).includes(value)
}
