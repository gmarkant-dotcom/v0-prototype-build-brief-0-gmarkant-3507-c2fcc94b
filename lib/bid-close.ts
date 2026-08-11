/**
 * Close bidding at deadline (Phase 2, P2-4). One source for the closed test, so the bid form's
 * gate, the submit-time server check, and every surface that renders the deadline agree - two
 * surfaces may never disagree about whether an RFP is still open.
 *
 * Standing ruling: bidding stays OPEN past its deadline unless the agency opts in. The flag
 * defaults false on both RFP tables (migration 076), so applying that migration cannot close a
 * single RFP that is open today, including ones already past their deadline.
 *
 * Three things must all be true for an RFP to be closed. A flag with no deadline is inert and
 * is treated as inert everywhere rather than as a misconfiguration to warn about.
 */

export type BidCloseConfig = {
  /** partner_rfp_inbox.close_bidding_at_deadline or rfp_magic_tokens.close_bidding_at_deadline.
   *  Undefined before migration 076, which reads as false: today's behavior exactly. */
  close_bidding_at_deadline?: boolean | null
  response_deadline?: string | null
}

export function isBiddingClosed(config: BidCloseConfig | null | undefined, now: number = Date.now()): boolean {
  if (!config) return false
  if (config.close_bidding_at_deadline !== true) return false
  const deadline = config.response_deadline
  if (!deadline) return false
  const ts = new Date(deadline).getTime()
  if (Number.isNaN(ts)) return false
  return ts <= now
}

/** Vendor-facing. States what happened and what is still true, and never apologizes. */
export const BIDDING_CLOSED_VENDOR_MESSAGE =
  "Bidding on this RFP closed at its deadline. You can still read the brief and your own submission, but new and revised bids are no longer accepted."

/** Server-side rejection, same fact in the shape an API returns. */
export const BIDDING_CLOSED_API_MESSAGE = "Bidding on this RFP closed at its deadline."

/** Short chip text for the deadline line on list and detail surfaces. */
export const BIDDING_CLOSED_BADGE = "Closed"
