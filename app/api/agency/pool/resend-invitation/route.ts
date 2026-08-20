import { NextResponse, type NextRequest } from "next/server"
import { buildBrandedEmailHtml, buildBrandedEmailText, sendTransactionalEmail, siteBaseUrl } from "@/lib/email"
import { hasLigamentAccount } from "@/lib/server/account-existence"
import { markPartnershipInvited } from "@/lib/partnership-invitations"
import { requireAgencyRole } from "@/lib/api-auth"
import { resolveCallerWriteOrgId } from "@/lib/entitlements"
import { recordMilestone } from "@/lib/milestone-events"

export const dynamic = "force-dynamic"

/**
 * Sends a "claim your profile" nudge to a Discovered or Invited pool row on /agency/pool -
 * shared by the Discovered section's "Send Invitation" button (first touch) and the Invited
 * section's "Resend Invitation" button (repeat). Deliberately does not touch
 * rfp_magic_tokens or reuse /api/agency/rfp/magic-link - that route resets an existing
 * token's status/submitted_at/response_id on upsert, which would wipe out the vendor's
 * already-submitted bid tracking. This is a standalone email only. On success, stamps (or
 * creates) the partnerships row's invitation_sent_at - that's what moves a Discovered row
 * into the Invited section on next load.
 *
 * The email content branches on whether vendorEmail already matches a claimed Ligament
 * profile - the same exact-match lookup the import consent guard uses elsewhere
 * (lib/server/partner-import-guard.ts), but this route only needs the boolean, not the
 * guard's self/domain flags. A match sends "connect" copy pointing at /partner/invitations
 * (sign in, then accept) - the same CTA shape /api/partnerships POST already sends a known
 * partner, and the auto-claim in GET /api/partnerships (by partner_email, on their next
 * page load) links this ghost row to their account before they ever see the invitation.
 * No match keeps the original sign-up-flavored copy unchanged.
 */
export async function POST(request: NextRequest) {
  const route = "/api/agency/pool/resend-invitation"
  try {
    const auth = await requireAgencyRole()
    if (!auth.authorized) return auth.response
    const { user, supabase } = auth

    const { data: profile } = await supabase
      .from("profiles")
      .select("company_name, full_name, display_name")
      .eq("id", user.id)
      .maybeSingle()

    const body = await request.json().catch(() => ({}))
    const vendorEmail = String(body.vendorEmail || "").trim().toLowerCase()
    const vendorName = String(body.vendorName || "").trim() || null
    if (!vendorEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(vendorEmail)) {
      return NextResponse.json({ error: "A valid vendor email is required" }, { status: 400 })
    }

    // Service role, not the session client: an agency cannot SELECT the profile of a vendor
    // they have no partnership with and who is not discoverable, so the old session-scoped
    // lookup returned null for exactly the vendors this branch exists to detect.
    const isClaimed = await hasLigamentAccount(vendorEmail)

    const agencyName =
      profile?.company_name?.trim() || profile?.full_name?.trim() || profile?.display_name?.trim() || "A lead agency"
    const recipientName = vendorName || vendorEmail

    const subject = isClaimed
      ? `${agencyName} wants to connect with you on Ligament`
      : `${agencyName} added you to their vendor network on Ligament`
    const ctaUrl = isClaimed
      ? `${siteBaseUrl()}/partner/invitations`
      : `${siteBaseUrl()}/auth/sign-up?email=${encodeURIComponent(vendorEmail)}&source=pool_resend`
    const ctaText = isClaimed ? "View Invitation" : "Create Your Profile"
    const body_ = isClaimed
      ? `${agencyName} wants to connect with you on Ligament based on a bid you submitted.\n\nSign in to view and accept the invitation.`
      : `${agencyName} has added you to their vendor network on Ligament based on a bid you submitted.\n\nCreate your profile to be discoverable to other agencies and track all your bids in one place.`

    const sent = await sendTransactionalEmail({
      to: vendorEmail,
      subject,
      html: buildBrandedEmailHtml({ title: subject, recipientName, body: body_, ctaText, ctaUrl }),
      text: buildBrandedEmailText({ title: subject, recipientName, body: body_, ctaText, ctaUrl }),
    })

    if (!sent) {
      console.error("[api] failure", { route, method: "POST", code: 500, message: "sendTransactionalEmail returned false" })
      return NextResponse.json({ error: "Failed to send invitation email" }, { status: 500 })
    }

    try {
      // 079 PARAMETER CLASS: `agencyId` is written into partnerships.lead_org_id, which
      // REFERENCES organizations(id). `user.id` is a user id. Resolved to the caller's own
      // organization; null skips the stamp rather than writing a value that does not name a
      // row in organizations. The email has already sent either way, which is why this
      // failure is logged and swallowed exactly as the surrounding catch already does.
      const writeOrgId = await resolveCallerWriteOrgId(user.id, supabase)
      if (!writeOrgId) {
        console.error("[api] cannot mark partnership invited: caller belongs to no organization", {
          route,
          userId: user.id,
          vendorEmail,
        })
      } else {
        const ref = await markPartnershipInvited(supabase, { agencyId: writeOrgId, vendorEmail })

        // Milestone: vendor.invite_resend. THE site named for this event type by the comment
        // at app/api/partnerships/route.ts:618-622, which distinguishes it from vendor.invite:
        // that one covers a first touch and the revival of a TERMINATED partnership, this one
        // covers the repeat nudge to a row that is already Discovered or Invited.
        //
        // Emitted after the mail, and only past the `if (!sent)` 500 above - so a breadcrumb
        // never claims a resend that Resend refused. recordMilestone catches everything and
        // returns void, so it cannot change this route's result; it also sits inside the
        // partnership try/catch that was already here and already swallows.
        //
        // EVERY FIELD BELOW IS ABOUT THE ONE RECIPIENT THIS ROW IS FOR. vendor.invite_resend
        // is on public.vendor_visible_event_types() and migration 080's counterparty policy
        // grants the WHOLE row, payload included, to the vendor org behind partnership_id.
        // Both payload fields are facts about this vendor and nobody else: their own address,
        // and whether their own address already has a Ligament account - which is exactly
        // what the email they just received told them by which CTA it carried.
        //
        // 079 PARAMETER CLASS: milestone_events.org_id REFERENCES organizations(id). writeOrgId
        // is the caller's own resolved organization - the same value markPartnershipInvited
        // just wrote to partnerships.lead_org_id - so it clears the key and the SELECT policy's
        // `org_id IN (SELECT public.current_user_org_ids())` alike. user.id is the ACTOR.
        await recordMilestone(supabase, {
          eventType: "vendor.invite_resend",
          orgId: writeOrgId,
          actorId: user.id,
          // Read off the partnerships row, never guessed: this route is handed an email and
          // no vendor id at all, and the row it stamped is usually a ghost whose
          // vendor_org_id is genuinely null. Null is the honest value and the feed degrades
          // to "resent the invitation to a vendor" rather than naming the wrong company.
          vendorOrgId: ref.vendorOrgId,
          // The whole reachability of this row for the vendor. Null when the read-back was
          // denied, which leaves the event agency-only rather than dropping it.
          partnershipId: ref.partnershipId,
          // Same subject as vendor.invite at app/api/partnerships/route.ts:754 - the
          // partnership row - so the two invitation events sit on one subject and the pool
          // href resolves. vendor.invite_resend is NOT in UNION_REPLACING_EVENT_TYPES, so it
          // can never dedupe a derived line away; it is additive to the feed.
          subjectType: "partnership",
          subjectId: ref.partnershipId,
          payload: {
            partner_email: vendorEmail,
            invitee_has_account: isClaimed,
          },
        })
      }
    } catch (partnershipErr) {
      console.error("[api] failed to mark partnership invited", {
        route,
        method: "POST",
        vendorEmail,
        message: partnershipErr instanceof Error ? partnershipErr.message : String(partnershipErr),
      })
    }

    console.log("[api] success", { route, method: "POST", userId: user.id, vendorEmail })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[api] failure", {
      route,
      method: "POST",
      code: 500,
      message: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: "Failed to resend invitation" }, { status: 500 })
  }
}
