import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { invitationRpcFailure } from "@/lib/org-invitations"

/**
 * POST /api/org/invitations/decline - the invitee refuses.
 *
 * The same shape as accept, deliberately: same session client, same single .rpc(), same
 * error mapping, same absence of a fallback. An invitee who declines must not be able to
 * learn anything an invitee who accepts could not, and the fastest way to guarantee that is
 * for the two routes to differ only in which function they call.
 *
 * DECLINED IS NOT REVOKED. Revoked is the admin withdrawing the offer. Declined is the
 * invitee refusing it. Migration 089 adds 'declined' to the status CHECK as a distinct
 * value for exactly that reason, and the admin's pending list shows which happened.
 *
 * decline_org_invitation() writes NOTHING to org_members and sets neither accepted_by nor
 * accepted_at - a decline is not an acceptance, and borrowing those columns to record who
 * declined would make every future reader of them wrong.
 *
 * NEVER THE SERVICE ROLE. Standing ruling. See the accept route.
 */

export const dynamic = "force-dynamic"

const noStoreHeaders = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate",
} as const

export async function POST(request: NextRequest) {
  const route = "/api/org/invitations/decline"
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
      return NextResponse.json(
        { error: "That invitation could not be found." },
        { status: 404, headers: noStoreHeaders }
      )
    }

    const { data, error } = await supabase.rpc("decline_org_invitation", { p_token: token })

    if (error) {
      const failure = invitationRpcFailure(error)
      console.error("[api] POST /org/invitations/decline refused", {
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

    const result = (data ?? {}) as { org_id?: string; org_name?: string | null }

    return NextResponse.json(
      { orgId: result.org_id ?? null, orgName: result.org_name ?? null },
      { status: 200, headers: noStoreHeaders }
    )
  } catch (error) {
    console.error("[api] POST /org/invitations/decline threw", { route, error })
    return NextResponse.json(
      { error: "Could not decline that invitation. Please retry." },
      { status: 500, headers: noStoreHeaders }
    )
  }
}
