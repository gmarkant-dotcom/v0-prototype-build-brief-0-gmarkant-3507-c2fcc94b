import { actingRole, canActAs } from "./acting-role"

/**
 * The one definition of "is this caller entitled to the paid lead agency capability".
 *
 * Two questions get asked at every gated route and they are NOT the same question:
 *
 *   1. WHICH SIDE is this caller operating - agency or vendor? Answered by
 *      lib/acting-role.ts, from role/active_role. A session fact.
 *   2. MAY they - is the paying entity behind this caller entitled? Answered here,
 *      from is_paid/is_admin. A billing fact.
 *
 * Before this module, several routes answered (2) with `role === 'agency' && is_paid`,
 * which folds the portal question into the billing question and gets both wrong:
 *
 *   - `role` is not the portal. Migration 056 wrote role='agency' onto every account
 *     regardless of what the signup form said, so `role` names neither the side the
 *     caller is on nor anything about billing.
 *   - Worse, `role === 'partner'` was used as a standalone ALLOW clause in the three AI
 *     routes and in the two upload routes. That is not an entitlement check at all - it
 *     grants the capability to anyone whose signup row happens to say 'partner', with no
 *     billing test anywhere in the expression.
 *
 * ---------------------------------------------------------------------------
 * BILLING RULING THIS ENCODES (Greg, 2026-08-17)
 *
 *   - Billing is PER ORGANIZATION, not per seat.
 *   - Quotas (AI analyses, projects) sit at the organization level and step up by tier.
 *   - Adding a colleague costs nothing. A member consumes the organization's quota.
 *
 * ---------------------------------------------------------------------------
 * WHAT MIGRATION 079 CHANGES HERE
 *
 * The organization does not exist yet. There is no `org_id` column until 079. Until then
 * the paying entity IS the lead agency's own profile row, which is also what every
 * agency-scoped RLS policy and every `usage_tracking.agency_id` row already keys on -
 * one user, one agency, one payer.
 *
 * At 079 that stops being true and this file is the seam:
 *
 *   - `agencyEntitlementId()` starts resolving auth.uid() to organizations.id through
 *     org_members, instead of returning the user id unchanged. Every caller of
 *     checkUsageLimit / incrementAiAnalysis / checkUsageLimits must route through it so
 *     a colleague spends the organization's quota rather than opening a fresh one of
 *     their own.
 *   - `hasAgencyEntitlement()` starts reading the organization's entitlement instead of
 *     `profiles.is_paid`, so every member of a paying organization is entitled without
 *     each of them carrying their own flag.
 *
 * The full list of call sites 079 has to revisit is in docs/m1-prework-report.md, Item 2.
 * Every one of them is marked in code with the string "079:".
 */

export type EntitlementProfile =
  | {
      role?: string | null
      active_role?: string | null
      is_paid?: boolean | null
      is_admin?: boolean | null
    }
  | null
  | undefined

/**
 * The demo deployment bypasses entitlement entirely. Kept here rather than re-read at
 * eight call sites so the env var name has one home.
 */
export function isDemoDeployment(): boolean {
  return process.env.NEXT_PUBLIC_IS_DEMO === "true"
}

/**
 * The identity that entitlement and quota are keyed to.
 *
 * 079: this returns the caller's organization id, resolved from org_members. Today one
 * user is one agency is one payer, so it returns the user id unchanged. Call this instead
 * of passing `user.id` straight into lib/usage-tracking.ts - when 079 lands, changing this
 * function is meant to be most of the work.
 */
export function agencyEntitlementId(userId: string): string {
  return userId
}

/**
 * Is the paying entity behind this caller entitled to paid lead agency capability?
 *
 * Billing only. Says nothing about which portal the caller is in - pair it with
 * canActAs()/actingRole() when the route also needs to answer that.
 *
 * `is_paid === true` rather than `is_paid !== false`: a null entitlement is not an
 * entitlement, and the two spellings were already inconsistent across routes (the AI
 * routes used `!== false`, the project and upload routes used truthiness). One spelling,
 * and it is the strict one. No live profile carries a null is_paid, verified read-only
 * on 2026-08-17.
 *
 * 079: reads the organization's entitlement, not the member's profile flag.
 */
export function hasAgencyEntitlement(profile: EntitlementProfile): boolean {
  if (isDemoDeployment()) return true
  if (!profile) return false
  if (profile.is_admin === true) return true
  return profile.is_paid === true
}

/**
 * May this caller run the agency-side AI features - master brief generation, RFP output
 * templates, bid scoring narratives, the generic /api/ai tools?
 *
 * Both halves are required: operating the agency side AND entitled. Admins bypass, as
 * they do everywhere else in this codebase.
 *
 * This deliberately drops the old standalone `role === 'partner'` allow clause. No vendor
 * surface calls any of these routes - every caller of /api/ai/master-brief,
 * /api/ai/rfp-output-template and /api/documents/extract-text lives under app/agency/,
 * verified by grep - so that clause granted an agency capability to the vendor side for
 * nothing in return.
 */
export function canUseAgencyAi(profile: EntitlementProfile): boolean {
  if (isDemoDeployment()) return true
  if (!profile) return false
  if (profile.is_admin === true) return true
  return actingRole(profile) === "agency" && profile.is_paid === true
}

/**
 * May this caller upload a file?
 *
 * The vendor side is free: a vendor uploads bid attachments, legal documents and reel
 * links without an entitlement of their own, and under the ruled model their own company
 * is a separate organization with its own (currently non-existent) billing. So the vendor
 * branch returns true without a billing test - that is the product decision, not an
 * oversight.
 *
 * The agency side is not free, and before this it effectively was: the previous
 * expression was `isDemo || role === 'partner' || role === 'agency' || is_admin ||
 * is_paid`, and since every live profile carries a role of exactly 'agency' or 'partner',
 * the second and third clauses between them matched every authenticated caller. The gate
 * returned 403 for nobody.
 */
export function canUploadFiles(profile: EntitlementProfile): boolean {
  if (isDemoDeployment()) return true
  if (!profile) return false
  if (profile.is_admin === true) return true
  if (actingRole(profile) === "partner") return true
  return profile.is_paid === true
}

/**
 * Portal-entitlement pair for the two routes that gate on "agency portal AND paid":
 * /api/agency/msa/ai-schedule and /api/agency/payment-synthesis.
 *
 * Those two used canActAs() for the portal half - deliberately the permissive OR over
 * role/active_role, because switch-role already checks entitlement before it can ever
 * write active_role='agency'. That half is preserved exactly. Only the billing half
 * changes, from `role === 'agency' && (is_paid || is_admin)` to a plain entitlement test,
 * which is what the ruling asks for and what stops migration 078's role correction from
 * locking a paying dual-role account out of its own agency tools.
 */
export function canUseAgencyPortalAi(profile: EntitlementProfile): boolean {
  return canActAs(profile, "agency") && hasAgencyEntitlement(profile)
}
