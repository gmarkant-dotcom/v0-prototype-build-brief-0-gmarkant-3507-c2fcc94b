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

/**
 * COLLEAGUE_INVITATIONS - is the colleague-invitation surface reachable?
 *
 * DEFAULT OFF, AND MERGING THIS CHANGES NOTHING UNTIL IT IS FLIPPED. With the variable
 * absent - which is what Vercel has today, and no env file in this repository sets it -
 * the team page renders exactly the read-only roster it rendered before, and
 * /join/<token> returns a 404. The whole surface is inert.
 *
 * WHY IT IS OFF, AND IT IS NOT CAUTION FOR ITS OWN SAKE.
 *
 * accept_org_invitation() is the first thing in this product's history that can give an
 * account a SECOND organization membership. `resolveActingOrgId()` (lib/acting-org.ts)
 * fails closed with reason "ambiguous" the moment a caller belongs to more than one
 * organization and nothing says which they are acting as, and the tie-breaker it looks
 * for is `profiles.active_org_id`.
 *
 * So a colleague who accepts an invitation without that tie-breaker in place cannot write
 * anywhere in the product: every write path resolves through that function or through
 * resolveCallerWriteOrgId(), which delegates to it. Both realistic paths reach it - an
 * invitee who already has an account has one membership from their own signup, and an
 * invitee who does not gets one from handle_new_user() before they can accept.
 *
 * MIGRATION 090 IS WHAT FIXES IT: it adds profiles.active_org_id, the set_active_org()
 * function, and the set-if-null clause in accept_org_invitation(); the switcher that
 * calls it is components/organization-switcher.tsx, in both account chips.
 *
 * THIS FLAG STAYS OFF UNTIL 090 IS APPLIED **IN THE DATABASE**. Authored is not applied.
 * The code being merged proves nothing: no gate in this repository reads a .sql file, so
 * a green build says only that the TypeScript compiles. Turning this on before 090 has
 * been run and verified in the Supabase SQL Editor hands the first colleague who accepts
 * an account that reads everything and writes nothing, with no error that explains why.
 *
 * ORDER, STATED SO IT IS NOT INFERRED:
 *   1. apply 089            - DONE. Safe on its own, nothing called it.
 *   2. push feat/m1-invitations - DONE. Safe with the flag off, the surface is
 *                                unreachable.
 *   3. apply 090            - profiles.active_org_id, set_active_org(), the replaced
 *                             accept_org_invitation(). Then deploy the switcher and the
 *                             lib/acting-org.ts commit that drops its 42703 guard.
 *   4. THEN set COLLEAGUE_INVITATIONS=true in Vercel and redeploy
 *
 * HOW TO CHECK STEP 3 ACTUALLY HAPPENED, rather than assuming it:
 *
 *     SELECT column_name FROM information_schema.columns
 *     WHERE table_schema = 'public' AND table_name = 'profiles'
 *       AND column_name = 'active_org_id';
 *     -- One row means 090 landed. Zero rows means DO NOT FLIP THIS FLAG.
 *
 * WHAT THE FLAG GATES, AND WHAT IT DELIBERATELY DOES NOT.
 *
 * THE RULE IS: GATE CREATION, NEVER GATE RESOLUTION. Creating an invitation is the only
 * operation in this feature that puts something NEW into the world. Accepting, declining
 * and revoking all RESOLVE something that already exists, and a flag that blocked them
 * would strand whatever was in flight when it was flipped.
 *
 * GATED - the three creating or presenting surfaces:
 *   app/api/org/invitations/route.ts   POST create. Answers 404 when off.
 *   app/join/<token>/page.tsx          the invitee landing page. notFound() when off.
 *   app/agency/settings/team/page.tsx  the invite affordance. The roster is NOT gated.
 *
 * The create route MUST be gated and it is the load-bearing one. Hiding the button while
 * leaving the endpoint live is worse than no flag at all: an invitation created while the
 * flag is off sends an email whose /join/<token> link 404s, so the invitee holds a link
 * they can neither accept nor decline, and the pending row then wedges that address
 * through org_invitations_one_live_per_email with nothing able to clear it.
 *
 * NOT GATED - the three resolving operations:
 *
 *   ACCEPT and DECLINE. An invitation that was already sent while the flag was on must
 *   stay answerable if the flag is turned off again. The alternative is an invitee holding
 *   a live link that refuses with no way to decline it, and a pending row nobody can clear
 *   that then blocks that address through org_invitations_one_live_per_email.
 *
 *   REVOKE. Same reason from the admin's side, and it is the one that matters most when
 *   something has gone wrong: revoke is the ADMIN'S ONLY ESCAPE from an address wedged in
 *   org_invitations_one_live_per_email. That index admits exactly one pending row per
 *   (org_id, lower(email)), there is no DELETE policy on org_invitations by design, and
 *   the create route's expiry sweep only clears rows that have already lapsed. So if
 *   revoke were gated, flipping the flag off with a live pending invitation outstanding
 *   would lock that address out of the organization until the invitation expired on its
 *   own - or forever, if it was created without one. The escape hatch has to work when the
 *   feature does not.
 *
 * A flag should make a surface unreachable going forward. It must never strand something
 * already in flight, from either side.
 *
 * To turn it on: set COLLEAGUE_INVITATIONS=true in Vercel (Production and Preview) and
 * redeploy. To turn it off: unset it. No already accepted membership is undone by
 * unsetting it - org_members rows are real and stay.
 */
export function colleagueInvitationsEnabled(): boolean {
  return process.env.COLLEAGUE_INVITATIONS === "true"
}
