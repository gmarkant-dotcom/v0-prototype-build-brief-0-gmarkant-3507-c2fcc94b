import { NextResponse } from "next/server"
import { Resend } from "resend"
import { createClient } from "@/lib/supabase/server"
import { siteBaseUrl } from "@/lib/email"

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

    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("role, company_name, full_name, email")
      .eq("id", user.id)
      .single()
    if (profileErr) {
      console.error("[api] PATCH agency profile load failed", {
        route,
        userId: user.id,
        message: profileErr.message,
        code: profileErr.code,
      })
      return NextResponse.json({ error: "Failed to load profile" }, { status: 500 })
    }
    if (profile?.role !== "agency") return NextResponse.json({ error: "Agency only" }, { status: 403 })
    console.log("[api] start", { route, method: "PATCH", userId: user.id, role: profile.role, responseId: id })

    const { data: existing, error: existingErr } = await supabase
      .from("partner_rfp_responses")
      .select("id, partner_id, agency_id, inbox_item_id, status, agency_feedback")
      .eq("id", id)
      .eq("agency_id", user.id)
      .maybeSingle()
    if (existingErr) {
      console.error("[api] PATCH partner_rfp_responses load failed", {
        route,
        responseId: id,
        userId: user.id,
        message: existingErr.message,
        code: existingErr.code,
      })
      return NextResponse.json({ error: "Failed to load bid response" }, { status: 500 })
    }
    if (!existing) return NextResponse.json({ error: "Response not found" }, { status: 404 })

    const incomingAgencyFeedback =
      typeof body.agency_feedback === "string" ? body.agency_feedback.trim() : ""
    const existingAgencyFeedback = (existing.agency_feedback || "").trim()
    const shouldSendAgencyFeedbackEmail =
      incomingAgencyFeedback.length > 0 && incomingAgencyFeedback !== existingAgencyFeedback
    const shouldAutoTransitionToUnderReview =
      incomingAgencyFeedback.length > 0 &&
      existing.status === "submitted" &&
      (body.status === undefined || body.status === "submitted")

    const nextStatus = shouldAutoTransitionToUnderReview
      ? "under_review"
      : body.status ?? existing.status
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

    const { error: inboxStatusErr } = await supabase
      .from("partner_rfp_inbox")
      .update({ status: mapResponseStatusToInboxStatus(nextStatus), updated_at: new Date().toISOString() })
      .eq("id", existing.inbox_item_id)
      .eq("agency_id", user.id)
    if (inboxStatusErr) {
      console.error("[api] PATCH partner_rfp_inbox status sync failed", {
        route,
        responseId: id,
        inbox_item_id: existing.inbox_item_id,
        userId: user.id,
        nextStatus,
        message: inboxStatusErr.message,
        code: inboxStatusErr.code,
      })
      return NextResponse.json({ error: "Bid updated but inbox status sync failed." }, { status: 500 })
    }

    if (shouldSendAgencyFeedbackEmail) {
      const [{ data: partner, error: partnerErr }, { data: inboxRow, error: inboxErr }] =
        await Promise.all([
          supabase
            .from("profiles")
            .select("email")
            .eq("id", existing.partner_id)
            .maybeSingle(),
          supabase
            .from("partner_rfp_inbox")
            .select("scope_item_name")
            .eq("id", existing.inbox_item_id)
            .eq("agency_id", user.id)
            .maybeSingle(),
        ])

      if (partnerErr) {
        console.error("[api] feedback email: partner profile select failed", {
          route,
          responseId: id,
          partnerId: existing.partner_id,
          message: partnerErr.message,
          code: partnerErr.code,
        })
      }
      if (inboxErr) {
        console.error("[api] feedback email: inbox select failed", {
          route,
          responseId: id,
          inbox_item_id: existing.inbox_item_id,
          message: inboxErr.message,
          code: inboxErr.code,
        })
      }

      const scopeName = inboxRow?.scope_item_name?.trim?.() || ""
      const agencyName = profile.company_name || profile.full_name || "Lead agency"
      const feedbackSubject = scopeName
        ? `Feedback received on your bid for ${scopeName}`
        : "Feedback received on your recent bid submission"
      const resendApiKey = process.env.RESEND_API_KEY
      const baseUrl = siteBaseUrl()
      if (resendApiKey && partner?.email) {
        try {
          const resend = new Resend(resendApiKey)
          await resend.emails.send({
            from: "Ligament <notifications@withligament.com>",
            to: partner.email,
            cc: "hello@withligament.com",
            subject: feedbackSubject,
            html: `
            <p>${agencyName} has reviewed your bid for ${scopeName || "this scope"} and left feedback for your consideration.</p>
            <p>Log in to your Ligament partner portal to view the feedback and update your submission if needed.</p>
            <p><a href="${baseUrl}/partner/rfps/${existing.inbox_item_id}">View Feedback</a></p>
            <p>The Ligament Team<br /><a href="${baseUrl}">withligament.com</a></p>
          `,
          })
        } catch (emailErr) {
          console.error("[api] feedback email: Resend send failed", {
            route,
            responseId: id,
            message: emailErr instanceof Error ? emailErr.message : String(emailErr),
          })
        }
      }
    }

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

      // Move project out of pre-award states once work is awarded. DB uses `in_progress` for live work
      // (CHECK on projects.status); it maps to UI "active" in mapDbProjectToMaster — not a literal `active` row value.
      const preAwardStatuses = new Set(["draft", "onboarding"])
      const { data: projRow, error: projLoadErr } = await supabase
        .from("projects")
        .select("status")
        .eq("id", awardContext.projectId)
        .eq("agency_id", user.id)
        .maybeSingle()
      if (projLoadErr) {
        console.error("[api] bid award: load project status failed (assignment recorded)", {
          route,
          projectId: awardContext.projectId,
          message: projLoadErr.message,
          code: projLoadErr.code,
        })
      } else if (projRow && preAwardStatuses.has(String(projRow.status || "").toLowerCase())) {
        const { error: projUpdErr } = await supabase
          .from("projects")
          .update({ status: "in_progress", updated_at: now })
          .eq("id", awardContext.projectId)
          .eq("agency_id", user.id)
        if (projUpdErr) {
          console.error("[api] bid award: project status bump failed (assignment recorded)", {
            route,
            projectId: awardContext.projectId,
            message: projUpdErr.message,
            code: projUpdErr.code,
          })
        }
      }

      const { data: partner, error: partnerProfileErr } = await supabase
        .from("profiles")
        .select("email, full_name, company_name")
        .eq("id", existing.partner_id)
        .maybeSingle()
      if (partnerProfileErr) {
        console.error("[api] bid award: partner profile select failed (email send may be skipped)", {
          route,
          responseId: id,
          partnerId: existing.partner_id,
          message: partnerProfileErr.message,
          code: partnerProfileErr.code,
        })
      }

      const rawProjectName =
        (awardContext.inbox.master_rfp_json as Record<string, unknown> | null)?.projectName?.toString?.() || ""
      const rawScopeItemName = awardContext.inbox.scope_item_name?.trim?.() || ""
      const projectName = rawProjectName || "Project"
      const scopeItemName = rawScopeItemName || "Scope item"
      const leadAgencyName = profile.company_name || profile.full_name || "Lead agency"
      const awardSubject =
        rawScopeItemName && rawProjectName
          ? `You've been awarded ${scopeItemName} - ${projectName}`
          : "You've been selected for this project"
      const resendApiKey = process.env.RESEND_API_KEY
      const baseUrl = siteBaseUrl()
      if (resendApiKey && partner?.email) {
        try {
          const resend = new Resend(resendApiKey)
          await resend.emails.send({
            from: "Ligament <notifications@withligament.com>",
            to: "hello@withligament.com",
            cc: partner.email,
            subject: awardSubject,
            html: `
            <p>Congratulations, ${leadAgencyName} has selected your bid for ${scopeItemName}.</p>
            <p>
              You are officially on board for ${projectName}. Expect onboarding materials from ${leadAgencyName}
              shortly with next steps, kickoff details, and project documents.
            </p>
            <p><a href="${baseUrl}/partner/rfps">View Project</a></p>
            <p>The Ligament Team<br /><a href="${baseUrl}">withligament.com</a></p>
          `,
          })
        } catch (emailErr) {
          console.error("[api] bid award: Resend send failed (award already recorded)", {
            route,
            responseId: id,
            message: emailErr instanceof Error ? emailErr.message : String(emailErr),
          })
        }
      }
    }

    if (existing.status !== "declined" && nextStatus === "declined") {
      const [partnerRes, inboxRes] = await Promise.all([
        supabase.from("profiles").select("email, full_name, company_name").eq("id", existing.partner_id).maybeSingle(),
        supabase
          .from("partner_rfp_inbox")
          .select("scope_item_name, master_rfp_json")
          .eq("id", existing.inbox_item_id)
          .maybeSingle(),
      ])
      const partner = partnerRes.data
      const inbox = inboxRes.data
      if (partnerRes.error) {
        console.error("[api] decline email: partner profile select failed", {
          route,
          responseId: id,
          partnerId: existing.partner_id,
          message: partnerRes.error.message,
          code: partnerRes.error.code,
        })
      }
      if (inboxRes.error) {
        console.error("[api] decline email: partner_rfp_inbox select failed", {
          route,
          responseId: id,
          inbox_item_id: existing.inbox_item_id,
          message: inboxRes.error.message,
          code: inboxRes.error.code,
        })
      }
      const rawProjectName =
        (inbox?.master_rfp_json as Record<string, unknown> | null)?.projectName?.toString?.() || ""
      const rawScopeItemName = inbox?.scope_item_name?.trim?.() || ""
      const projectName = rawProjectName || "Project"
      const scopeItemName = rawScopeItemName || "Scope item"
      const partnerName = partner?.company_name || partner?.full_name || partner?.email || "Partner"
      const leadAgencyName = profile.company_name || profile.full_name || "Lead agency"
      const declineSubject = rawScopeItemName
        ? `Update on your bid for ${scopeItemName}`
        : "Update on your recent bid submission"
      const resendApiKey = process.env.RESEND_API_KEY
      const baseUrl = siteBaseUrl()
      if (resendApiKey && partner?.email) {
        try {
          const resend = new Resend(resendApiKey)
          await resend.emails.send({
            from: "Ligament <notifications@withligament.com>",
            to: partner.email,
            cc: "hello@withligament.com",
            subject: declineSubject,
            html: `
            <p>Hi ${partnerName},</p>
            <p>
              Thank you for submitting your bid. After careful review, ${leadAgencyName} has decided to move
              forward with another partner for this scope.
            </p>
            <p>
              We appreciate your time and the quality of your submission. We hope to work together on a future
              project.
            </p>
            ${declineReason ? `<p><strong>Reason:</strong> ${declineReason}</p>` : ""}
            <p><a href="${baseUrl}/partner/rfps">View Update</a></p>
            <p>The Ligament Team<br /><a href="${baseUrl}">withligament.com</a></p>
          `,
          })
        } catch (emailErr) {
          console.error("[api] decline: Resend send failed", {
            route,
            responseId: id,
            message: emailErr instanceof Error ? emailErr.message : String(emailErr),
          })
        }
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
