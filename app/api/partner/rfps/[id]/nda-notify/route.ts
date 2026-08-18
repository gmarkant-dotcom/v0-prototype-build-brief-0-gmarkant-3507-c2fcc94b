import { resolveCallerOrgIds, callerOwnsOrg, orgIdFromColumn } from "@/lib/entitlements"
import { NextResponse } from "next/server"
import { buildBrandedEmailHtml, resolveOrgNotificationRecipients, sendTransactionalEmail, siteBaseUrl } from "@/lib/email"
import { requirePartnerRole } from "@/lib/api-auth"

function isSameEmail(a: string | null | undefined, b: string | null | undefined) {
  return (a || "").trim().toLowerCase() === (b || "").trim().toLowerCase()
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const auth = await requirePartnerRole()
    if (!auth.authorized) return auth.response
    const { user, supabase } = auth

    // 079: an organization column is not a user id. Reads scope to the caller's memberships.
    const callerOrgIds = await resolveCallerOrgIds(user.id, supabase)

    const { data: profile } = await supabase
      .from("profiles")
      .select("email, company_name, full_name")
      .eq("id", user.id)
      .maybeSingle<{
        email: string | null
        company_name: string | null
        full_name: string | null
      }>()

    const { data: inbox, error: inboxError } = await supabase
      .from("partner_rfp_inbox")
      .select(
        "id, lead_org_id, vendor_org_id, recipient_email, project_id, scope_item_name, nda_gate_enforced, agency_nda_notified_at, master_rfp_json"
      )
      .eq("id", id)
      .maybeSingle<{
        id: string
        lead_org_id: string
        vendor_org_id: string | null
        recipient_email: string | null
        project_id: string | null
        scope_item_name: string | null
        nda_gate_enforced: boolean | null
        agency_nda_notified_at: string | null
        master_rfp_json: Record<string, unknown> | null
      }>()

    if (inboxError) return NextResponse.json({ error: "Failed to load RFP" }, { status: 500 })
    if (!inbox) return NextResponse.json({ error: "RFP not found" }, { status: 404 })

    const ownsByPartnerId = callerOwnsOrg(callerOrgIds, inbox.vendor_org_id)
    const ownsByEmail = isSameEmail(inbox.recipient_email, profile?.email || user.email)
    if (!ownsByPartnerId && !ownsByEmail) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }

    if (!inbox.nda_gate_enforced) {
      return NextResponse.json({ error: "This RFP is not NDA-gated." }, { status: 400 })
    }

    if (inbox.agency_nda_notified_at) {
      const last = new Date(inbox.agency_nda_notified_at).getTime()
      if (!Number.isNaN(last) && Date.now() - last < 24 * 60 * 60 * 1000) {
        return NextResponse.json(
          { error: "Agency has already been notified. Please wait for their confirmation." },
          { status: 429 }
        )
      }
    }

    // 079: an ORGANISATION id. This is the one of the eleven that already failed loudly
    // (it 500s below rather than skipping), and it keeps doing so.
    const [agencyRecipients, { data: projectRow }] = await Promise.all([
      resolveOrgNotificationRecipients(orgIdFromColumn(inbox.lead_org_id), supabase),
      inbox.project_id
        ? supabase.from("projects").select("id, title").eq("id", inbox.project_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ])
    const agencyProfile = agencyRecipients[0] ?? null

    if (!agencyProfile?.email) {
      console.error("[api] nda-notify: no notification recipients for the lead agency", {
        leadOrgId: inbox.lead_org_id,
      })
      return NextResponse.json({ error: "Agency email not found" }, { status: 500 })
    }

    const partnerName = profile?.company_name || profile?.full_name || profile?.email || "Vendor"
    const scopeName = inbox.scope_item_name || "Scope"
    const projectName = (projectRow as { title?: string } | null)?.title || "Project"
    const baseUrl = siteBaseUrl()
    const agencyRecipient =
      agencyProfile.company_name?.trim() ||
      agencyProfile.full_name?.trim() ||
      agencyProfile.email.trim()
    try {
      await sendTransactionalEmail({
        to: agencyProfile.email,
        subject: `${partnerName} has signed the NDA for ${scopeName}`,
        html: buildBrandedEmailHtml({
          title: "NDA completed by vendor",
          recipientName: agencyRecipient,
          body: `${partnerName} has completed the NDA for ${scopeName} on ${projectName}.\n\nLog in to confirm the NDA and unlock their access to the RFP.`,
          ctaText: "Confirm NDA",
          ctaUrl: `${baseUrl}/agency/pool`,
        }),
      })
    } catch (emailErr) {
      console.error("[nda-notify] email send failed", emailErr)
      return NextResponse.json({ error: "Failed to send agency notification" }, { status: 500 })
    }

    const now = new Date().toISOString()
    const { error: updateError } = await supabase
      .from("partner_rfp_inbox")
      .update({ agency_nda_notified_at: now, updated_at: now })
      .eq("id", id)
    if (updateError) return NextResponse.json({ error: "Failed to update notification status" }, { status: 500 })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[partner/rfps/[id]/nda-notify] failed:", error)
    return NextResponse.json({ error: "Failed to notify agency" }, { status: 500 })
  }
}
