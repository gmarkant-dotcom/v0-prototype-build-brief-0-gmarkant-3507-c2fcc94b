import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { invitationRpcFailure } from "@/lib/org-invitations"

/**
 * POST /api/org/invitations/accept - the invitee joins the organization.
 *
 * ONE .rpc() CALL AND NOTHING ELSE. Accept is two writes into two tables - the org_members
 * row and the invitation's status - and they must both land or neither must. Two PostgREST
 * calls are two HTTP requests with no transaction between them: a failure in the gap either
 * leaves a half-joined user or wedges that address in org_invitations_one_live_per_email
 * permanently, because the partial index admits exactly one pending row per (org, address)
 * and nothing would ever clear it. accept_org_invitation() is one transaction.
 *
 * THE SESSION CLIENT, AND NEVER THE SERVICE ROLE. This is a standing ruling, not a
 * preference. The function derives the acting user from auth.uid(); a service-role client
 * has no auth context, so auth.uid() would be NULL and the function would refuse with
 * LG002 - which fails closed, but for a reason that has nothing to do with the actual
 * request and would send whoever debugged it in the wrong direction entirely.
 *
 * NO FALLBACK IF THE FUNCTION IS MISSING. Before migration 089 is applied, PostgREST
 * answers PGRST202 and this route returns 503 saying invitations are not available yet.
 * That is correct. The 082 fallback blocks are the cautionary tale: a fallback that fires
 * silently returns a wrong answer instead of an error.
 */

export const dynamic = "force-dynamic"

const noStoreHeaders = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate",
} as const

export async function POST(request: NextRequest) {
  const route = "/api/org/invitations/accept"
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json(
        { error: "Please sign in to respond to this invitation." },
        { status: 401, headers: noStoreHeaders }
      )
    }

    const payload = (await request.json().catch(() => null)) as { token?: unknown } | null
    const token = typeof payload?.token === "string" ? payload.token.trim() : ""
    if (!token) {
      // Deliberately the SAME message and status a bad token gets. A route that answered
      // 400 "missing token" and 404 "no such token" differently would still not leak
      // anything, but keeping one refusal for the whole class is what stops the next
      // person adding a distinguishable one by accident.
      return NextResponse.json(
        { error: "That invitation could not be found." },
        { status: 404, headers: noStoreHeaders }
      )
    }

    const { data, error } = await supabase.rpc("accept_org_invitation", { p_token: token })

    if (error) {
      const failure = invitationRpcFailure(error)
      // The SQLSTATE goes to the server log and never to the browser. LG001 is deliberately
      // merged - "no such token" and "not your token" are one refusal - and echoing the raw
      // code back would hand a caller the distinction the merge exists to remove.
      console.error("[api] POST /org/invitations/accept refused", {
        route,
        userId: user.id,
        code: failure.code,
        status: failure.status,
        message: error.message,
      })
      return NextResponse.json(
        { error: failure.message },
        { status: failure.status, headers: noStoreHeaders }
      )
    }

    // accept_org_invitation() returns jsonb: invitation_id, org_id, org_name, role,
    // already_member. PostgREST hands it back as a parsed object.
    const result = (data ?? {}) as {
      invitation_id?: string
      org_id?: string
      org_name?: string | null
      role?: string
      already_member?: boolean
    }

    // ------------------------------------------------------------------
    // HOW MANY ORGANIZATIONS DOES THIS PERSON NOW BELONG TO?
    //
    // Asked because the answer changes what they can do, and because nothing else in the
    // product asks it yet. Every account in this database has belonged to exactly one
    // organization for its whole life. Accepting an invitation is the first thing that can
    // make that two - and resolveActingOrgId() FAILS CLOSED on more than one membership
    // with reason "ambiguous", because the tie-breaker it would need,
    // profiles.active_org_id, DOES NOT EXIST as a column (lib/acting-org.ts:169).
    //
    // So a colleague who accepts can be left unable to write anywhere until an
    // acting-organization switcher ships. That is a real consequence of this feature and it
    // is surfaced to the caller here rather than discovered by a confused user - see the
    // session report, where it is the first open item.
    //
    // A failure to count is not a failure to accept. The membership is already committed.
    // ------------------------------------------------------------------
    let membershipCount: number | null = null
    const { data: memberships, error: countErr } = await supabase
      .from("org_members")
      .select("org_id")
      .eq("user_id", user.id)
    if (countErr) {
      console.error("[api] POST /org/invitations/accept membership count failed", {
        route,
        code: countErr.code,
        message: countErr.message,
      })
    } else {
      membershipCount = (memberships ?? []).length
      if (membershipCount > 1) {
        console.warn("[api] POST /org/invitations/accept produced a multi-org account", {
          route,
          userId: user.id,
          membershipCount,
          note: "resolveActingOrgId() now returns ambiguous for this user - profiles.active_org_id does not exist",
        })
      }
    }

    return NextResponse.json(
      {
        orgId: result.org_id ?? null,
        orgName: result.org_name ?? null,
        role: result.role ?? null,
        alreadyMember: result.already_member === true,
        membershipCount,
      },
      { status: 200, headers: noStoreHeaders }
    )
  } catch (error) {
    console.error("[api] POST /org/invitations/accept threw", { route, error })
    return NextResponse.json(
      { error: "Could not accept that invitation. Please retry." },
      { status: 500, headers: noStoreHeaders }
    )
  }
}
