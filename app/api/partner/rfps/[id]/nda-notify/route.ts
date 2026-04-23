import { NextResponse } from "next/server"
import { Resend } from "resend"
import { createClient } from "@/lib/supabase/server"
import { siteBaseUrl } from "@/lib/email"

function isSameEmail(a: string | null | undefined, b: string | null | undefined) {
  return (a || "").trim().toLowerCase() === (b || "").trim().toLowerCase()
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, email, company_name, full_name")
      .eq("id", user.id)
      .maybeSingle<{ role: string | null; email: string | null; company_name: string | null; full_name: string | null }>()
    if (profile?.role !== "partner") {
      return NextResponse.json({ error: "Partners only" }, { status: 403 })
    }

    const { data: inbox, error: inboxError } = await supabase
      .from("partner_rfp_inbox")
      .select(
        "id, agency_id, partner_id, recipient_email, project_id, scope_item_name, nda_gate_enforced, agency_nda_notified_at, master_rfp_json"
      )
      .eq("id", id)
      .maybeSingle<{
        id: string
        agency_id: string
        partner_id: string | null
        recipient_email: string | null
        project_id: string | null
        scope_item_name: string | null
        nda_gate_enforced: boolean | null
        agency_nda_notified_at: string | null
        master_rfp_json: Record<string, unknown> | null
      }>()

    if (inboxError) return NextResponse.json({ error: "Failed to load RFP" }, { status: 500 })
    if (!inbox) return NextResponse.json({ error: "RFP not found" }, { status: 404 })

    const ownsByPartnerId = inbox.partner_id === user.id
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

    const [{ data: agencyProfile }, { data: projectRow }] = await Promise.all([
      supabase.from("profiles").select("email, company_name, full_name").eq("id", inbox.agency_id).maybeSingle(),
      inbox.project_id
        ? supabase.from("projects").select("id, name").eq("id", inbox.project_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ])

    if (!agencyProfile?.email) {
      return NextResponse.json({ error: "Agency email not found" }, { status: 500 })
    }

    const partnerName = profile?.company_name || profile?.full_name || profile?.email || "Partner"
    const scopeName = inbox.scope_item_name || "Scope"
    const projectName = (projectRow as { name?: string } | null)?.name || "Project"
    const resendApiKey = process.env.RESEND_API_KEY
    if (!resendApiKey) return NextResponse.json({ error: "RESEND_API_KEY is not configured" }, { status: 500 })
    const baseUrl = siteBaseUrl()
    const resend = new Resend(resendApiKey)

    await resend.emails.send({
      from: "Ligament <notifications@withligament.com>",
      to: agencyProfile.email,
      subject: `${partnerName} has signed the NDA for ${scopeName}`,
      html: `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#081F1F;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;"><div style="max-width:600px;margin:0 auto;padding:40px 20px;"><div style="background:#0C3535;border-radius:16px;padding:32px;border:1px solid rgba(255,255,255,0.12);"><p style="color:#9BB8B8;font-size:16px;line-height:1.7;margin:0 0 12px 0;"><strong style="color:#FFFFFF;">${partnerName}</strong> has completed the NDA for <strong style="color:#FFFFFF;">${scopeName}</strong> on <strong style="color:#FFFFFF;">${projectName}</strong>.</p><p style="color:#9BB8B8;font-size:16px;line-height:1.7;margin:0 0 24px 0;">Log in to confirm the NDA and unlock their access to the RFP.</p><a href="${baseUrl}/agency/pool" style="display:inline-block;background:#C8F53C;color:#0C3535;text-decoration:none;padding:14px 24px;border-radius:10px;font-weight:700;font-size:14px;text-transform:uppercase;letter-spacing:0.05em;">Confirm NDA</a><p style="color:#9BB8B8;font-size:13px;margin:24px 0 0;">The Ligament Team<br /><a href="${baseUrl}" style="color:#C8F53C;text-decoration:none;">withligament.com</a></p></div></div></body></html>`,
    })

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
