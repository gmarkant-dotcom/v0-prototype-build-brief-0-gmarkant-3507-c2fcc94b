/**
 * Server-side feature flags. One home, so a flag's name is greppable and its default is
 * stated once rather than re-derived at each read.
 *
 * Every flag here defaults OFF. A flag that defaults on is not a flag, it is a release.
 */

/**
 * BROADCAST_CUES_PARTNERSHIP - does broadcasting an RFP to a vendor automatically cue an
 * invitation to partner?
 *
 * DEFAULT OFF, AND MERGING THIS CHANGES NOTHING UNTIL IT IS FLIPPED. That is deliberate and
 * it is not caution for its own sake. Flipping this to "true" in the Vercel environment
 * causes the NEXT broadcast to write a pending partnerships row per account-holding
 * recipient, and migration 079's current_user_counterparty_org_ids() admits partnerships AT
 * ANY STATUS in BOTH DIRECTIONS. So the row that records "this agency emailed this vendor"
 * simultaneously makes each company's entire profiles row readable to the other - not a
 * company name and a contact, but every column on it, including default_terms (payment
 * terms, kill fee, IP, rate validity), business_criteria (insurance limits, COI document
 * URL) and default_nda_url. Sixteen pending invitations already exist and eight are real
 * third-party contacts.
 *
 * That exposure is quantified in docs/vendor-visibility-report.md, Phase 2d, and it needs
 * Greg's ruling BEFORE this is switched on. Nothing here is blocked on that ruling: the code
 * path is complete, tested by type and build, and inert.
 *
 * To turn it on: set BROADCAST_CUES_PARTNERSHIP=true in Vercel (Production and Preview) and
 * redeploy. To turn it off again: unset it. No migration is coupled to it, and no already
 * written row is undone by unsetting it - see the report's revert section.
 */
export function broadcastCuesPartnership(): boolean {
  return process.env.BROADCAST_CUES_PARTNERSHIP === "true"
}
