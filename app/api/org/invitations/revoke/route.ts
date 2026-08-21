import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { resolveActingOrgId } from "@/lib/acting-org"
import { loadOrgRole } from "@/lib/capabilities"
import { RLS_REFUSED } from "@/lib/org-invitations"
import type { OrgId } from "@/lib/entitlements"

/**
 * POST /api/org/invitations/revoke - withdraw a pending invitation.
 *
 * REVOKED IS NOT DECLINED. Revoked is the admin withdrawing an offer; declined is the
 * invitee refusing it. Migration 089 adds 'declined' as a separate status precisely so the
 * pending list does not lie about which of those happened, and nothing here may collapse
 * them.
 *
 * IT SELECTS THE ROW BEFORE UPDATING IT, and that is not a wasted round trip.
 * An RLS update that matches no row returns HTTP 200 with no error and zero rows changed.
 * This project has lost real behaviour to exactly that more than once - 087's own
 * COMMENT ON says "five times". Reading first is how "you may not do that" and "there was
 * nothing to do" stop looking identical from the outside.
 *
 * DEPENDS ON MIGRATION 089. Before it is applied there is no UPDATE policy on
 * org_invitations, so the update matches nothing and this route answers 403.
 */

export const dynamic = "force-dynamic"

const noStoreHeaders = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate",
} as const

export async function POST(request: NextRequest) {
  const route = "/api/org/invitations/revoke"
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStoreHeaders })
    }

    const payload = (await request.json().catch(() => null)) as { invitationId?: unknown } | null
    const invitationId = typeof payload?.invitationId === "string" ? payload.invitationId.trim() : ""
    if (!invitationId) {
      return NextResponse.json(
        { error: "Which invitation?" },
        { status: 400, headers: noStoreHeaders }
      )
    }

    // Derived, never taken from the payload. See the create route's header for why.
    const acting = await resolveActingOrgId(user.id, supabase)
    if (!acting.orgId) {
      console.error("[api] POST /org/invitations/revoke acting org unresolved", {
        route,
        userId: user.id,
        reason: acting.reason,
      })
      return NextResponse.json(
        { error: "We could not tell which team this invitation belongs to." },
        { status: 403, headers: noStoreHeaders }
      )
    }
    const orgId: OrgId = acting.orgId

    // The caller's REAL role, from org_members. Not can() - orgRoleFor() returns "owner"
    // for everybody. See the create route.
    //
    // OWNER OR ADMIN, matching who may create one. The capability map says
    // org.member_revoke: 'owner', but that entry is about REMOVING A MEMBER - taking a
    // colleague's access away - not about withdrawing an invitation that has not been
    // accepted. An admin who could send it can withdraw it; anything else means an admin
    // can create a pending invitation nobody but the owner can undo. Flagged in the session
    // report as a product question rather than treated as settled.
    const callerRole = await loadOrgRole(user.id, orgId, supabase)
    if (callerRole !== "owner" && callerRole !== "admin") {
      return NextResponse.json(
        { error: "Only an owner or admin can revoke an invitation." },
        { status: 403, headers: noStoreHeaders }
      )
    }

    // Read first. See the header.
    const { data: existing, error: readErr } = await supabase
      .from("org_invitations")
      .select("id, org_id, email, status")
      .eq("id", invitationId)
      .maybeSingle()

    if (readErr) {
      console.error("[api] POST /org/invitations/revoke read failed", {
        route,
        code: readErr.code,
        message: readErr.message,
      })
      return NextResponse.json(
        { error: "Could not revoke that invitation. Please retry." },
        { status: 500, headers: noStoreHeaders }
      )
    }
    if (!existing) {
      // Either it does not exist or the admin SELECT policy filtered it out. Both are 404
      // to this caller, and deliberately indistinguishable - a 403 here would confirm that
      // an invitation with that id exists somewhere.
      return NextResponse.json(
        { error: "That invitation could not be found." },
        { status: 404, headers: noStoreHeaders }
      )
    }
    if ((existing as { org_id?: string | null }).org_id !== orgId) {
      return NextResponse.json(
        { error: "That invitation could not be found." },
        { status: 404, headers: noStoreHeaders }
      )
    }
    if ((existing as { status?: string | null }).status !== "pending") {
      return NextResponse.json(
        { error: "That invitation is no longer open." },
        { status: 409, headers: noStoreHeaders }
      )
    }

    const { data: updated, error: updateErr } = await supabase
      .from("org_invitations")
      .update({ status: "revoked", updated_at: new Date().toISOString() })
      .eq("id", invitationId)
      .eq("org_id", orgId)
      .eq("status", "pending")
      .select("id, status")
      .maybeSingle()

    if (updateErr) {
      if (updateErr.code === RLS_REFUSED) {
        console.error("[api] POST /org/invitations/revoke refused by RLS", {
          route,
          orgId,
          callerRole,
          message: updateErr.message,
        })
        return NextResponse.json(
          { error: "Invitations are not available yet." },
          { status: 403, headers: noStoreHeaders }
        )
      }
      console.error("[api] POST /org/invitations/revoke update failed", {
        route,
        code: updateErr.code,
        message: updateErr.message,
      })
      return NextResponse.json(
        { error: "Could not revoke that invitation. Please retry." },
        { status: 500, headers: noStoreHeaders }
      )
    }

    // NO ROW CHANGED, NO ERROR RAISED. This is the shape the header warns about, and before
    // migration 089 it is the shape this route takes every time: the UPDATE policy does not
    // exist, so the row is invisible to the write and PostgREST reports success on nothing.
    if (!updated) {
      console.error("[api] POST /org/invitations/revoke matched no row", {
        route,
        orgId,
        invitationId,
        note: "the read above found it, so this is an UPDATE policy gap - check migration 089",
      })
      return NextResponse.json(
        { error: "Invitations are not available yet." },
        { status: 403, headers: noStoreHeaders }
      )
    }

    return NextResponse.json({ invitation: updated }, { status: 200, headers: noStoreHeaders })
  } catch (error) {
    console.error("[api] POST /org/invitations/revoke threw", { route, error })
    return NextResponse.json(
      { error: "Could not revoke that invitation. Please retry." },
      { status: 500, headers: noStoreHeaders }
    )
  }
}
