import { NextResponse } from "next/server"
import { createClient as createSupabaseClient } from "@supabase/supabase-js"
import { requireAdminRole } from "@/lib/api-auth"

export const dynamic = "force-dynamic"

/**
 * The admin panel's account flag toggles.
 *
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

/** Allow-list. The request body is never spread into the update. */
const MUTABLE_FLAGS = ["is_paid", "demo_access", "is_admin"] as const
type MutableFlag = (typeof MUTABLE_FLAGS)[number]

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createSupabaseClient(url, key, { auth: { persistSession: false } })
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

    const { data: updated, error } = await service
      .from("profiles")
      .update(updates)
      .eq("id", targetId)
      .select("id, is_paid, demo_access, is_admin")

    if (error) {
      console.error("[api] failure", { route, method: "PATCH", code: 500, message: error.message })
      return NextResponse.json({ error: "Failed to update account" }, { status: 500 })
    }

    // The whole point of this route. A zero-row update is the bug being fixed, so it is
    // reported as a failure rather than returned as `{ success: true }`.
    if (!updated || updated.length === 0) {
      return NextResponse.json({ error: "No account was updated. The user id may no longer exist." }, { status: 404 })
    }

    return NextResponse.json({ user: updated[0], updated: Object.keys(updates) })
  } catch (e) {
    console.error("[api] failure", { route, method: "PATCH", code: 500, message: String(e) })
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}
