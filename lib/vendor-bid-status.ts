/**
 * 121, OWNER RULING S1 = B + C (2026-11-06). WHAT A VENDOR OR GUEST EDIT DOES TO
 * partner_rfp_responses.status. Pure, so it is tested without a database
 * (lib/vendor-bid-status.test.ts).
 *
 * A vendor's edit never changes a status the agency set:
 *   - draft, submitted: the vendor moves only between draft and submitted. A save that names no
 *     status (the vendor page autosave) keeps the current one.
 *   - under_review ("Changes Requested", lib/bid-shared.ts): the agency asked for changes. A
 *     resubmission moves it to submitted; any other save keeps under_review.
 *   - shortlisted, meeting_requested: the agency's in-progress decision. The content edit is
 *     accepted and the status is kept, resubmission included.
 *   - awarded, declined, and any status this list does not name: final. The edit is refused.
 *
 * The vocabulary is partner_rfp_responses_status_check (scripts/019:8), seven values. closed and
 * not_selected are partner_rfp_inbox statuses only (lib/bid-status.ts:14-17); a response never
 * carries them, and if one ever did it would be refused here as unknown.
 *
 * Migration 121's guard (partner_rfp_responses_vendor_write_guard) applies the same rule to every
 * vendor session in the database. The guest route writes on the service role, which that guard
 * does not cover, so it applies this function itself.
 */

export type VendorRequestedStatus = "draft" | "submitted" | null

export const VENDOR_CYCLE_STATUSES = ["draft", "submitted"] as const
export const CHANGES_REQUESTED_STATUSES = ["under_review"] as const
export const AGENCY_IN_PROGRESS_STATUSES = ["shortlisted", "meeting_requested"] as const
export const FINAL_STATUSES = ["awarded", "declined"] as const

export type VendorStatusDecision =
  | { ok: true; status: string; kept: boolean }
  | { ok: false; current: string; message: string }

function includes(list: readonly string[], value: string): boolean {
  return list.includes(value)
}

/** The message a vendor or guest reads when the bid can no longer be edited. */
export function finalBidMessage(current: string): string {
  if (current === "awarded") return "This bid has been awarded, so it can no longer be edited."
  if (current === "declined") return "This bid has been declined, so it can no longer be edited."
  return "This bid can no longer be edited."
}

/**
 * current: the stored status, or null when no bid row exists yet (a first save).
 * requested: what the vendor asked for. null means "content only, keep the status".
 */
export function resolveVendorBidStatus(current: string | null, requested: VendorRequestedStatus): VendorStatusDecision {
  if (current === null) {
    return { ok: true, status: requested ?? "draft", kept: false }
  }
  if (includes(VENDOR_CYCLE_STATUSES, current)) {
    const status = requested ?? current
    return { ok: true, status, kept: status === current }
  }
  if (includes(CHANGES_REQUESTED_STATUSES, current)) {
    return requested === "submitted"
      ? { ok: true, status: "submitted", kept: false }
      : { ok: true, status: current, kept: true }
  }
  if (includes(AGENCY_IN_PROGRESS_STATUSES, current)) {
    return { ok: true, status: current, kept: true }
  }
  return { ok: false, current, message: finalBidMessage(current) }
}
