/**
 * The one definition of "which ORGANIZATION is this caller acting for right now".
 *
 * ---------------------------------------------------------------------------
 * THIS IS A TRUST BOUNDARY. READ THIS BEFORE CHANGING ANYTHING BELOW.
 *
 * An organization id decides which company's rows a request reads and which company's
 * name goes on the rows it writes. If one ever arrives from a cookie, a header, a query
 * parameter or a request body and is used to scope a query without a server-side check
 * that the caller is a member of it, that is privilege escalation: any user reaches any
 * company's data by changing one value.
 *
 * THIS MODULE CLOSES THAT BY CONSTRUCTION RATHER THAN BY DISCIPLINE. Every function here
 * takes exactly two inputs - a user id, which callers obtain from `supabase.auth.getUser()`
 * and never from a payload, and a Supabase client. THERE IS DELIBERATELY NO PARAMETER FOR
 * A REQUESTED ORGANIZATION ID. A validating resolver that accepts a candidate is one
 * refactor away from a resolver that trusts one; a resolver with no such parameter cannot
 * be misused that way, and a reviewer can see that from the signature alone.
 *
 * The set of organizations a caller may act for is derived on EVERY call, from
 * `org_members` keyed by that user id. It is never cached across requests, never carried
 * in a cookie, and never read from anything a client can influence.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS. `resolveCallerWriteOrgId()` in lib/entitlements.ts picked the caller's
 * highest-ranked membership - owner, then admin, then member, then first. Its own comment
 * calls that "deterministic rather than correct". It cannot be wrong today, because 079's
 * backfill created exactly one organization per profile and the signup trigger creates
 * exactly one per signup, so the ranking has never had two rows to sort. It becomes wrong
 * on the day colleague invitations ship: a person who owns company A and is a member of
 * company B would write every record to A, silently, with no error anywhere.
 *
 * ---------------------------------------------------------------------------
 * WHERE THE PREFERENCE LIVES, AND WHY READING IT IS STILL SAFE.
 *
 * The precedent in this codebase is `lib/acting-role.ts`: the portal toggle is persisted
 * to `profiles.active_role` and read back on each request. This mirrors it with
 * `profiles.active_org_id`.
 *
 * THE PRECEDENT IS NOT FOLLOWED BLINDLY, AND THE DIFFERENCE MATTERS. `actingRole()` TRUSTS
 * its stored value: it reads `profiles.active_role`, normalizes it, and does no further
 * check. That is defensible there and only there, because the value space is two literals,
 * because an unrecognised value resolves to null rather than to a portal, and because
 * portal ENTITLEMENT is enforced somewhere else entirely (`canActAs`, `requireAgencyRole`),
 * so the stored value chooses a branch rather than granting access.
 *
 * None of those three is true of an organization id. Its value space is every uuid, an
 * unrecognised value is indistinguishable from a real one, and the value IS the
 * authorization scope. So the stored preference here is treated as a HINT and nothing more:
 * it selects among the organizations membership already allows, and a hint that does not
 * appear in that set is discarded, logged, and the request FAILS CLOSED. A stored value
 * can never grant anything. At worst it is ignored.
 *
 * `profiles.active_org_id` EXISTS AS OF MIGRATION 090. Until then it did not, and the read
 * below carried a guard for PostgREST 42703 (undefined_column) that returned null when the
 * column was absent. THAT GUARD IS GONE, deliberately: with the column present, a 42703 is
 * no longer an expected state - it would mean the column had been dropped underneath a
 * running deployment, and swallowing that would turn a schema regression into a silent
 * "nobody has a preference", which reads as ambiguity rather than as the fault it is.
 *
 * THE COLUMN BEING POPULATED CHANGES NOTHING ABOUT HOW IT IS TREATED. Two writers set it -
 * `set_active_org(uuid)`, which the sidebar switcher calls, and `accept_org_invitation()`,
 * which initializes it ONLY IF IT IS NULL - and both validate membership before writing.
 * NEITHER OF THOSE IS THE REASON THE VALUE IS SAFE TO USE HERE. The reason is the check
 * below, on every call, every time.
 *
 * THE STALE-HINT HOLE, WHICH IS WHY THAT CHECK CANNOT BE DROPPED. REMOVING SOMEBODY FROM
 * `org_members` DOES NOT NULL THEIR `active_org_id`. There is no trigger on that deletion
 * and there deliberately is not one: a database that kept the column consistent would
 * invite the next reader to trust it, and this module would stop checking. So a removed
 * member keeps a pointer at an organization they can no longer access, indefinitely, and
 * that is a NORMAL state rather than a corrupt one. It is caught here, at read time, and
 * refused as "preference-refused". DO NOT REMOVE THE MEMBERSHIP CHECK BELOW ON THE GROUNDS
 * THAT THE COLUMN IS NOW WRITTEN BY VALIDATING FUNCTIONS. What those functions validate is
 * the moment of writing; this validates the moment of use, and only the second one is the
 * one that decides whose data gets written.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A NO-OP TODAY, ARGUED RATHER THAN ASSERTED.
 *
 * Three facts, each read from source rather than assumed:
 *
 *   1. 079 PHASE 2 inserts exactly one org_members row per profile, role 'owner'
 *      (`SELECT p.id, p.id, 'owner' FROM public.profiles p`).
 *   2. 079 PHASE 12's handle_new_user trigger inserts exactly one org_members row per
 *      signup, role 'owner'.
 *   3. NOTHING ELSE WRITES org_members. Verified by grep for insert/update/upsert/delete
 *      against that table across app/, lib/, components/ and scripts/: no match.
 *
 * So every account in existence - the 16 backfilled by 079 and every account created since,
 * including New Org 1 - has exactly one membership. On that path `resolveActingOrgId()`
 * returns that one organization without reading the preference at all, which is the same
 * value the old ranking returned, because a one-element list sorts to itself.
 *
 * It is also a no-op in COST. The stored preference is read ONLY when the caller has more
 * than one membership, so today the function issues exactly one query, the same one
 * `resolveCallerWriteOrgId()` already issued. No route gains a round trip.
 *
 * The one behaviour that is NOT identical is the multi-membership case, and it did not
 * exist to change: it used to be an arbitrary pick and it is now a refusal.
 */

import type { OrgId } from "@/lib/entitlements"

/**
 * A Supabase client narrowed to the two queries this module makes. Loose for the same
 * reason as lib/entitlements.ts and lib/capabilities.ts: naming the real builder type
 * reaches TS2589, and there are no generated `Database` types in this repository.
 */
export type ActingOrgLookupClient = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any
}

/**
 * Why a resolution came out the way it did. Callers that only need the id can ignore it;
 * callers deciding between 403 and 500 should not.
 *
 *   "sole-membership"    exactly one membership, and it was used. The path every live
 *                        account takes today.
 *   "stored-preference"  more than one membership, and the stored preference named one of
 *                        them - which is to say, the caller's own explicit choice was
 *                        honoured. Reachable as of migration 090; before it, the column
 *                        did not exist and this branch could never be taken.
 *   "no-membership"      the caller belongs to no organization. Should be unreachable
 *                        post-079; if it happens, the backfill or the signup trigger is
 *                        not doing its job.
 *   "ambiguous"          more than one membership and no usable preference. FAILS CLOSED.
 *   "preference-refused" a stored preference named an organization the caller is NOT a
 *                        member of. FAILS CLOSED, and it is logged at error, because the
 *                        only ways to reach it are a stale preference after a removal or
 *                        somebody having written that column without checking membership.
 *   "lookup-failed"      the org_members read errored. FAILS CLOSED.
 */
export type ActingOrgReason =
  | "sole-membership"
  | "stored-preference"
  | "no-membership"
  | "ambiguous"
  | "preference-refused"
  | "lookup-failed"

export type ActingOrgResolution = {
  /** Null means the caller may not write. There is no fallback and no guess. */
  orgId: OrgId | null
  reason: ActingOrgReason
  /** Every organization the caller is actually a member of. The authority set. */
  memberOrgIds: readonly OrgId[]
}

/**
 * The caller's memberships, read fresh, keyed by a user id the caller cannot choose.
 *
 * This is the AUTHORITY set and it is the only thing in this module that grants anything.
 * It reads org_members directly rather than calling the `current_user_org_ids()` RPC,
 * because that function resolves `auth.uid()` and a service-role client has no auth
 * context: it would return an empty set, which fails closed but also fails SILENTLY.
 * Passing the user id explicitly makes the answer independent of which client made the
 * call. Same reasoning, same shape, as resolveCallerOrgIds() in lib/entitlements.ts.
 */
async function loadMemberOrgIds(
  userId: string,
  client: ActingOrgLookupClient
): Promise<{ orgIds: OrgId[]; failed: boolean }> {
  const { data, error } = await client.from("org_members").select("org_id").eq("user_id", userId)
  if (error) {
    console.error("[acting-org] membership lookup failed, failing closed", {
      userId,
      code: error.code,
      message: error.message,
    })
    return { orgIds: [], failed: true }
  }
  const orgIds = ((data ?? []) as Array<{ org_id?: string | null }>)
    .map((r) => r.org_id)
    .filter((id): id is OrgId => typeof id === "string" && id.length > 0)
  return { orgIds, failed: false }
}

/**
 * The caller's stored acting-organization preference, or null.
 *
 * A HINT, NEVER A GRANT. The value this returns is checked against the membership set
 * before it is used, in resolveActingOrgId() below, and discarded if it is not in it.
 * Nothing else in this module or anywhere else may consume it directly.
 *
 * THE 42703 GUARD THAT USED TO BE HERE IS GONE. `profiles.active_org_id` exists as of
 * migration 090, so an undefined_column is no longer the expected state it was written
 * for - it is a schema regression, and it is now logged like every other error rather
 * than passed over in silence.
 *
 * EVERY FAILURE STILL RETURNS NULL, and null still means "no usable preference", which
 * resolveActingOrgId() turns into an "ambiguous" refusal for anyone with more than one
 * membership. A lookup that cannot answer must never resolve to an organization.
 */
async function loadStoredActingOrgId(
  userId: string,
  client: ActingOrgLookupClient
): Promise<string | null> {
  const { data, error } = await client
    .from("profiles")
    .select("active_org_id")
    .eq("id", userId)
    .maybeSingle()

  if (error) {
    console.error("[acting-org] stored preference lookup failed, treating as unset", {
      userId,
      code: error.code,
      message: error.message,
    })
    return null
  }
  const value = (data as { active_org_id?: string | null } | null)?.active_org_id
  return typeof value === "string" && value.length > 0 ? value : null
}

/**
 * Which organization is this caller acting for?
 *
 * Fails closed in every branch that is not a definite answer. There is deliberately no
 * fallback to "the first one", to "the highest role", or to the user id - the last of those
 * being the exact substitution that raises 23503 against organizations(id) for every
 * account created after 079.
 */
export async function resolveActingOrgId(
  userId: string,
  client: ActingOrgLookupClient
): Promise<ActingOrgResolution> {
  if (!userId) return { orgId: null, reason: "lookup-failed", memberOrgIds: [] }

  const { orgIds, failed } = await loadMemberOrgIds(userId, client)
  if (failed) return { orgId: null, reason: "lookup-failed", memberOrgIds: [] }

  if (orgIds.length === 0) {
    console.error("[acting-org] caller belongs to no organization", { userId })
    return { orgId: null, reason: "no-membership", memberOrgIds: [] }
  }

  // THE PATH EVERY LIVE ACCOUNT TAKES. One membership is not a choice, so there is nothing
  // to disambiguate and no reason to spend a second query on a preference that could only
  // agree or be discarded. This is what makes the change a no-op in behaviour and in cost.
  if (orgIds.length === 1) {
    return { orgId: orgIds[0], reason: "sole-membership", memberOrgIds: orgIds }
  }

  const stored = await loadStoredActingOrgId(userId, client)
  if (!stored) {
    // MORE THAN ONE ORGANIZATION AND NOTHING SAYS WHICH. The old code picked by role rank
    // and wrote the record to whichever won. That is a silent misattribution of a
    // customer's data to another customer's company, and it is worse than a refusal the
    // caller can see and act on.
    console.error("[acting-org] caller belongs to several organizations and none is selected", {
      userId,
      memberOrgCount: orgIds.length,
    })
    return { orgId: null, reason: "ambiguous", memberOrgIds: orgIds }
  }

  // THE CHECK THIS WHOLE MODULE EXISTS FOR. Membership decides; the preference only
  // selects within it.
  if (!(orgIds as readonly string[]).includes(stored)) {
    console.error("[acting-org] stored acting organization is not one the caller belongs to, refusing", {
      userId,
      storedOrgId: stored,
      memberOrgCount: orgIds.length,
    })
    return { orgId: null, reason: "preference-refused", memberOrgIds: orgIds }
  }

  return { orgId: stored as OrgId, reason: "stored-preference", memberOrgIds: orgIds }
}

/**
 * True when this caller may act for this organization. The membership test on its own, for
 * a route that has an organization id in hand from a row it already read and wants to check
 * it rather than resolve one.
 *
 * NOTE THE ARGUMENT ORDER AND WHAT IT IMPLIES: the organization id is the thing being
 * TESTED, never the thing being trusted. Do not use this to look something up before
 * calling it; look it up, then call this.
 */
export async function callerMayActFor(
  userId: string,
  orgId: string | null | undefined,
  client: ActingOrgLookupClient
): Promise<boolean> {
  if (!userId || typeof orgId !== "string" || orgId.length === 0) return false
  const { orgIds, failed } = await loadMemberOrgIds(userId, client)
  if (failed) return false
  return (orgIds as readonly string[]).includes(orgId)
}
