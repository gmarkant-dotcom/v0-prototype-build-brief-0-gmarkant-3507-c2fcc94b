import { NextResponse } from "next/server"
import { Resend } from "resend"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

type PatchBody = {
  status?: "submitted" | "under_review" | "shortlisted" | "meeting_requested" | "awarded" | "declined"
  agency_feedback?: string
  decline_reason?: string
}

const ALLOWED_STATUS = new Set(["submitted", "under_review", "shortlisted", "meeting_requested", "awarded", "declined"])

function mapResponseStatusToInboxStatus(status: string): string {
  if (status === "shortlisted") return "shortlisted"
  if (status === "meeting_requested") return "meeting_requested"
  if (status === "awarded") return "awarded"
  if (status === "declined") return "declined"
  return "bid_submitted"
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const route = "/api/agency/rfp-responses/[id]"
  try {
    const { id } = await params
    const body = (await req.json().catch(() => ({}))) as PatchBody
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { data: profile } = await supabase.from("profiles").select("role, company_name, full_name, email").eq("id", user.id).single()
    if (profile?.role !== "agency") return NextResponse.json({ error: "Agency only" }, { status: 403 })
    console.log("[api] start", { route, method: "PATCH", userId: user.id, role: profile.role, responseId: id })

    const { data: existing, error: existingErr } = await supabase
      .from("partner_rfp_responses")
      .select("id, partner_id, agency_id, inbox_item_id, status, agency_feedback")
      .eq("id", id)
      .eq("agency_id", user.id)
      .maybeSingle()
    if (existingErr || !existing) return NextResponse.json({ error: "Response not found" }, { status: 404 })

    const nextStatus = body.status ?? existing.status
    if (!ALLOWED_STATUS.has(nextStatus)) {
      return NextResponse.json({ error: "Invalid status value" }, { status: 400 })
    }
    if (existing.status === "awarded" && nextStatus !== "awarded") {
      return NextResponse.json({ error: "Awarded bids cannot transition to another status" }, { status: 400 })
    }

    const agencyFeedback = typeof body.agency_feedback === "string" ? body.agency_feedback.trim() : existing.agency_feedback || null
    const declineReason = typeof body.decline_reason === "string" ? body.decline_reason.trim() : ""
    const composedFeedback =
      nextStatus === "declined" && declineReason
        ? [agencyFeedback, `Decline reason: ${declineReason}`].filter(Boolean).join("\n\n")
        : agencyFeedback

    const patch: Record<string, unknown> = {
      status: nextStatus,
      agency_feedback: composedFeedback || null,
      updated_at: new Date().toISOString(),
    }
    if (body.agency_feedback !== undefined || declineReason) patch.feedback_updated_at = new Date().toISOString()
    if (existing.status !== nextStatus) patch.feedback_updated_at = new Date().toISOString()

    const { data: updated, error: updateErr } = await supabase
      .from("partner_rfp_responses")
      .update(patch)
      .eq("id", id)
      .eq("agency_id", user.id)
      .select("*")
      .single()
    if (updateErr) {
      console.error("[api] failure", { route, method: "PATCH", userId: user.id, role: profile.role, code: updateErr.code, message: updateErr.message })
      return NextResponse.json({ error: "Failed to update bid response" }, { status: 500 })
    }

    await supabase
      .from("partner_rfp_inbox")
      .update({ status: mapResponseStatusToInboxStatus(nextStatus), updated_at: new Date().toISOString() })
      .eq("id", existing.inbox_item_id)
      .eq("agency_id", user.id)

    if (existing.status !== "awarded" && nextStatus === "awarded") {
      const [{ data: partner }, { data: inbox }] = await Promise.all([
        supabase.from("profiles").select("email, full_name, company_name").eq("id", existing.partner_id).maybeSingle(),
        supabase
          .from("partner_rfp_inbox")
          .select("scope_item_name, master_rfp_json")
          .eq("id", existing.inbox_item_id)
          .maybeSingle(),
      ])

      const projectName =
        (inbox?.master_rfp_json as Record<string, unknown> | null)?.projectName?.toString?.() || "Project"
      const scopeItemName = inbox?.scope_item_name || "Scope item"
      const partnerName = partner?.company_name || partner?.full_name || partner?.email || "Partner"
      const leadAgencyName = profile.company_name || profile.full_name || "Lead agency"
      const resendApiKey = process.env.RESEND_API_KEY
      if (resendApiKey && partner?.email) {
        const resend = new Resend(resendApiKey)
        await resend.emails.send({
          from: "Ligament <notifications@withligament.com>",
          to: "hello@withligament.com",
          cc: partner.email,
          subject: "You've been awarded the project",
          html: `
            <p><strong>${partnerName}</strong> has been awarded.</p>
            <p><strong>Project:</strong> ${projectName}</p>
            <p><strong>Scope Item:</strong> ${scopeItemName}</p>
            <p><strong>Lead Agency:</strong> ${leadAgencyName}</p>
            <p><a href="https://withligament.com/partner/rfps">View your RFP inbox</a></p>
          `,
        })
      }
    }

    console.log("[api] success", {
      route,
      method: "PATCH",
      userId: user.id,
      role: profile.role,
      responseId: id,
      fromStatus: existing.status,
      toStatus: nextStatus,
      feedbackUpdated: body.agency_feedback !== undefined || !!declineReason,
    })
    return NextResponse.json({ response: updated })
  } catch (error) {
    console.error("[api] failure", {
      route,
      method: "PATCH",
      code: 500,
      message: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
