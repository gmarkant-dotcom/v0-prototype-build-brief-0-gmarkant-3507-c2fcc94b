import { NextResponse } from "next/server"
import { createClient as createSupabaseClient } from "@supabase/supabase-js"
import { requireAdminRole } from "@/lib/api-auth"

export const dynamic = "force-dynamic"

/**
 * The admin panel's "grant lead agency access" toggle. Writes profiles.secondary_role on
 * ANOTHER user's row.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS ROUTE USED TO DO, AND WHY IT REPORTED SUCCESS WHILE WRITING NOTHING.
 *
 * It issued the update through `auth.supabase` - the ADMIN'S OWN SESSION CLIENT - as
 * `.update({ secondary_role }).eq("id", userId)`, and carried a comment saying that was
 * deliberate, so that the write would be "governed by the same profiles policies as the
 * admin panel's other toggles".
 *
 * THOSE POLICIES DO NOT GRANT WHAT THAT COMMENT ASSUMED. `profiles` carries exactly one
 * UPDATE policy - "Users can update own profile", qual `(auth.uid() = id)` - and no admin
 * policy of any kind. `userId` here is somebody OTHER than the admin. So the row was
 * filtered out by RLS, the statement matched ZERO ROWS, and PostgREST reports a zero-row
 * UPDATE as success with no error. The route then returned `{ success: true }` having
 * written nothing at all, and the admin panel showed the grant as applied.
 *
 * An admin granting lead agency access believed it worked. It did not.
 *
 * ---------------------------------------------------------------------------
 * THE FIX IS THE ONE app/api/admin/users/[userId]/flags/route.ts ALREADY MADE.
 *
 * That route's header describes this exact failure as the reason its flags moved to the
 * service role. This one was not moved with them. It is now, and it follows that file
 * clause for clause on purpose - two admin routes writing another user's profile row
 * should not have two different shapes.
 *
 * THE FIX IS DELIBERATELY NOT A NEW "admins can update all profiles" RLS POLICY. That
 * would let any browser session holding an admin's cookie write any column of any profile
 * on the platform, through PostgREST, with no server-side gate in front of it. The gate
 * runs here instead, and the elevated client is constructed only AFTER requireAdminRole()
 * has passed.
 *
 * TWO INVARIANTS, both taken from the flags route:
 *   1. AN UPDATE THAT CHANGES NO ROWS IS AN ERROR, NEVER A SUCCESS. The original defect
 *      was a failed write reporting success, so silence is treated as failure here by
 *      construction - `.select()` is not decoration, it is the check.
 *   2. The column written is a fixed literal, never a value off the request body. The body
 *      supplies `userId` and a boolean, and nothing else reaches the update.
 *
 * ---------------------------------------------------------------------------
 * MIGRATION 091 DOES NOT GATE THIS ROUTE, AND IT WOULD NOT HAVE EVEN BEFORE THIS CHANGE.
 *
 * `secondary_role` IS NOT IN 091's AUTHORITY SET. The set is is_paid, is_admin,
 * demo_access, email and linked_agency_id, and secondary_role was considered and
 * deliberately LEFT OUT - see docs/091-guard-shape.md section 2. The reason is that
 * /api/profile/switch-role SELF-GRANTS `secondary_role = 'partner'` from a session client
 * as a free, self-serve act, on the same column this route uses for an admin grant of
 * 'agency'. A trigger cannot separate those two without encoding product policy in the
 * database.
 *
 * So this route leaves 091's guard on its early return, and needs no permit, no exemption
 * and no change to the migration. It would have done so under the session client too. The
 * service role changes only WHETHER THE WRITE LANDS, not whether the guard allows it.
 *
 * That split is still an open question rather than a settled one - one column carrying two
 * different authorities - and it is recorded as OPEN-091-2 in docs/091-session-report.md.
 * If it is ever resolved by giving the agency grant its own column, THAT COLUMN IS A
 * PRIVILEGE COLUMN AND MUST JOIN 091'S AUTHORITY SET IN THE MIGRATION THAT CREATES IT.
 */

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createSupabaseClient(url, key, { auth: { persistSession: false } })
}

export async function POST(req: Request) {
  const route = "/api/admin/grant-agency-access"
  try {
    // Admin gate before the body is read, and before any elevated client exists.
    const auth = await requireAdminRole()
    if (!auth.authorized) return auth.response

    const body = await req.json().catch(() => ({}))
    const { userId, grant } = body

    if (!userId || typeof grant !== "boolean") {
      return NextResponse.json({ error: "userId and grant required" }, { status: 400 })
    }

    const service = serviceClient()
    if (!service) {
      console.error("[api] failure", { route, method: "POST", code: 500, message: "service role not configured" })
      return NextResponse.json({ error: "Server is not configured to perform this change." }, { status: 500 })
    }

    const nextSecondaryRole = grant ? "agency" : null

    // updated_at is stamped alongside, for the same reason the flags route stamps it: on an
    // account nobody has touched, profiles.updated_at equals created_at, so a differing
    // value is the only evidence a read-only census has that somebody decided something.
    const { data: updated, error } = await service
      .from("profiles")
      .update({ secondary_role: nextSecondaryRole, updated_at: new Date().toISOString() })
      .eq("id", userId)
      .select("id, secondary_role")

    if (error) {
      // Log the driver message, do not return it - it can echo column names and constraint
      // details back to the caller.
      console.error("[api] failure", { route, method: "POST", code: 500, message: error.message })
      return NextResponse.json({ error: "Failed to update access" }, { status: 500 })
    }

    // THE WHOLE POINT OF THIS CHANGE. A zero-row update is the defect being fixed, so it is
    // reported as a failure rather than returned as `{ success: true }`.
    if (!updated || updated.length === 0) {
      console.error("[api] failure", { route, method: "POST", code: 404, message: "update matched no row", userId })
      return NextResponse.json(
        { error: "No account was updated. The user id may no longer exist." },
        { status: 404 }
      )
    }

    return NextResponse.json({ success: true, secondary_role: updated[0].secondary_role })
  } catch (e) {
    console.error("[api] failure", { route, method: "POST", code: 500, message: String(e) })
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}
