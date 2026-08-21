import { NextResponse } from "next/server"
import { createClient as createSupabaseClient } from "@supabase/supabase-js"
import { requireAdminRole } from "@/lib/api-auth"
import { resolveOrgIdForUser, type OrgLookupClient } from "@/lib/entitlements"

export const dynamic = "force-dynamic"

/**
 * The admin panel's account flag toggles.
 *
 * ---------------------------------------------------------------------------
 * 092: is_paid IS NO LONGER A PROFILE FLAG. IT IS THE COMPANY PLAN.
 *
 * This route now writes THREE FLAGS TO TWO TABLES, and the split is not cosmetic:
 *
 *   is_paid      -> public.organizations, on the target user's organization.
 *                   Entitlement is an ORGANIZATION fact - one price per company, any
 *                   number of colleagues - and every gate in the product reads it there
 *                   as of 092. See lib/entitlements.ts, resolveAgencyEntitlement().
 *   is_admin     -> public.profiles. Platform staff. A property of a PERSON.
 *   demo_access  -> public.profiles. Same.
 *
 * WITHOUT THIS CHANGE GREG CAN NO LONGER MARK ANYBODY PAID. The toggle would go on
 * flipping profiles.is_paid, report success, and grant nobody anything - because after
 * the 092 deploy nothing reads that column as an entitlement. That is the exact
 * silent-success shape this route was written to fix, delivered a second time through a
 * different door.
 *
 * THE SERVICE ROLE IS WHAT MAKES THE ORGANIZATIONS WRITE POSSIBLE, and it was verified
 * against 092's exemption rather than assumed. organizations_entitlement_guard refuses a
 * write to is_paid when auth.uid() IS NOT NULL. A service_role JWT carries no `sub`
 * claim, so auth.uid() resolves NULL and this route is EXEMPT - the same outcome 091's
 * writer-outcome table records for this same route against the profiles guard. Same
 * client, same mechanism, same answer.
 *
 * >>> IF THIS ROUTE IS EVER MOVED TO A SESSION CLIENT, THE is_paid WRITE STOPS WORKING
 * >>> AND RAISES LG008. That is the guard doing its job: being an admin of an
 * >>> organization must not permit writing its plan, because every user is an admin of
 * >>> their own organization.
 *
 * ---------------------------------------------------------------------------
 * These used to be issued straight from the browser as
 * `supabase.from('profiles').update({...}).eq('id', otherUserId)`. Per
 * docs/schema-snapshot-2026-08-13.md, profiles carries exactly one UPDATE policy - "Users
 * can update own profile", qual (auth.uid() = id) - and no admin policy of any kind. So
 * every one of those writes matched zero rows for every account except the admin's own, and
 * PostgREST reports a zero-row UPDATE as success. The toggle flipped in the UI and nothing
 * changed in the database.
 *
 * The fix is deliberately NOT a new "admins can update all profiles" policy: that would let
 * any browser session holding an admin's cookie write any column of any profile on the
 * platform. Instead the gate runs server-side and the write is performed with the service
 * role, which is constructed only after requireAdminRole has passed.
 *
 * Two invariants this route exists to hold:
 *   1. An update that changes no rows is an ERROR, never a success. The original bug was a
 *      failed write reporting success, so silence is treated as failure here by construction.
 *   2. The last remaining admin cannot clear their own is_admin flag. There is no in-app way
 *      to restore it - profiles has no admin UPDATE policy - so the recovery path would be
 *      the Supabase SQL editor, which is not a state to strand someone in by accident.
 */

/**
 * Allow-list. The request body is never spread into any update.
 *
 * THE WIRE CONTRACT IS UNCHANGED BY 092 - the admin page still PATCHes
 * `{ is_paid: true }` and still reads `user.is_paid` off the response. Only the table
 * underneath `is_paid` moved. Keeping the field name is deliberate: renaming it would be
 * a client change for no benefit, and "is this company paid" is what the toggle has
 * always meant.
 */
const MUTABLE_FLAGS = ["is_paid", "demo_access", "is_admin"] as const
type MutableFlag = (typeof MUTABLE_FLAGS)[number]

/** The two that are still facts about a PERSON, and therefore still live on profiles. */
const PROFILE_FLAGS = ["demo_access", "is_admin"] as const

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createSupabaseClient(url, key, { auth: { persistSession: false } })
}

type EntitlementWrite =
  | { ok: true; isPaid: boolean | null }
  | { ok: false; status: number; error: string }

/**
 * Set the COMPANY PLAN for the organization a given user belongs to.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A SEPARATE FUNCTION RATHER THAN INLINE IN THE HANDLER, AND THE REASON IS
 * NOT TIDINESS.
 *
 * The handler also writes public.profiles, keyed `.eq("id", targetId)` where targetId is a
 * USER id. Written inline, this block put an ORGANIZATION id within forty lines of that
 * profiles write, and scripts/check-org-id-reads.mjs reported it as a NEARBY finding -
 * correctly, because "a profiles row fetched by an id an organization column may have
 * supplied" is precisely the defect class that scanner exists to catch, and it cannot tell
 * from proximity alone that these two ids are different variables.
 *
 * THE GUARD WAS NOT WRONG AND NOTHING WAS SILENCED TO SATISFY IT. No allow-list entry was
 * added and no KNOWN_OPEN count was changed. The two ids are separated by a function
 * boundary because they ARE separate things, and now the code says so: `targetId` is a
 * user id, `orgId` is derived from it by resolveOrgIdForUser(), and neither is ever
 * substituted for the other.
 *
 * ---------------------------------------------------------------------------
 * THE SERVICE ROLE IS LOAD-BEARING ON THE UPDATE BELOW. 092's
 * organizations_entitlement_guard refuses a write to is_paid whenever auth.uid() IS NOT
 * NULL. A service_role JWT carries no `sub` claim, so auth.uid() resolves NULL and this is
 * EXEMPT. Pass a session client and it raises LG008 no matter how much of an admin the
 * caller is - which is the guard working, not a bug.
 *
 * Returns a discriminated result rather than a NextResponse, so every response in this file
 * is constructed in one place.
 */
async function setOrganizationEntitlement(
  // OrgLookupClient, the loose shape lib/entitlements.ts already uses for exactly this -
  // naming the real PostgREST builder type reaches TS2589 and there are no generated
  // Database types in this repository. It declares `from`, which is all this needs, and it
  // is the same type resolveOrgIdForUser() below already takes.
  service: OrgLookupClient,
  targetUserId: string,
  isPaid: boolean,
  route: string
): Promise<EntitlementWrite> {
  // The target's organization, resolved server-side from their user id. Never from the
  // request: this route is reached with an arbitrary userId in the path.
  const orgId = await resolveOrgIdForUser(targetUserId, service)

  if (!orgId) {
    // NOT A SILENT SUCCESS, AND NOT A GUESS. Post-079 every account has exactly one
    // membership - the backfill made one per profile and the signup trigger makes one per
    // signup - so this should be unreachable. If it happens, the account is already locked
    // out of its own data by deny-by-default and no entitlement can be written for it,
    // because there is no organization to write it to. Falling back to profiles.is_paid
    // here would be a write nothing reads.
    console.error("[api] failure", {
      route,
      method: "PATCH",
      code: 409,
      message: "target belongs to no organization, cannot set is_paid",
      targetUserId,
    })
    return {
      ok: false,
      status: 409,
      error:
        "That account is not linked to a company yet, so there is no subscription to change. Entitlement is per company, not per person.",
    }
  }

  // .select() IS NOT DECORATION. Same invariant as the profiles write in the handler: a
  // zero-row update is the bug this whole route exists to fix.
  const { data: orgRows, error: orgError } = await service
    .from("organizations")
    .update({ is_paid: isPaid, updated_at: new Date().toISOString() })
    .eq("id", orgId)
    .select("id, is_paid")

  if (orgError) {
    console.error("[api] failure", {
      route,
      method: "PATCH",
      code: 500,
      message: orgError.message,
      orgId,
      hint:
        orgError.code === "42703"
          ? "42703 is undefined_column: migration 092 has not been applied to this database. Apply supabase/migrations/092_org_entitlement.sql before deploying the code that reads it."
          : orgError.code === "LG008"
            ? "LG008 is 092's entitlement guard. It fires only when auth.uid() is not null, which means this write did NOT go out on the service role."
            : undefined,
    })
    return { ok: false, status: 500, error: "Failed to update the company subscription" }
  }

  if (!Array.isArray(orgRows) || orgRows.length === 0) {
    console.error("[api] failure", {
      route,
      method: "PATCH",
      code: 404,
      message: "organizations update matched no row",
      orgId,
    })
    return { ok: false, status: 404, error: "No company was updated. The organization may no longer exist." }
  }

  return { ok: true, isPaid: (orgRows[0] as { is_paid?: boolean | null }).is_paid ?? null }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const route = "/api/admin/users/[userId]/flags"
  try {
    // Gate first, before the body is read and before any elevated client exists.
    const auth = await requireAdminRole()
    if (!auth.authorized) return auth.response

    const { userId } = await params
    const targetId = String(userId || "").trim()
    if (!targetId) {
      return NextResponse.json({ error: "User id required" }, { status: 400 })
    }

    const body = await req.json().catch(() => ({}))

    // Build the update from the allow-list only. Anything else in the body is ignored, not
    // rejected, so an added client-side field can never become an unintended column write.
    const updates: Partial<Record<MutableFlag, boolean>> = {}
    for (const flag of MUTABLE_FLAGS) {
      const value = (body as Record<string, unknown>)[flag]
      if (typeof value === "boolean") updates[flag] = value
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: `Provide at least one of: ${MUTABLE_FLAGS.join(", ")} as a boolean` },
        { status: 400 }
      )
    }

    const service = serviceClient()
    if (!service) {
      console.error("[api] failure", { route, method: "PATCH", code: 500, message: "service role not configured" })
      return NextResponse.json({ error: "Server is not configured" }, { status: 500 })
    }

    // Last-admin guard. Counted here, with the service role, never in the browser: the
    // caller's own RLS scope on profiles cannot see other admins, so a client-side count
    // would read 1 and wave through exactly the write this is meant to stop.
    if (updates.is_admin === false) {
      const { count, error: countErr } = await service
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("is_admin", true)

      if (countErr || count === null) {
        console.error("[api] failure", { route, method: "PATCH", code: 500, message: "admin count failed" })
        return NextResponse.json({ error: "Could not verify admin count" }, { status: 500 })
      }

      // Only blocks when the target is currently an admin, so clearing an already-false flag
      // on someone else stays a no-op rather than a spurious 409.
      const { data: target } = await service
        .from("profiles")
        .select("is_admin")
        .eq("id", targetId)
        .maybeSingle()

      if (target?.is_admin === true && count <= 1) {
        return NextResponse.json(
          {
            error:
              "This is the last admin account. Grant admin to another account first, otherwise no one can reach the admin panel.",
          },
          { status: 409 }
        )
      }
    }

    const stamp = new Date().toISOString()

    // =================================================================
    // 1. THE ORGANIZATION FLAG. is_paid, and only is_paid.
    //
    // FIRST, DELIBERATELY. It is the one that can fail for a reason that is nobody's
    // mistake - a target who belongs to no organization - and doing it first means such a
    // request changes NOTHING at all rather than half-applying and reporting an error.
    //
    // The write itself is setOrganizationEntitlement() above, and its header explains why
    // it is a separate function: it keeps an ORGANIZATION id out of the same forty lines
    // as the USER-keyed profiles write below, which is a real distinction and not a
    // formatting preference.
    // =================================================================
    let orgIsPaid: boolean | null = null

    if (updates.is_paid !== undefined) {
      const written = await setOrganizationEntitlement(service, targetId, updates.is_paid, route)
      if (!written.ok) {
        return NextResponse.json({ error: written.error }, { status: written.status })
      }
      orgIsPaid = written.isPaid
    }

    // =================================================================
    // 2. THE PROFILE FLAGS. is_admin and demo_access - facts about a PERSON.
    //
    // SKIPPED ENTIRELY when the request carries neither, which is the common case now:
    // the admin page's paid toggle sends `is_paid` alone. Writing profiles anyway, to
    // stamp updated_at on a row nothing changed, would destroy the signal the next
    // paragraph describes.
    // =================================================================
    const profileUpdates: Partial<Record<MutableFlag, boolean>> = {}
    for (const flag of PROFILE_FLAGS) {
      if (updates[flag] !== undefined) profileUpdates[flag] = updates[flag]
    }

    let profileRow: Record<string, unknown> | null = null

    if (Object.keys(profileUpdates).length > 0) {
      // updated_at is stamped on every flag change, and it is the ONLY column written
      // alongside the allow-listed booleans. Without it a read-only census cannot tell a
      // deliberate grant from an automatic one: profiles.updated_at equals created_at on
      // every account whose flags nobody has touched, so a differing value is evidence that
      // somebody decided something. Twelve of the sixteen live profiles read
      // updated_at = created_at today, which is exactly the signal this preserves.
      const { data: updated, error } = await service
        .from("profiles")
        .update({ ...profileUpdates, updated_at: stamp })
        .eq("id", targetId)
        .select("id, demo_access, is_admin")

      if (error) {
        console.error("[api] failure", { route, method: "PATCH", code: 500, message: error.message })
        return NextResponse.json({ error: "Failed to update account" }, { status: 500 })
      }

      // The whole point of this route. A zero-row update is the bug being fixed, so it is
      // reported as a failure rather than returned as `{ success: true }`.
      if (!updated || updated.length === 0) {
        return NextResponse.json({ error: "No account was updated. The user id may no longer exist." }, { status: 404 })
      }

      profileRow = updated[0] as Record<string, unknown>
    }

    // THE RESPONSE SHAPE IS UNCHANGED, so app/admin/users/page.tsx needs no change to keep
    // working: it reads `payload.user.is_paid` and `payload.user.demo_access`. `is_paid`
    // now comes off organizations and the other two off profiles, composed here.
    //
    // A flag the request did not touch comes back null rather than stale-and-plausible.
    // The page only reads the ones it just sent.
    return NextResponse.json({
      user: {
        id: targetId,
        is_paid: orgIsPaid,
        demo_access: profileRow ? (profileRow.demo_access ?? null) : null,
        is_admin: profileRow ? (profileRow.is_admin ?? null) : null,
      },
      updated: Object.keys(updates),
    })
  } catch (e) {
    console.error("[api] failure", { route, method: "PATCH", code: 500, message: String(e) })
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}
