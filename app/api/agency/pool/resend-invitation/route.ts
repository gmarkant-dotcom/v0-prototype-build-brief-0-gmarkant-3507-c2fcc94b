import { NextResponse, type NextRequest } from "next/server"
import { buildBrandedEmailHtml, buildBrandedEmailText, sendTransactionalEmail, siteBaseUrl } from "@/lib/email"
import { markPartnershipInvited } from "@/lib/partnership-invitations"
import { requireAgencyRole } from "@/lib/api-auth"

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

    const { data: matchedProfile } = await supabase
      .from("profiles")
      .select("id")
      .ilike("email", vendorEmail)
      .maybeSingle()
    const isClaimed = Boolean(matchedProfile?.id)

    const agencyName =
      profile?.company_name?.trim() || profile?.full_name?.trim() || profile?.display_name?.trim() || "A lead agency"
    const recipientName = vendorName || vendorEmail

    const subject = isClaimed
      ? `${agencyName} wants to connect with you on Ligament`
      : `${agencyName} added you to their partner network on Ligament`
    const ctaUrl = isClaimed
      ? `${siteBaseUrl()}/partner/invitations`
      : `${siteBaseUrl()}/auth/sign-up?email=${encodeURIComponent(vendorEmail)}&source=pool_resend`
    const ctaText = isClaimed ? "View Invitation" : "Create Your Profile"
    const body_ = isClaimed
      ? `${agencyName} wants to connect with you on Ligament based on a bid you submitted.\n\nSign in to view and accept the invitation.`
      : `${agencyName} has added you to their partner network on Ligament based on a bid you submitted.\n\nCreate your profile to be discoverable to other agencies and track all your bids in one place.`

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
      await markPartnershipInvited(supabase, { agencyId: user.id, vendorEmail })
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
