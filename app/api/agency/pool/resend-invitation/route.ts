import { NextResponse, type NextRequest } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildBrandedEmailHtml, buildBrandedEmailText, sendTransactionalEmail, siteBaseUrl } from "@/lib/email"
import { markPartnershipInvited } from "@/lib/partnership-invitations"

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
 */
export async function POST(request: NextRequest) {
  const route = "/api/agency/pool/resend-invitation"
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, active_role, company_name, full_name, display_name")
      .eq("id", user.id)
      .maybeSingle()
    if (profile?.role !== "agency" && profile?.active_role !== "agency") {
      return NextResponse.json({ error: "Agency only" }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    const vendorEmail = String(body.vendorEmail || "").trim().toLowerCase()
    const vendorName = String(body.vendorName || "").trim() || null
    if (!vendorEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(vendorEmail)) {
      return NextResponse.json({ error: "A valid vendor email is required" }, { status: 400 })
    }

    const agencyName =
      profile?.company_name?.trim() || profile?.full_name?.trim() || profile?.display_name?.trim() || "A lead agency"
    const signUpUrl = `${siteBaseUrl()}/auth/sign-up?email=${encodeURIComponent(vendorEmail)}&source=pool_resend`
    const subject = `${agencyName} added you to their partner network on Ligament`
    const body_ = `${agencyName} has added you to their partner network on Ligament based on a bid you submitted.\n\nCreate your profile to be discoverable to other agencies and track all your bids in one place.`
    const recipientName = vendorName || vendorEmail

    const sent = await sendTransactionalEmail({
      to: vendorEmail,
      subject,
      html: buildBrandedEmailHtml({ title: subject, recipientName, body: body_, ctaText: "Create Your Profile", ctaUrl: signUpUrl }),
      text: buildBrandedEmailText({ title: subject, recipientName, body: body_, ctaText: "Create Your Profile", ctaUrl: signUpUrl }),
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
