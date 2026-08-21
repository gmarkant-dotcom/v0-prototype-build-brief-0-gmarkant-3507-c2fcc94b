/**
 * Empty-state copy for the vendor surfaces whose reads were narrowed to the acting role.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS AT ALL.
 *
 * Before the read-scope fix, `/api/partner/rfps` returned the union of every row level
 * security arm the caller satisfied, so a lead agency browsing their own vendor portal saw
 * their entire OUTBOUND broadcast history rendered as inbound bid opportunities. Measured
 * live on 2026-08-21: 96 rows, all 96 visible only as the lead agency, none as the vendor.
 *
 * The fix is correct and its consequence is that those surfaces are now legitimately EMPTY
 * for that account. That creates the exact problem migration 086's roster page was written
 * to avoid: **a vendor who has received nothing and a vendor whose rows were wrongly
 * filtered see the same screen, and cannot tell which one they are.** Someone who saw 96
 * yesterday and zero today has every reason to think the product broke.
 *
 * So the empty state says which question was asked and where the other answer lives. That
 * is the whole job. It is not reassurance and it is not an apology.
 *
 * ---------------------------------------------------------------------------
 * THE 086 PRECEDENT, AND THE TWO THINGS IT TAUGHT.
 *
 * `app/agency/settings/team/team-roster-client.tsx:602-613` says "You are the only person on
 * this team" rather than rendering one row and looking correct. Its header records what was
 * wrong with the banner it replaced: that one was UNCONDITIONAL, so it asserted something
 * false to every account it did not apply to, and it NAMED A MIGRATION NUMBER no customer
 * can act on.
 *
 * Both rules are kept here. `vendorInboxEmptyDetail()` returns the dual-role sentence ONLY
 * when the caller actually has a lead agency side, and nothing in this file names a
 * migration, a policy, a table or a column.
 *
 * ---------------------------------------------------------------------------
 * HOW "DO THEY HAVE AN AGENCY SIDE" IS ANSWERED, AND WHY IT IS SOUND.
 *
 * `profiles.role` is the role chosen at SIGNUP and it never changes; `profiles.active_role`
 * is the portal they are in now. See lib/acting-role.ts. Any caller rendering a vendor page
 * is acting as a partner, so `role === "agency"` on that page means exactly "this account
 * also runs a lead agency" - which is the population that lost rows here, and the only
 * population the extra sentence is true for.
 *
 * `usePaidUser().role` already carries that value on both portals, so this needs no new
 * fetch, no new column and no new endpoint.
 *
 * NO EM DASHES. House rule, and these strings are user-facing.
 */

/** Signup role as carried by `usePaidUser().role`. */
export type SignupRoleForCopy = "agency" | "partner" | null | undefined

/**
 * True when the caller viewing a vendor surface also operates a lead agency, and therefore
 * has somewhere else for the rows they are not seeing here to be.
 */
export function callerAlsoRunsAnAgency(role: SignupRoleForCopy): boolean {
  return role === "agency"
}

/**
 * The second sentence of a vendor empty state, or null when there is nothing true to add.
 *
 * Returning null rather than a generic fallback is the point: a vendor-only account has no
 * agency portal, so telling them where their outbound RFPs are would be nonsense.
 */
export function vendorInboxEmptyDetail(role: SignupRoleForCopy): string | null {
  if (!callerAlsoRunsAnAgency(role)) return null
  return "This is your vendor inbox, so it shows only RFPs other agencies have sent to you. The RFPs you broadcast to your own vendors live in the lead agency portal."
}

/** Headline and body for the vendor RFP list when the vendor has received nothing. */
export const VENDOR_RFPS_EMPTY = {
  title: "No RFPs have been sent to you",
  body: "When a lead agency broadcasts an RFP to your company, it will appear here.",
} as const

/** Body for the My Bids tab, which is scoped to bids this vendor submitted. */
export const VENDOR_BIDS_OPEN_EMPTY =
  "You have not submitted any bids that are still awaiting a decision. Bids you submit will appear here until the agency responds."

/** Body for the History tab. */
export const VENDOR_BIDS_HISTORY_EMPTY =
  "You have not submitted any bids yet. Every bid you submit will stay here, including the awarded and declined ones."

/** Body for the dashboard's "Needs your response" section. */
export const VENDOR_DASHBOARD_QUEUE_EMPTY =
  "Nothing is waiting on you. RFPs sent to your company by the agencies you work with will appear here."

/*
 * THERE IS DELIBERATELY NO MESSAGE-THREAD STRING HERE.
 *
 * Phase 2 narrowed the vendor branch of GET /api/projects/[id]/messages, and an empty state
 * was drafted for it and then deleted, because the route HAS NO USER INTERFACE. A grep for
 * "/messages" across app/ (excluding app/api), components/, hooks/, lib/ and contexts/
 * returns no caller: nothing fetches it and nothing renders it. Writing copy for a screen
 * that does not exist would be inventing evidence that it does.
 *
 * The fix to that route still belongs where it is - the handler is live and reachable by
 * anything holding a session - but it is preventive rather than user-visible today. Recorded
 * as OPEN-RS-5 in docs/read-scope-session-report.md rather than left as a dangling constant.
 */
