import { NextResponse } from "next/server"
import { Resend } from "resend"
import { createClient } from "@/lib/supabase/server"
import { buildBrandedEmailHtml, siteBaseUrl } from "@/lib/email"

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { data: profile } = await supabase.from("profiles").select("role, company_name, full_name").eq("id", user.id).maybeSingle()
    if (profile?.role !== "agency") {
      return NextResponse.json({ error: "Agency only" }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    const inboxItemId = typeof body.inboxItemId === "string" ? body.inboxItemId.trim() : ""
    if (!inboxItemId) {
      return NextResponse.json({ error: "inboxItemId is required" }, { status: 400 })
    }

    const { data: inbox, error: inboxError } = await supabase
      .from("partner_rfp_inbox")
      .select(
        "id, agency_id, partner_id, recipient_email, scope_item_name, agency_company_name, invite_token_expires_at, nda_gate_enforced, claimed_at"
      )
      .eq("id", inboxItemId)
      .eq("agency_id", user.id)
      .maybeSingle<{
        id: string
        agency_id: string
        partner_id: string | null
        recipient_email: string | null
        scope_item_name: string
        agency_company_name: string | null
        invite_token_expires_at: string | null
        nda_gate_enforced: boolean | null
        claimed_at: string | null
      }>()

    if (inboxError) return NextResponse.json({ error: "Failed to load inbox item" }, { status: 500 })
    if (!inbox) return NextResponse.json({ error: "Inbox item not found" }, { status: 404 })
    if (inbox.claimed_at) {
      return NextResponse.json({ error: "Invite has already been claimed" }, { status: 400 })
    }
    const isExpired =
      !!inbox.invite_token_expires_at &&
      new Date(inbox.invite_token_expires_at).getTime() < Date.now()
    if (!isExpired) {
      return NextResponse.json({ error: "Invite is still active and cannot be resent yet" }, { status: 400 })
    }

    if (inbox.invite_token_expires_at) {
      const issuedAt = new Date(inbox.invite_token_expires_at).getTime() - 30 * 24 * 60 * 60 * 1000
      if (!Number.isNaN(issuedAt) && Date.now() - issuedAt < 24 * 60 * 60 * 1000) {
        return NextResponse.json({ error: "Invite was already sent recently. Try again later." }, { status: 429 })
      }
    }

    const recipientEmail = (inbox.recipient_email || "").trim().toLowerCase()
    if (!recipientEmail) {
      return NextResponse.json({ error: "Recipient email missing for this invite" }, { status: 400 })
    }

    const token = crypto.randomUUID()
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    const { error: updateError } = await supabase
      .from("partner_rfp_inbox")
      .update({
        invite_token: token,
        invite_token_expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      })
      .eq("id", inbox.id)
      .eq("agency_id", user.id)

    if (updateError) {
      return NextResponse.json({ error: "Failed to refresh invite token" }, { status: 500 })
    }

    const baseUrl = siteBaseUrl()
    const agencyName = inbox.agency_company_name || profile?.company_name || profile?.full_name || "Lead agency"
    const scopeName = inbox.scope_item_name || "Scope"
    const signUpInviteUrl = new URL("/auth/sign-up", baseUrl)
    signUpInviteUrl.searchParams.set("invite", token)
    signUpInviteUrl.searchParams.set("email", recipientEmail)
    signUpInviteUrl.searchParams.set("scope", scopeName)
    signUpInviteUrl.searchParams.set("agency", agencyName)
    const existingInviteUrl = new URL("/partner/rfps", baseUrl)
    existingInviteUrl.searchParams.set("invite", token)

    const isExistingUser = Boolean(inbox.partner_id)
    const ndaRequired = inbox.nda_gate_enforced === true
    if (ndaRequired) {
      signUpInviteUrl.searchParams.set("nda", "required")
      existingInviteUrl.searchParams.set("nda", "required")
    }

    const emailPayload = !isExistingUser
      ? {
          subject: ndaRequired
            ? `${agencyName} invited you to respond to a confidential RFP on Ligament`
            : `${agencyName} invited you to respond to an RFP on Ligament`,
          heading: ndaRequired ? "Confidential RFP invite" : "You are invited to an RFP",
          paragraphs: ndaRequired
            ? [
                `${agencyName} has sent you a confidential RFP for ${scopeName}.`,
                "Create your account and complete the NDA to unlock access to the brief. Your invitation expires in 30 days.",
              ]
            : [
                `${agencyName} has sent you an RFP for ${scopeName} and invited you to join Ligament to respond.`,
                "Create your free account to view the full brief and submit your bid. Your invitation expires in 30 days.",
              ],
          ctaLabel: ndaRequired ? "Create Account & Sign NDA" : "Create Account & View RFP",
          ctaUrl: signUpInviteUrl.toString(),
        }
      : ndaRequired
        ? {
            subject: `${agencyName} requires an NDA to share this RFP with you`,
            heading: "NDA required before access",
            paragraphs: [
              `${agencyName} has a confidential RFP for ${scopeName} ready for you on Ligament, but requires a signed NDA first.`,
              "Log in and complete the NDA to unlock access.",
            ],
            ctaLabel: "Sign NDA & View RFP",
            ctaUrl: existingInviteUrl.toString(),
          }
        : {
            subject: `New RFP from ${agencyName}: ${scopeName}`,
            heading: "New RFP in your partner inbox",
            paragraphs: [
              `${agencyName} has sent you an RFP for ${scopeName} on Ligament.`,
              "Review the scope, timeline, and budget details, then submit your bid directly through the platform.",
            ],
            ctaLabel: "View RFP",
            ctaUrl: `${baseUrl}/partner/rfps`,
          }

    const resendApiKey = process.env.RESEND_API_KEY
    if (!resendApiKey) return NextResponse.json({ error: "RESEND_API_KEY is not configured" }, { status: 500 })
    const resend = new Resend(resendApiKey)

    await resend.emails.send({
      from: "Ligament <notifications@withligament.com>",
      to: recipientEmail,
      subject: emailPayload.subject,
      html: buildBrandedEmailHtml({
        title: emailPayload.heading,
        recipientName: recipientEmail,
        body: emailPayload.paragraphs.join("\n\n"),
        ctaText: emailPayload.ctaLabel,
        ctaUrl: emailPayload.ctaUrl,
      }),
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[broadcast-rfp/resend-invite] failed:", error)
    return NextResponse.json({ error: "Failed to resend invite" }, { status: 500 })
  }
}
