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
export async function resolveCallerOrgIds(userId: string, client: OrgLookupClient): Promise<string[]> {
  if (!userId) return []
  const { data, error } = await client.from("org_members").select("org_id").eq("user_id", userId)
  if (error) {
    console.error("[entitlements] resolveCallerOrgIds failed", { userId, code: error.code, message: error.message })
    return []
  }
  return ((data ?? []) as Array<{ org_id?: string | null }>)
    .map((r) => r.org_id)
    .filter((id): id is string => Boolean(id))
}

/**
 * The identity that entitlement and quota are keyed to.
 *
 * Returns the organization whose quota this caller spends. Where a user belongs to more
 * than one organization - already true of the dual-role accounts in production - the
 * one they OWN wins, then the one they administer, then the first by membership. That is
 * a deterministic rule rather than a correct one: "which organization is this AI analysis
 * being charged to" is a real product question that a portal switcher will eventually
 * have to answer explicitly. Deterministic beats arbitrary until it does.
 *
 * Returns the user id unchanged when membership cannot be resolved. That is the pre-079
 * answer and it is deliberate: every organization 079 backfilled carries an id equal to
 * its founding user's id, so the fallback is correct for all sixteen live accounts and
 * merely wrong-and-harmless for an organization created later, which would get a fresh
 * usage_tracking row rather than an error. Failing the request instead would take the
 * whole AI surface down on a transient lookup failure.
 */
export async function agencyEntitlementId(userId: string, client: OrgLookupClient): Promise<string> {
  if (!userId) return userId
  const { data, error } = await client
    .from("org_members")
    .select("org_id, role")
    .eq("user_id", userId)
  if (error || !data || (data as unknown[]).length === 0) {
    if (error) {
      console.error("[entitlements] agencyEntitlementId falling back to user id", {
        userId,
        code: error.code,
        message: error.message,
      })
    }
    return userId
  }
  const rows = data as Array<{ org_id?: string | null; role?: string | null }>
  const rank = (r?: string | null) => (r === "owner" ? 0 : r === "admin" ? 1 : 2)
  const best = [...rows].sort((a, b) => rank(a.role) - rank(b.role))[0]
  return best?.org_id ?? userId
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
 *   - agencyEntitlementId() returns one id with the right ranking, and then falls back
 *     to returning `userId` unchanged when membership does not resolve. That fallback is
 *     deliberate and correct where it is used - a quota lookup that fails should open a
 *     fresh usage row, not take the AI surface down - but `userId` is PRECISELY the value
 *     that raises 23503 against organizations(id) for any account created after 079. Its
 *     failure direction is right for accounting and wrong for a foreign key.
 *
 * So: same ranking, opposite failure. Returns null rather than a value, and every caller
 * must treat null as "fail the request". Writing a guess here is the exact defect this
 * whole pass exists to close - a value that is accidentally correct for the sixteen
 * accounts that exist and silently wrong for the seventeenth.
 *
 * The ranking (owner, then admin, then member, then first) is copied from
 * agencyEntitlementId() on purpose. It is deterministic rather than correct: "which of my
 * organizations does this write belong to" is a real product question that the membership
 * interface will have to answer explicitly. Today it cannot arise - 079 PHASE 2 backfills
 * exactly one organization per profile and the PHASE 12 trigger creates exactly one per
 * signup, so every caller has exactly one and the ranking never has two rows to sort.
 */
export async function resolveCallerWriteOrgId(
  userId: string,
  client: OrgLookupClient
): Promise<string | null> {
  if (!userId) return null
  const { data, error } = await client.from("org_members").select("org_id, role").eq("user_id", userId)
  if (error) {
    console.error("[entitlements] resolveCallerWriteOrgId failed", {
      userId,
      code: error.code,
      message: error.message,
    })
    return null
  }
  const rows = (data ?? []) as Array<{ org_id?: string | null; role?: string | null }>
  if (rows.length === 0) return null
  const rank = (r?: string | null) => (r === "owner" ? 0 : r === "admin" ? 1 : 2)
  const best = [...rows].sort((a, b) => rank(a.role) - rank(b.role))[0]
  return best?.org_id ?? null
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
