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

    /**
     * Award requires a project_assignment row keyed by (project_id, partnership_id) from partner_rfp_inbox.
     * partner_rfp_responses links to inbox only via inbox_item_id → partner_rfp_inbox.id (there is no inbox_id on responses).
     */
    type AwardContext = {
      inbox: {
        id: string
        scope_item_name: string | null
        master_rfp_json: unknown
      }
      projectId: string
      partnershipId: string
    }
    let awardContext: AwardContext | null = null

    if (existing.status !== "awarded" && nextStatus === "awarded") {
      const { data: inboxRow, error: inboxFetchErr } = await supabase
        .from("partner_rfp_inbox")
        .select("id, project_id, partner_id, partnership_id, scope_item_name, master_rfp_json")
        .eq("id", existing.inbox_item_id)
        .eq("agency_id", user.id)
        .maybeSingle()

      if (inboxFetchErr) {
        console.error("[api] bid award: failed to load partner_rfp_inbox (join key: partner_rfp_responses.inbox_item_id)", {
          route,
          responseId: id,
          inbox_item_id: existing.inbox_item_id,
          message: inboxFetchErr.message,
          code: inboxFetchErr.code,
        })
        return NextResponse.json({ error: "Failed to load broadcast inbox for award." }, { status: 500 })
      }
      if (!inboxRow) {
        console.error("[api] bid award: partner_rfp_inbox row not found for inbox_item_id", {
          route,
          responseId: id,
          inbox_item_id: existing.inbox_item_id,
        })
        return NextResponse.json({ error: "Broadcast inbox row not found for this response." }, { status: 500 })
      }

      const projectId = inboxRow.project_id as string | null
      if (!projectId) {
        console.error("[api] bid award: partner_rfp_inbox.project_id is null — refusing award (project_assignments requires project_id)", {
          route,
          responseId: id,
          inbox_item_id: existing.inbox_item_id,
          inboxId: inboxRow.id,
        })
        return NextResponse.json(
          {
            error:
              "Cannot award this bid: the broadcast inbox is not linked to a project. Send this RFP from a project context so inbox.project_id is set.",
          },
          { status: 500 }
        )
      }

      let partnershipId = inboxRow.partnership_id as string | null
      const partnerIdForResolution = (inboxRow.partner_id as string | null) || existing.partner_id
      if (!partnershipId && partnerIdForResolution) {
        const { data: rel, error: relErr } = await supabase
          .from("partnerships")
          .select("id")
          .eq("agency_id", user.id)
          .eq("partner_id", partnerIdForResolution)
          .eq("status", "active")
          .maybeSingle()
        if (relErr) {
          console.error("[api] bid award: active partnership lookup failed", {
            route,
            responseId: id,
            partnerId: partnerIdForResolution,
            message: relErr.message,
            code: relErr.code,
          })
          return NextResponse.json({ error: "Failed to resolve partnership for award." }, { status: 500 })
        }
        partnershipId = rel?.id ?? null
      }

      if (!partnershipId) {
        console.error(
          "[api] bid award: partnership_id unresolved — inbox.partnership_id null and no active partnerships row for partner (project_assignments requires partnership_id)",
          {
            route,
            responseId: id,
            inbox_item_id: existing.inbox_item_id,
            inboxId: inboxRow.id,
            projectId,
            inboxPartnershipId: inboxRow.partnership_id,
            partnerIdForResolution,
          }
        )
        return NextResponse.json(
          {
            error:
              "Cannot award this bid: no partnership is linked to this broadcast and no active agency–partner relationship was found.",
          },
          { status: 500 }
        )
      }

      awardContext = {
        inbox: {
          id: inboxRow.id as string,
          scope_item_name: inboxRow.scope_item_name as string | null,
          master_rfp_json: inboxRow.master_rfp_json,
        },
        projectId,
        partnershipId,
      }
    }

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

    if (awardContext) {
      const now = new Date().toISOString()
      // UNIQUE(project_id, partnership_id) — upsert sets status to awarded (allowed by project_assignments_status_check).
      const { error: paErr } = await supabase.from("project_assignments").upsert(
        {
          project_id: awardContext.projectId,
          partnership_id: awardContext.partnershipId,
          status: "awarded",
          awarded_at: now,
          updated_at: now,
        },
        { onConflict: "project_id,partnership_id" }
      )

      if (paErr) {
        console.error("[api] bid award: project_assignments upsert failed (onConflict project_id,partnership_id)", {
          route,
          responseId: id,
          projectId: awardContext.projectId,
          partnershipId: awardContext.partnershipId,
          message: paErr.message,
          code: paErr.code,
        })
        return NextResponse.json(
          {
            error:
              "Bid status was updated but recording the project assignment failed. Retry the award or fix the assignment row; check server logs.",
          },
          { status: 500 }
        )
      }

      console.log("[api] bid award: project_assignments upsert ok", {
        route,
        responseId: id,
        projectId: awardContext.projectId,
        partnershipId: awardContext.partnershipId,
      })

      const { data: partner } = await supabase
        .from("profiles")
        .select("email, full_name, company_name")
        .eq("id", existing.partner_id)
        .maybeSingle()

      const projectName =
        (awardContext.inbox.master_rfp_json as Record<string, unknown> | null)?.projectName?.toString?.() || "Project"
      const scopeItemName = awardContext.inbox.scope_item_name || "Scope item"
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

    if (existing.status !== "declined" && nextStatus === "declined") {
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
          to: partner.email,
          cc: "hello@withligament.com",
          subject: "Update on your bid submission",
          html: `
            <p>Hi ${partnerName},</p>
            <p>There is an update on your bid submission.</p>
            <p><strong>Project:</strong> ${projectName}</p>
            <p><strong>Scope Item:</strong> ${scopeItemName}</p>
            <p><strong>Lead Agency:</strong> ${leadAgencyName}</p>
            ${declineReason ? `<p><strong>Reason:</strong> ${declineReason}</p>` : ""}
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
