import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { colleagueInvitationsEnabled } from "@/lib/feature-flags"
import { resolveActingOrgId } from "@/lib/acting-org"
import { loadOrgRole } from "@/lib/capabilities"
import { hasLigamentAccount } from "@/lib/server/account-existence"
import { buildColleagueInvitationEmail, sendTransactionalEmail } from "@/lib/email"
import {
  INVITATION_TTL_DAYS,
  ONE_LIVE_PER_EMAIL_INDEX,
  RLS_REFUSED,
  ROLE_LABEL,
  UNIQUE_VIOLATION,
  invitationExpiresAt,
  isInvitableRole,
  mintInvitationToken,
  sameEmail,
} from "@/lib/org-invitations"
import type { OrgId } from "@/lib/entitlements"

/**
 * POST /api/org/invitations - invite a colleague into the caller's own organization.
 *
 * THIS ROUTE DEPENDS ON MIGRATION 089, WHICH IS APPLIED AND VERIFIED, AND IT HAS NO
 * FALLBACK. Without 089's "Org admins create invitations" policy, org_invitations has no
 * INSERT policy at all and the insert below returns 42501, which this route reports as 403
 * with an explicit message. That branch is kept because a policy can be rolled back, and
 * because a loud refusal is the intended failure. Do not add a service-role path to "make
 * it work" - the 082 fallback blocks are this repository's own example of what that costs,
 * and a fallback that fires silently returns a wrong answer instead of an error.
 *
 * WHY THE SESSION CLIENT. The new INSERT policy is
 * `org_id IN (SELECT current_user_admin_org_ids())`, which resolves auth.uid(). A
 * service-role client has no auth context, so that set would be EMPTY and every insert
 * would fail - failing closed, but silently and for the wrong reason.
 *
 * WHERE THE ORGANIZATION COMES FROM. resolveActingOrgId(user.id, supabase), which reads
 * org_members keyed by a user id the caller cannot choose. NO ORGANIZATION ID IS ACCEPTED
 * FROM THE PAYLOAD, ever. Sixteen accounts in this database have organizations.id EQUAL TO
 * profiles.id from the 079 backfill, so a user id passed into an organization column is a
 * valid org id for those sixteen and garbage for everyone else - which is exactly why that
 * whole defect class stayed invisible for so long.
 */

export const dynamic = "force-dynamic"

const noStoreHeaders = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate",
} as const

export async function POST(request: NextRequest) {
  const route = "/api/org/invitations"
  try {
    /**
     * THE FEATURE GATE, AND IT IS FIRST FOR A REASON.
     *
     * GATE CREATION, NEVER GATE RESOLUTION. Creating an invitation is the only operation in
     * this feature that puts something NEW into the world; accept, decline and revoke all
     * resolve something that already exists. A flag that hid the button but left this
     * endpoint live would be worse than no flag at all, and the failure is reachable without
     * anybody doing anything clever:
     *
     *   An invitation created while the flag is off sends an email whose /join/<token> link
     *   returns 404, because /join IS gated. The invitee holds a dead link they cannot
     *   accept and cannot decline. The row stays 'pending', and it then wedges that address
     *   through org_invitations_one_live_per_email - one live pending row per
     *   (org_id, lower(email)) - with nothing in the product able to clear it.
     *
     * That is the exact "never strand something already in flight" failure the flag header
     * in lib/feature-flags.ts argues against, arrived at from the creating side instead of
     * the resolving side.
     *
     * 404, MATCHING /join/[token]. That route calls notFound() when the flag is off, which
     * is an HTTP 404, and this answers with the same status deliberately: the two are one
     * surface and it either exists or it does not. 404 and not 503 - a 503 says "temporarily
     * unavailable, retry", which invites exactly the retry loop this is meant to prevent -
     * and not 403, which would say the caller lacks permission when in fact nobody has it.
     *
     * BEFORE THE AUTH CHECK, deliberately. A caller learns nothing here that /join does not
     * already tell anyone who visits it, and answering identically whether or not there is a
     * session is what makes the endpoint indistinguishable from a path that was never built.
     */
    if (!colleagueInvitationsEnabled()) {
      console.warn("[api] POST /org/invitations refused: COLLEAGUE_INVITATIONS is off", { route })
      return NextResponse.json(
        { error: "Not found" },
        { status: 404, headers: noStoreHeaders }
      )
    }

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStoreHeaders })
    }

    const payload = (await request.json().catch(() => null)) as {
      email?: unknown
      role?: unknown
    } | null

    const rawEmail = typeof payload?.email === "string" ? payload.email.trim() : ""
    if (!rawEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
      return NextResponse.json(
        { error: "Enter a valid email address." },
        { status: 400, headers: noStoreHeaders }
      )
    }

    // Role is validated against the SAME three values org_members.role and
    // org_invitations.role both CHECK. This is not a product ruling being made here - it is
    // the vocabulary the schema already carries, refused early so the caller gets a sentence
    // instead of a 23514.
    const role = payload?.role
    if (!isInvitableRole(role)) {
      return NextResponse.json(
        { error: "Choose a role: owner, admin or member." },
        { status: 400, headers: noStoreHeaders }
      )
    }

    // THE ORGANIZATION, DERIVED. Fails closed on "ambiguous" rather than picking one, which
    // matters more here than almost anywhere: inviting somebody into the wrong company hands
    // a stranger a real person's projects.
    const acting = await resolveActingOrgId(user.id, supabase)
    if (!acting.orgId) {
      const message =
        acting.reason === "ambiguous"
          ? "Your account belongs to more than one organization and none is selected, so we cannot tell which team to invite them to."
          : "Your account is not linked to an organization yet."
      console.error("[api] POST /org/invitations acting org unresolved", {
        route,
        userId: user.id,
        reason: acting.reason,
      })
      return NextResponse.json({ error: message }, { status: 403, headers: noStoreHeaders })
    }
    // Typed explicitly. The OrgId brand is defeated wherever a value arrives as `any` from
    // PostgREST, so the local declaration is what keeps this one honest.
    const orgId: OrgId = acting.orgId

    // THE CALLER'S REAL ROLE, READ FROM org_members - NOT can() / orgRoleFor().
    //
    // lib/capabilities.ts orgRoleFor() returns "owner" for EVERY caller, unconditionally,
    // and says at :236-240 that this stops being true the moment anything can add a second
    // member to an organization. THIS FEATURE IS THAT MOMENT. Gating this route through
    // can(profile, "org.member_invite") would therefore admit every authenticated user,
    // which the database would then refuse with 42501 - safe, but a route that offers an
    // action it knows will fail is a bad surface. loadOrgRole() exists precisely for this
    // and was written unused waiting for it.
    const callerRole = await loadOrgRole(user.id, orgId, supabase)
    if (callerRole !== "owner" && callerRole !== "admin") {
      return NextResponse.json(
        { error: "Only an owner or admin can invite colleagues." },
        { status: 403, headers: noStoreHeaders }
      )
    }

    // Self-invite. Cheap, and the alternative is a pending invitation somebody cannot
    // accept because accept_org_invitation() would find them already a member.
    if (sameEmail(rawEmail, user.email)) {
      return NextResponse.json(
        { error: "That is your own address - you are already on this team." },
        { status: 409, headers: noStoreHeaders }
      )
    }

    // ALREADY A MEMBER? Answered by migration 087's org_has_member_with_email(uuid, text).
    //
    // The caller could work this out from their own roster - they can read org_members for
    // their organization and the profiles rows behind it - so this discloses nothing they
    // did not already have, and it is one round trip instead of two. It is used as an
    // AUTHORITY predicate about the caller's OWN organization, which is what 087's header
    // permits; it is not being used to look anything up.
    //
    // A failure here is NOT fatal. It only chooses between a friendly refusal and letting
    // the insert proceed, and the insert is what actually protects anything.
    const { data: alreadyMember, error: memberProbeErr } = await supabase.rpc("org_has_member_with_email", {
      p_org_id: orgId,
      p_email: rawEmail,
    })
    if (memberProbeErr) {
      console.warn("[api] POST /org/invitations membership probe failed, continuing", {
        route,
        code: memberProbeErr.code,
        message: memberProbeErr.message,
      })
    } else if (alreadyMember === true) {
      return NextResponse.json(
        { error: "That person is already on your team." },
        { status: 409, headers: noStoreHeaders }
      )
    }

    // ------------------------------------------------------------------
    // THE DURABLE HALF OF THE EXPIRY SETTER, AND THE ONLY HALF THAT WORKS.
    //
    // accept_org_invitation() and decline_org_invitation() both stamp a lapsed row
    // 'expired' and then RAISE - and the RAISE rolls the stamp back, because PostgREST
    // wraps each RPC call in one transaction. Migration 089's header says so at length.
    // THIS is where an invitation actually becomes 'expired' on disk.
    //
    // It is also the only place the stale row is ever FELT. A lapsed pending invitation
    // costs nobody anything until somebody tries to re-invite that address, at which point
    // org_invitations_one_live_per_email - UNIQUE (org_id, lower(email)) WHERE status =
    // 'pending' - refuses the new row with 23505. Sweeping first is what frees the slot.
    //
    // Scoped to this organization and this address only. A sweep across the whole table
    // would be a write nobody asked for on rows this request has no business touching, and
    // the UPDATE policy would refuse the ones outside the caller's organizations anyway.
    // ------------------------------------------------------------------
    const nowIso = new Date().toISOString()
    const { error: sweepErr } = await supabase
      .from("org_invitations")
      .update({ status: "expired", updated_at: nowIso })
      .eq("org_id", orgId)
      .eq("status", "pending")
      .ilike("email", rawEmail)
      .lte("expires_at", nowIso)

    if (sweepErr) {
      // Not fatal on its own. If a lapsed row really was in the way, the insert below
      // raises 23505 and the caller is told to try again, which is a worse experience than
      // this working but is not a wrong answer.
      console.error("[api] POST /org/invitations expiry sweep failed", {
        route,
        orgId,
        code: sweepErr.code,
        message: sweepErr.message,
      })
    }

    const token = mintInvitationToken()
    const expiresAt = invitationExpiresAt()

    const { data: inserted, error: insertErr } = await supabase
      .from("org_invitations")
      .insert({
        org_id: orgId,
        email: rawEmail,
        role,
        token,
        status: "pending",
        expires_at: expiresAt,
        invited_by: user.id,
      })
      .select("id, org_id, email, role, status, expires_at, created_at")
      .single()

    if (insertErr) {
      // The partial unique index. There is already a LIVE pending invitation for this
      // address in this organization, and the sweep above did not clear it because it has
      // not lapsed yet. This is the friendly case, not a fault.
      if (
        insertErr.code === UNIQUE_VIOLATION ||
        (insertErr.message || "").includes(ONE_LIVE_PER_EMAIL_INDEX)
      ) {
        return NextResponse.json(
          {
            error: "There is already a pending invitation for that address. Revoke it first if you want to send a new one.",
          },
          { status: 409, headers: noStoreHeaders }
        )
      }

      // 42501 with no INSERT policy on the table means migration 089 has not been applied.
      // Said plainly rather than dressed up as a permission problem, because the two have
      // completely different fixes.
      if (insertErr.code === RLS_REFUSED) {
        console.error("[api] POST /org/invitations refused by RLS", {
          route,
          orgId,
          userId: user.id,
          callerRole,
          message: insertErr.message,
        })
        return NextResponse.json(
          { error: "Invitations are not available yet." },
          { status: 403, headers: noStoreHeaders }
        )
      }

      console.error("[api] POST /org/invitations insert failed", {
        route,
        orgId,
        code: insertErr.code,
        message: insertErr.message,
      })
      return NextResponse.json(
        { error: "Could not send that invitation. Please retry." },
        { status: 500, headers: noStoreHeaders }
      )
    }

    // ------------------------------------------------------------------
    // The email. Wrapped so a Resend outage cannot undo an invitation that
    // already exists in the database - the house rule for every send in this
    // codebase. The response reports whether it went, so the interface can
    // offer the link rather than claim something it did not do.
    // ------------------------------------------------------------------
    let emailSent = false
    try {
      const [{ data: org }, { data: inviterProfile }] = await Promise.all([
        supabase.from("organizations").select("name").eq("id", orgId).maybeSingle(),
        supabase.from("profiles").select("display_name, full_name").eq("id", user.id).maybeSingle(),
      ])

      const orgName = (org as { name?: string | null } | null)?.name?.trim() || "your team"
      const inviterName =
        (inviterProfile as { display_name?: string | null; full_name?: string | null } | null)
          ?.display_name?.trim() ||
        (inviterProfile as { full_name?: string | null } | null)?.full_name?.trim() ||
        null

      const hasAccount = await hasLigamentAccount(rawEmail)
      const mail = buildColleagueInvitationEmail({
        orgName,
        inviterName,
        inviteeEmail: rawEmail,
        roleLabel: ROLE_LABEL[role],
        token,
        hasAccount,
        expiresInDays: INVITATION_TTL_DAYS,
      })
      emailSent = await sendTransactionalEmail({
        to: rawEmail,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
      })
    } catch (mailError) {
      console.error("[api] POST /org/invitations email failed", { route, error: mailError })
    }

    // The token is NOT returned. It is a bearer credential and the interface has no use for
    // it - the same rule app/api/agency/rfp/magic-link/route.ts:439 states for its own.
    return NextResponse.json(
      { invitation: inserted, email_sent: emailSent },
      { status: 201, headers: noStoreHeaders }
    )
  } catch (error) {
    console.error("[api] POST /org/invitations threw", { route, error })
    return NextResponse.json(
      { error: "Could not send that invitation. Please retry." },
      { status: 500, headers: noStoreHeaders }
    )
  }
}
