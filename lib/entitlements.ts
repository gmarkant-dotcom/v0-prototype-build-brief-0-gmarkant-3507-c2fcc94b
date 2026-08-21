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
 * THE 079 SEAM, RESOLVED
 *
 * This file used to say "the organization does not exist yet". On this branch it does:
 * migration 079 creates `organizations` and `org_members`, renames every company
 * identity column, and `usage_tracking` is keyed on `org_id`. Two of the three seams
 * this file carried are now closed and the third is blocked on a column 079 does not
 * create. Stated one at a time:
 *
 *   - CLOSED. `agencyEntitlementId()` now resolves auth.uid() to an organizations.id
 *     through org_members instead of returning the user id unchanged. It is async, and
 *     every caller of checkUsageLimit / incrementAiAnalysis / checkUsageLimits awaits it,
 *     so a colleague spends the organization's quota rather than opening a fresh one of
 *     their own.
 *   - CLOSED. `resolveCallerOrgIds()` is new. It is the membership resolution the 24
 *     service-role routes need: those routes bypass RLS entirely, so the policy rewrite
 *     in 079 protects none of them, and `.eq("org_id", session.uid)` stops meaning
 *     "my company's rows" the moment a company has two members. See
 *     docs/079-rename-plan.md section 6.
 *   - NOT CLOSED, AND NOT CLOSEABLE HERE. `hasAgencyEntitlement()` still reads
 *     `profiles.is_paid`. 079 gives `organizations` exactly four non-timestamp columns -
 *     id, name, is_lead_agency, is_vendor - and NONE of them is an entitlement. There is
 *     no organization-level `is_paid` to read, so moving this function to the
 *     organization would mean inventing a column, which is a migration and a billing
 *     decision, not a rename. Recorded in docs/079-rename-execution-report.md rather
 *     than guessed at.
 *
 *     The consequence, stated plainly so it is not discovered: billing is ruled PER
 *     ORGANIZATION, but until that column exists entitlement is still per profile row.
 *     A colleague added to a paying organization will NOT be entitled until either
 *     their own profile carries is_paid, or a migration moves entitlement onto
 *     `organizations`. That is a phase-two blocker, not a rename bug.
 */

/**
 * THE ROOT CAUSE OF THE PARAMETER-PASSING CLASS, MADE UNTYPEABLE.
 *
 * An organization id and a user id are both bare `string`, so nothing in the language
 * catches a swap. For the sixteen accounts 079 backfilled the two values are EQUAL, so
 * nothing at runtime catches it either - the swap is correct by accident until an account
 * whose organization id differs from its user id touches the same code path. That is the
 * shape three successive widenings of the grep-based scan could not see, because both sides
 * of the mistake read correctly in isolation.
 *
 * `OrgId` is minted in exactly three places: the resolvers below, which read org_members.
 * Anywhere else an organizations id enters the program it comes off a database column typed
 * `any` by PostgREST, and the cast at that boundary is deliberate and greppable
 * (`as unknown as OrgId`) rather than implicit.
 *
 * DELIBERATELY NOT BRANDED: `agencyEntitlementId()`. It returns the USER ID unchanged when
 * the acting organization does not resolve, and that value is a foreign key violation
 * against organizations(id) for every account created after 079 - INCLUDING against
 * usage_tracking, whose org_id 079 made NOT NULL with an FK. (An earlier version of this
 * comment called it "the correct failure for a usage row". It is not; see that function's
 * own header.) Leaving its return type a bare `string` is what stops it being handed to a
 * write.
 *
 * THAT PROTECTION IS NARROWER THAN IT READS, and the three exceptions are named in
 * agencyEntitlementId's header rather than left to be discovered: the brand only rejects a
 * parameter that is ITSELF typed `OrgId`, and three call sites pass the value into plain
 * `string` parameters that reach a write or a scoping predicate. The compiler rejects the
 * substitution wherever the destination is branded, which is most of the surface and not
 * all of it.
 */
export type OrgId = string & { readonly __brand: "OrgId" }

/**
 * THE OTHER HALF, MEASURED AND NOT APPLIED. A `UserId` brand would make the swap symmetric -
 * an organization id passed where a user id belongs would fail too, not just the reverse.
 * It was written, applied to the four resolvers, and measured on 2026-08-19: 154 type errors
 * across 84 files, because every `user.id` in the codebase reaches a resolver and every auth
 * boundary in every route would need an `asUserId()` cast. That is not the helpers and their
 * call sites; that is the whole application, and it is well past the point where a
 * half-migrated type system costs more than it catches. Reverted deliberately.
 *
 * It buys much less than the OrgId half in any case. Every instance of this defect class is
 * a USER id reaching an ORGANIZATION parameter, and a plain `string` is already not
 * assignable to `OrgId` - so the one-sided brand catches the whole observed class. The
 * symmetric brand would catch only the reverse, which has not occurred once.
 *
 * A staged version, if it is ever wanted: brand the return of `auth.getUser()` behind one
 * wrapper in lib/api-auth.ts, so `requireAgencyRole()` hands back a `UserId` and the cast
 * exists in one file rather than 84. That is a day's work and it should be its own pass.
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
 * A Supabase client, narrowed to the one query these resolvers make. Deliberately loose
 * for the same reason as lib/vouch-counts.ts: naming the real builder type drags the whole
 * PostgREST type graph in and tsc reports TS2589. There are no generated `Database` types
 * in this repository for a strict signature to have checked against.
 */
export type OrgLookupClient = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any
}

/**
 * Every organization this user belongs to.
 *
 * THIS IS THE FUNCTION THE SERVICE-ROLE ROUTES NEED. A client built with
 * SUPABASE_SERVICE_ROLE_KEY bypasses row level security completely, so the 079 policy
 * rewrite does not protect any of them - the only thing between a request and the whole
 * table is the hand-written check in the route. Before 079 those checks were correct by
 * an accident: `org_id = <session uid>` was simultaneously the ownership check and,
 * coincidentally, the membership check, because one user was one company. It is not any
 * more.
 *
 * Reads `org_members` directly rather than calling the `current_user_org_ids()` RPC that
 * 079 creates, because that function resolves `auth.uid()` and a service-role client has
 * no auth context - it would return an empty set, and an empty set passed to `.in()`
 * matches nothing, which fails closed but also fails silently. Pass the caller's user id
 * explicitly and the answer does not depend on which client made the call.
 *
 * Returns [] when the user belongs to no organization. Callers must treat that as "no
 * rows", never as "all rows".
 */
export async function resolveCallerOrgIds(userId: string, client: OrgLookupClient): Promise<OrgId[]> {
  if (!userId) return []
  const { data, error } = await client.from("org_members").select("org_id").eq("user_id", userId)
  if (error) {
    console.error("[entitlements] resolveCallerOrgIds failed", { userId, code: error.code, message: error.message })
    return []
  }
  const orgIds = ((data ?? []) as Array<{ org_id?: string | null }>)
    .map((r) => r.org_id)
    .filter((id): id is OrgId => Boolean(id))
  if (orgIds.length === 0) {
    // Reported here rather than at each of the call sites. An empty set fails CLOSED
    // everywhere it is used - `.in(col, [])` matches nothing and `[].includes(x)` is false -
    // which is the right direction, but a caller who belongs to no organization seeing an
    // empty page with no error anywhere is precisely the success-shaped non-event this
    // codebase keeps being bitten by. Post-079 it should be unreachable: PHASE 2 backfilled
    // one membership per profile and the PHASE 12 trigger creates one per signup. If this
    // line ever appears in the logs, one of those two is not doing its job.
    console.error("[entitlements] resolveCallerOrgIds: caller belongs to no organization", { userId })
  }
  return orgIds
}

/**
 * "Is this database column one of the caller's own organizations?"
 *
 * The ONE place a PostgREST column crosses into `OrgId`. Every authorization check in the
 * app was spelled `callerOrgIds.includes(row.org_id as string)`, and that `as string` is a
 * lie twice over: the column is nullable, and PostgREST types it `any`, so the cast
 * asserted a shape nobody had checked. This tests the shape instead of asserting it.
 *
 * Semantics are identical to what it replaces, deliberately: a null or non-string column
 * was already `includes(null)` and therefore false. Nothing widens.
 */
export function callerOwnsOrg(callerOrgIds: readonly OrgId[], value: unknown): boolean {
  if (typeof value !== "string" || value.length === 0) return false
  return (callerOrgIds as readonly string[]).includes(value)
}

/**
 * PostgREST organization columns, crossing into `OrgId` at a named boundary.
 *
 * There is no way to prove at compile time that `row.lead_org_id` holds an organization id -
 * PostgREST types every column `any`, and this repository has no generated `Database` types.
 * So the crossing is a runtime shape check with a name you can grep for, rather than an
 * `as OrgId` scattered wherever somebody needed one. Every use of this function is a place a
 * reviewer should ask "is that column really an organization id".
 *
 * Non-string and empty values are dropped rather than passed through, so the result is
 * either a usable id or an empty array - and an empty array is what `.in()` matches nothing
 * against. Fails closed.
 */
export function orgIdsFromColumns(...values: unknown[]): OrgId[] {
  return values.filter((v): v is OrgId => typeof v === "string" && v.length > 0)
}

/** The scalar form of orgIdsFromColumns(). Null for anything that is not a usable id. */
export function orgIdFromColumn(value: unknown): OrgId | null {
  return typeof value === "string" && value.length > 0 ? (value as OrgId) : null
}

/**
 * The identity that entitlement and quota are keyed to.
 *
 * Returns the organization whose quota this caller spends.
 *
 * ---------------------------------------------------------------------------
 * THE RANKING IS GONE. THIS NOW RESOLVES THE ACTING ORGANIZATION.
 *
 * It used to sort the caller's memberships owner, then admin, then member, and take the
 * first. Its own comment called that "deterministic rather than correct", which was true
 * and was only survivable because the sort never had two rows to work with.
 *
 * IT BECOMES A SILENT MISATTRIBUTION THE HOUR COLLEAGUE INVITATIONS SHIP, and it is the
 * exact inverse of the billing ruling. B owns their own auto-created organization (role
 * `owner`) and is a `member` of the paying company A. The ranking puts owner first, so
 * every AI analysis and every project B creates WHILE ACTING FOR A is metered against B's
 * own one-person organization. resolveCallerWriteOrgId() was migrated off this ranking at
 * 090 for the same reason; the quota path was not, and this closes that gap.
 *
 * ---------------------------------------------------------------------------
 * THE FALLBACK IS DELIBERATELY PRESERVED, AND THAT IS WHAT MAKES THIS SAFE TO SHIP.
 *
 * resolveActingOrgId() FAILS CLOSED - it returns null rather than guessing. This function
 * must not, and does not: `?? userId` keeps every one of the old fail-open branches
 * exactly as it found them. Branch by branch, against the code this replaces:
 *
 *   lookup error         -> null -> userId.  IDENTICAL to before, and now LOGGED, which
 *                           it already was.
 *   no membership        -> null -> userId.  IDENTICAL, and now logged, which it was NOT.
 *   exactly 1 membership -> that organization. IDENTICAL - a one-element list sorts to
 *                           itself. THIS IS EVERY ACCOUNT THAT EXISTS TODAY.
 *   >1, preference set   -> the ACTING organization. THE FIX.
 *   >1, no preference    -> null -> userId. DIFFERS: the ranking used to return the owned
 *                           organization. Near-unreachable after 090, because
 *                           accept_org_invitation initialises active_org_id when it is
 *                           null, so a colleague has a preference from the moment they
 *                           accept. See the report's OPEN list.
 *   >1, stale preference -> null -> userId. DIFFERS, same way, and needs three historical
 *                           memberships to reach at all.
 *
 * SO: NO PATH THAT WORKS TODAY STOPS WORKING. The three branches that differ all require
 * more than one membership, and nothing in this product has ever created a second one -
 * 079 PHASE 2 inserts one per profile, PHASE 12's trigger inserts one per signup, and
 * accept_org_invitation is gated behind COLLEAGUE_INVITATIONS, which is off everywhere.
 * This is a provable no-op against the live database and becomes live behaviour on
 * exactly the day the flag flips, which is the day the bug it fixes becomes live too.
 *
 * The query count is unchanged for every account that exists: resolveActingOrgId reads the
 * stored preference ONLY when there is more than one membership to choose between.
 *
 * ---------------------------------------------------------------------------
 * THE RETURN TYPE STAYS A BARE `string`. DO NOT BRAND IT.
 *
 * `resolution.orgId` is an `OrgId`, but `?? userId` widens it back to `string` and that is
 * the point - see the OrgId comment above. An unbranded return is what stops this value
 * being handed to a parameter typed `OrgId`, because the fallback CAN be a user id and a
 * user id raises 23503 against organizations(id).
 *
 * THAT PROTECTION IS NARROWER THAN THE OrgId COMMENT CLAIMS, and it is worth knowing
 * which three call sites it does not reach. The brand only rejects a parameter that is
 * ITSELF typed `OrgId`; three callers pass this value into plain `string` parameters and
 * from there into a write or a scoping predicate:
 *   app/api/agency/email-scan/import/route.ts:168  -> importContact(), writes the pool
 *   app/api/agency/email-scan/run/route.ts:341     -> enrichWithLigamentData(), and the
 *                                                     service client bypasses RLS, so that
 *                                                     argument IS the whole scoping
 *   app/api/partner/partnerships/claim/route.ts:43 -> partnerships.vendor_org_id, which
 *                                                     REFERENCES organizations(id)
 * All three get a BETTER value after this change in the branch that differs, because the
 * acting organization is the right answer for all three. None of them gets a worse one:
 * the fallback they receive in every other branch is the same `userId` they got before.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE FALLBACK ACTUALLY DOES, CORRECTED. The comment that stood here said the
 * fallback was "merely wrong-and-harmless for an organization created later, which would
 * get a fresh usage_tracking row rather than an error". THAT IS WRONG, and it has been
 * wrong since 079:
 *
 *   079 made usage_tracking.org_id NOT NULL (079:983) and added
 *   usage_tracking_org_id_org_fkey -> organizations(id) ON DELETE CASCADE in the PHASE 7
 *   repoint loop. So a `userId` that is not also an organizations.id does NOT open a fresh
 *   row - the upsert in getOrCreateMonthlyUsage() raises 23503, that function turns it
 *   into `throw new Error(...)` at lib/usage-tracking.ts:102, and the AI or project-create
 *   request 500s.
 *
 *   The fallback is therefore accidentally CORRECT for the sixteen accounts 079 backfilled
 *   with organizations.id = profiles.id, and a 500 for anybody else. It was written before
 *   that foreign key existed and was never revised.
 *
 * The fallback is kept anyway, and for the reason the old comment gave last rather than
 * first: failing the request instead would take the whole AI surface down on a transient
 * org_members lookup failure, for every account, including the sixteen for which the
 * fallback works.
 */
export async function agencyEntitlementId(userId: string, client: OrgLookupClient): Promise<string> {
  if (!userId) return userId
  const { resolveActingOrgId } = await import("@/lib/acting-org")
  const resolution = await resolveActingOrgId(userId, client)
  return resolution.orgId ?? userId
}

/**
 * The ONE organization a write may be attributed to: the caller's own.
 *
 * WHY THIS EXISTS RATHER THAN REUSING ONE OF THE TWO ABOVE. Both were read first and
 * neither fits a write, for opposite reasons:
 *
 *   - resolveCallerOrgIds() returns a SET. It is exactly right for a read, where
 *     `.in(col, ids)` is the whole answer, and useless for a column that takes one
 *     value. Taking `[0]` of it is an unordered pick dressed up as a decision.
 *   - agencyEntitlementId() resolves the same acting organization this function does, and
 *     then falls back to returning `userId` unchanged when that resolution refuses. That
 *     fallback is deliberate where it is used - a transient org_members lookup failure
 *     must not take the whole AI surface down - but `userId` is PRECISELY the value that
 *     raises 23503 against organizations(id) for any account created after 079. Its
 *     failure direction is tolerable for accounting and wrong for a foreign key.
 *
 *     NOT, AS THIS COMMENT USED TO SAY, because "a quota lookup that fails should open a
 *     fresh usage row". It does not open one. usage_tracking.org_id is NOT NULL with an FK
 *     to organizations(id) as of 079, so the fallback raises 23503 there too and the route
 *     500s. See agencyEntitlementId's own header, where the same stale claim is corrected
 *     at length.
 *
 * So: same resolution, opposite failure. Returns null rather than a value, and every caller
 * must treat null as "fail the request". Writing a guess here is the exact defect this
 * whole pass exists to close - a value that is accidentally correct for the sixteen
 * accounts that exist and silently wrong for the seventeenth.
 *
 * ---------------------------------------------------------------------------
 * THE RANKING IS GONE. THIS NOW DELEGATES TO lib/acting-org.ts.
 *
 * It used to sort the caller's memberships owner, then admin, then member, and take the
 * first, and the paragraph that used to sit here called that "deterministic rather than
 * correct". It was correct only because the sort never had two rows to work with. The day
 * colleague invitations ship it becomes a silent misattribution: a person who owns company
 * A and is a member of company B writes every record to A, with no error anywhere.
 *
 * resolveActingOrgId() replaces it with the ACTING ORGANIZATION - membership resolved
 * server-side from the user id on every call, a stored preference used only to select
 * WITHIN that membership set and discarded if it is not in it, and a refusal rather than a
 * pick when the answer is genuinely ambiguous. See lib/acting-org.ts for why it takes no
 * requested-organization parameter at all.
 *
 * BEHAVIOUR IS UNCHANGED FOR EVERY ACCOUNT THAT EXISTS. Each of them has exactly one
 * membership - 079 PHASE 2 inserts one per profile, the PHASE 12 trigger inserts one per
 * signup, and nothing in this repository writes org_members at all - and a one-element
 * list sorts to itself, so the old ranking and the new resolver return the same id. The
 * query count is unchanged too: the stored preference is read only when there is more than
 * one membership to choose between.
 *
 * WHAT EACH CALLER DOES WITH NULL is unchanged and was already correct: every one of them
 * treats it as "fail the request". That was audited before this change rather than assumed
 * - see docs/m1-foundation-report.md, Phase 2.
 */
export async function resolveCallerWriteOrgId(
  userId: string,
  client: OrgLookupClient
): Promise<OrgId | null> {
  const { resolveActingOrgId } = await import("@/lib/acting-org")
  const resolution = await resolveActingOrgId(userId, client)
  return resolution.orgId
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
 * 079 DID NOT CLOSE THIS SEAM and could not: `organizations` carries no entitlement
 * column. See the header of this file. Until a migration puts entitlement on the
 * organization, a colleague of a paying owner is not entitled unless their own profile
 * row says so.
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
 * May this caller upload a file on the VENDOR side?
 *
 * THE ONE DEFINITION OF THE EXPRESSION THAT WAS INLINED IN TWO VENDOR UPLOAD ROUTES -
 * app/api/partner/documents/upload/route.ts and app/api/partner/rfp-bid/upload/route.ts.
 * Both spelled it out by hand, identically, and both carried the same paragraph explaining
 * why they were not calling canUploadFiles(). That paragraph was right, which is why this
 * function exists instead of a swap.
 *
 * WHY NOT canUploadFiles(). It is STRICTER, on one axis, and the difference is reachable:
 * canUploadFiles() asks actingRole(profile) === "partner", where active_role decides and
 * `role` is consulted only when active_role is unset. This asks canActAs(profile,
 * "partner"), where EITHER column naming 'partner' is enough. For an account with
 * role='partner' and active_role='agency' and is_paid=false, canUploadFiles() returns
 * false and these two routes returned true. Swapping them would have 403'd that account
 * with no billing reason to.
 *
 * BEHAVIOUR IS OTHERWISE IDENTICAL TO THE EXPRESSION THIS REPLACES, term by term:
 *
 *   `process.env.NEXT_PUBLIC_IS_DEMO === "true"`  ->  isDemoDeployment(), which is that
 *      expression and nothing else. And it is FIRST here as it was first there, so a demo
 *      deployment with no profile row still returns true rather than tripping the null
 *      guard below.
 *   `profile?.role === "partner" || profile?.active_role === "partner"`
 *      ->  canActAs(profile, "partner"), which is `normalize(role) === "partner" ||
 *      normalize(active_role) === "partner"`.
 *   `profile?.is_admin`  ->  `profile.is_admin === true`. Identical for a boolean-or-null
 *      column: null is falsy and is not === true.
 *   `profile?.is_paid`   ->  `profile.is_paid === true`. Same.
 *   `profile` undefined  ->  the inline chain evaluated to undefined, which `if (!canUpload)`
 *      treated as a refusal. `if (!profile) return false` is that refusal, explicitly.
 *
 * THE ONE NON-IDENTITY, STATED RATHER THAN GLOSSED: canActAs() runs its inputs through
 * normalize(), which trims and lower-cases; the raw comparisons did not. So ' Partner '
 * would satisfy this and did not satisfy the inline form. That is a widening, in the
 * permissive direction, on a vendor-only route that gates again immediately afterwards -
 * and it cannot fire on any row that exists: every writer of role and active_role in the
 * repository writes the exact literal 'agency' or 'partner' (079 PHASE 12's CASE
 * expression, switch-role's and active-role's strict validation, the auth callback), and
 * all 18 live accounts were confirmed to carry a role matching their signup choice. The
 * query that settles it is in docs/091-session-report.md.
 *
 * THE VENDOR SIDE UPLOADS FREE and the `is_paid` term still decides nothing here - a paid
 * agency clears this line and is turned away by the "Vendors only" check underneath it in
 * both routes. The term is kept because removing it would be a behaviour change dressed up
 * as a cleanup, and because 079 makes the vendor's own company an organization: if
 * vendor-side billing ever exists, its entitlement is read HERE, once, instead of in two
 * routes that have already drifted apart once.
 */
export function canUploadVendorFiles(profile: EntitlementProfile): boolean {
  if (isDemoDeployment()) return true
  if (!profile) return false
  return canActAs(profile, "partner") || profile.is_admin === true || profile.is_paid === true
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
 *
 * ---------------------------------------------------------------------------
 * IT HAS ZERO CALLERS. MEASURED, AND DELIBERATELY NOT DELETED.
 *
 * Grepped by name across EVERY file type in the repository - .ts, .tsx, .sql, .md, .json,
 * everything outside .git, node_modules and .next. Two hits: this definition, and one row
 * in a documentation table at docs/m1-prework-report.md:479. No alternate spelling, no
 * case variant. AND NO NAMESPACE IMPORT OF THIS MODULE EXISTS ANYWHERE, so there is no
 * `entitlements.canUseAgencyPortalAi` property-access path a name grep would miss. It is
 * genuinely uncalled, not apparently uncalled.
 *
 * WHY IT STAYS. Twice in this codebase's history, "dead" code has turned out to be live
 * through a redirect or a default, so the bar for deleting is higher than a grep. Two
 * reasons beyond that, and the second is the load-bearing one:
 *
 *   1. It is an EXPORT. Removing it is a change to this module's public surface, made in a
 *      pass whose subject is a migration.
 *
 *   2. ADOPTING IT AT THE TWO ROUTES IT NAMES IS NOT FREE, and that is the thing to know
 *      before somebody "finishes the job". app/api/agency/msa/ai-schedule/route.ts:78 and
 *      app/api/agency/payment-synthesis/route.ts:69 each run the two halves as two
 *      statements returning TWO DIFFERENT REFUSALS - "Subscription required for AI
 *      features" and "Agency only". Collapsing them into this one boolean would tell a
 *      caller who is entitled but in the wrong portal that they need a subscription, which
 *      is a copy regression and a support ticket. Adoption needs the messages resolved
 *      first, and that is a product decision.
 *
 * RECOMMENDATION: leave it until entitlement moves onto the organization. At that point
 * hasAgencyEntitlement() stops being answerable from a profile row and this composition is
 * the natural single place to make the portal-plus-entitlement pair async. If that design
 * lands without using it, delete it in the same change - with the two messages resolved.
 * Recorded in docs/091-session-report.md.
 */
export function canUseAgencyPortalAi(profile: EntitlementProfile): boolean {
  return canActAs(profile, "agency") && hasAgencyEntitlement(profile)
}

/**
 * The organization a GIVEN user belongs to - not the caller's own.
 *
 * WHY THIS IS SEPARATE FROM THE THREE RESOLVERS ABOVE. All three answer a question about
 * `auth.uid()`, the person making the request. This one answers it about somebody else:
 * the vendor whose profile a lead agency just matched by email, the bidder whose vouches
 * are being counted, the colleague named on a milestone. Before 079 that question had no
 * answer because it had no question - a profiles.id WAS the company. Now it needs a
 * lookup, and there was nowhere to put it, which is why nineteen call sites went on
 * passing a profiles.id straight into an organization column.
 *
 * Returns null when the user belongs to no organization. Every caller must treat null as
 * "no organization", never as "use the user id instead" - that substitution is the exact
 * defect this closes, and it is invisible for the sixteen backfilled accounts whose
 * organization id equals their founder's user id.
 */
export async function resolveOrgIdForUser(
  userId: string | null | undefined,
  client: OrgLookupClient
): Promise<OrgId | null> {
  if (!userId) return null
  const map = await resolveOrgIdsForUsers([userId], client)
  return map.get(userId) ?? null
}

/**
 * The same lookup for many users at once, as a user id -> organization id map.
 *
 * One round trip rather than N. Users missing from the returned map belong to no
 * organization; callers must not fall back to the user id for them.
 *
 * Where a user belongs to more than one organization the ranking is owner, then admin,
 * then member, matching resolveCallerWriteOrgId(). Deterministic rather than correct, for
 * the same reason stated there: today every user belongs to exactly one organization, so
 * the ranking never has two rows to sort. It becomes a real product question the moment
 * colleague invitations ship (M1).
 */
export async function resolveOrgIdsForUsers(
  userIds: readonly string[],
  client: OrgLookupClient
): Promise<Map<string, OrgId>> {
  const wanted = Array.from(new Set(userIds.filter((id): id is string => Boolean(id))))
  const out = new Map<string, OrgId>()
  if (wanted.length === 0) return out

  const { data, error } = await client.from("org_members").select("user_id, org_id, role").in("user_id", wanted)
  if (error) {
    console.error("[entitlements] resolveOrgIdsForUsers failed", {
      count: wanted.length,
      code: error.code,
      message: error.message,
    })
    return out
  }

  const rank = (r?: string | null) => (r === "owner" ? 0 : r === "admin" ? 1 : 2)
  const bestRank = new Map<string, number>()
  for (const row of (data ?? []) as Array<{ user_id?: string | null; org_id?: string | null; role?: string | null }>) {
    const uid = row.user_id
    const oid = row.org_id
    if (!uid || !oid) continue
    const r = rank(row.role)
    const seen = bestRank.get(uid)
    if (seen === undefined || r < seen) {
      bestRank.set(uid, r)
      out.set(uid, oid as OrgId)
    }
  }
  return out
}
