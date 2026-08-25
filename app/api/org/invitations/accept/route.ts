import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { invitationRpcFailure } from "@/lib/org-invitations"
import { resolveActingOrgId } from "@/lib/acting-org"

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
    // WHICH ORGANIZATION IS THIS PERSON ACTING FOR, NOW THAT THEY HAVE JOINED?
    //
    // Asked through resolveActingOrgId() rather than by counting org_members here, because
    // the count on its own cannot answer the question the confirmation screen needs to ask.
    // Belonging to two organizations is NOT the thing that refuses a write - migration 090
    // added profiles.active_org_id and accept_org_invitation() initializes it to the
    // inviting organization WHEN IT IS NULL, so the ordinary accept resolves cleanly to
    // "stored-preference" and the accepter can write immediately.
    //
    // The state that DOES refuse is narrower: more than one membership AND no usable
    // preference ("ambiguous"), or a preference naming an organization they are not a
    // member of ("preference-refused"). Only that deserves a warning, and only the resolver
    // can tell the two apart. Counting memberships here and warning on count > 1 is what
    // this route used to do, and it made the confirmation banner false for every accept.
    //
    // ONE SOURCE FOR THE ANSWER. resolveActingOrgId() is the module every acting-org write
    // path already consults; asking it here means the screen reports what the product will
    // actually do rather than a second guess at it.
    //
    // A failure to resolve is not a failure to accept. The membership is already committed,
    // which is why nothing below this line can return an error.
    // ------------------------------------------------------------------
    const acting = await resolveActingOrgId(user.id, supabase)
    const membershipCount = acting.memberOrgIds.length
    if (membershipCount > 1 && !acting.orgId) {
      console.warn("[api] POST /org/invitations/accept left the accepter unable to write", {
        route,
        userId: user.id,
        membershipCount,
        reason: acting.reason,
      })
    }

    return NextResponse.json(
      {
        orgId: result.org_id ?? null,
        orgName: result.org_name ?? null,
        role: result.role ?? null,
        alreadyMember: result.already_member === true,
        membershipCount,
        // Null means the caller may not write - see ActingOrgReason. Non-null and equal to
        // orgId means they are acting for the organization they just joined.
        actingOrgId: acting.orgId,
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
