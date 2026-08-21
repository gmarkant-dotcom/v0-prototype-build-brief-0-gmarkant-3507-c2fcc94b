import { resolveCallerOrgIds, orgIdFromColumn } from "@/lib/entitlements"
import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { recordMilestone } from "@/lib/milestone-events"
import { buildBrandedEmailHtml, resolveOrgNotificationRecipients, sendTransactionalEmail, siteBaseUrl } from "@/lib/email"
import {
  PARTNER_BUDGET_STATUSES,
  PARTNER_WORKFLOW_STATUSES,
  type PartnerBudgetStatus,
  type PartnerWorkflowStatus,
} from "@/lib/partner-status"

export const dynamic = "force-dynamic"

const noStoreHeaders = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate",
} as const

const ROUTE = "/api/partner/projects/[projectId]/status-update"

function parseBody(body: unknown): {
  status: PartnerWorkflowStatus
  budget_status: PartnerBudgetStatus
  completion_pct: number
  notes: string | null
} | { error: string } {
  if (!body || typeof body !== "object") return { error: "Invalid JSON body" }
  const o = body as Record<string, unknown>
  const status = o.status
  const budget_status = o.budget_status
  const completion_pct = o.completion_pct
  const notes = o.notes
  if (typeof status !== "string" || !PARTNER_WORKFLOW_STATUSES.includes(status as PartnerWorkflowStatus)) {
    return { error: "Invalid status" }
  }
  if (
    typeof budget_status !== "string" ||
    !PARTNER_BUDGET_STATUSES.includes(budget_status as PartnerBudgetStatus)
  ) {
    return { error: "Invalid budget_status" }
  }
  const pct = typeof completion_pct === "number" ? completion_pct : Number(completion_pct)
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
    return { error: "completion_pct must be 0–100" }
  }
  const notesStr = typeof notes === "string" ? notes.trim() : ""
  return {
    status: status as PartnerWorkflowStatus,
    budget_status: budget_status as PartnerBudgetStatus,
    completion_pct: Math.round(pct),
    notes: notesStr ? notesStr.slice(0, 8000) : null,
  }
}

/** Latest status rows for this partner + project; optional ?assignmentId= filters by project_assignment_id. */
export async function GET(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params
    const assignmentIdFilter = new URL(req.url).searchParams.get("assignmentId")?.trim() || null
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStoreHeaders })
    }

    // 079: an organization column is not a user id. Reads scope to the caller's memberships.
    const callerOrgIds = await resolveCallerOrgIds(user.id, supabase)

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, active_role, full_name, company_name, email")
      .eq("id", user.id)
      .single()
    if (profile?.role !== "partner" && profile?.active_role !== "partner") {
      return NextResponse.json({ error: "Vendor only" }, { status: 403, headers: noStoreHeaders })
    }

    const { data: partnerships } = await supabase.from("partnerships").select("id").in("vendor_org_id", callerOrgIds)
    const partnershipIds = (partnerships || []).map((p) => p.id as string)
    if (partnershipIds.length === 0) {
      return NextResponse.json({ latest: null, updates: [] }, { headers: noStoreHeaders })
    }

    let q = supabase
      .from("partner_status_updates")
      .select("*")
      .eq("project_id", projectId)
      .in("partnership_id", partnershipIds)
    if (assignmentIdFilter) {
      q = q.eq("project_assignment_id", assignmentIdFilter)
    }
    const { data: rows, error } = await q.order("created_at", { ascending: false })

    if (error) {
      console.error("[partner/status-update] GET", { message: error.message, code: error.code })
      return NextResponse.json({ error: "Failed to load status" }, { status: 500, headers: noStoreHeaders })
    }

    const list = rows ?? []
    const latest = list[0] ?? null
    return NextResponse.json({ latest, updates: list }, { headers: noStoreHeaders })
  } catch (e) {
    console.error("[partner/status-update] GET unhandled", e)
    return NextResponse.json({ error: "Failed" }, { status: 500, headers: noStoreHeaders })
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStoreHeaders })
    }

    // 079: an organization column is not a user id. Reads scope to the caller's memberships.
    const callerOrgIds = await resolveCallerOrgIds(user.id, supabase)

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, active_role, full_name, company_name, email")
      .eq("id", user.id)
      .single()
    if (profile?.role !== "partner" && profile?.active_role !== "partner") {
      return NextResponse.json({ error: "Vendor only" }, { status: 403, headers: noStoreHeaders })
    }

    const bodyRaw = await req.json().catch(() => null)
    // lead_org_id and vendor_org_id are read alongside id because the milestone at the foot
    // of this handler needs BOTH: migration 088's vendor INSERT policy pins org_id to the
    // partnership's lead_org_id through an EXISTS, and keys the membership test on
    // vendor_org_id. Taking them off the same row the assignment resolves through is what
    // makes that join satisfied by construction. The GET above is unchanged.
    const { data: partnerships } = await supabase
      .from("partnerships")
      .select("id, lead_org_id, vendor_org_id")
      .in("vendor_org_id", callerOrgIds)
    const partnershipRows = (partnerships || []) as Array<{
      id: string
      lead_org_id: string | null
      vendor_org_id: string | null
    }>
    const partnershipIds = partnershipRows.map((p) => p.id)
    if (partnershipIds.length === 0) {
      return NextResponse.json({ error: "No partnership" }, { status: 403, headers: noStoreHeaders })
    }

    const bodyObj = bodyRaw && typeof bodyRaw === "object" ? (bodyRaw as Record<string, unknown>) : {}
    const requestedAssignmentId =
      typeof bodyObj.project_assignment_id === "string" ? bodyObj.project_assignment_id.trim() : ""

    type PaRow = { id: string; partnership_id: string; project_id: string; status: string }
    let assignment: PaRow | null = null

    if (requestedAssignmentId) {
      const { data: row, error: aErr } = await supabase
        .from("project_assignments")
        .select("id, partnership_id, project_id, status")
        .eq("id", requestedAssignmentId)
        .eq("project_id", projectId)
        .in("partnership_id", partnershipIds)
        .eq("status", "awarded")
        .maybeSingle()

      if (aErr) {
        console.error("[partner/status-update] POST assignment by id", aErr)
        return NextResponse.json({ error: "Failed to resolve assignment" }, { status: 500, headers: noStoreHeaders })
      }
      assignment = row as PaRow | null
    } else {
      const { data: row, error: aErr } = await supabase
        .from("project_assignments")
        .select("id, partnership_id, project_id, status")
        .eq("project_id", projectId)
        .in("partnership_id", partnershipIds)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle()

      if (aErr) {
        console.error("[partner/status-update] POST assignment", aErr)
        return NextResponse.json({ error: "Failed to resolve assignment" }, { status: 500, headers: noStoreHeaders })
      }
      assignment = row as PaRow | null
    }

    if (!assignment) {
      return NextResponse.json(
        {
          error: requestedAssignmentId
            ? "Invalid or inaccessible project assignment for this project"
            : "No project assignment for this project and your partnership",
        },
        { status: 400, headers: noStoreHeaders }
      )
    }

    const body = parseBody(bodyRaw)
    if ("error" in body) {
      return NextResponse.json({ error: body.error }, { status: 400, headers: noStoreHeaders })
    }

    const now = new Date().toISOString()
    const { data: created, error: insErr } = await supabase
      .from("partner_status_updates")
      .insert({
        project_assignment_id: assignment.id,
        project_id: projectId,
        partnership_id: assignment.partnership_id as string,
        status: body.status,
        budget_status: body.budget_status,
        completion_pct: body.completion_pct,
        notes: body.notes,
        is_resolved: false,
        updated_at: now,
      })
      .select("*")
      .single()

    if (insErr) {
      console.error("[partner/status-update] POST insert", insErr)
      return NextResponse.json({ error: insErr.message || "Insert failed" }, { status: 500, headers: noStoreHeaders })
    }

    const partnerName =
      profile.company_name?.trim() || profile.full_name?.trim() || profile.email?.trim() || "A vendor"
    try {
      const { data: project } = await supabase
        .from("projects")
        .select("org_id, title")
        .eq("id", projectId)
        .maybeSingle()
      if (project?.org_id) {
        // 079: project.org_id is a lead agency ORGANISATION id. The old
        // `profiles WHERE id = <company id>` lookup returns nothing for any organization
        // created after 079, and this send is guarded by `if (recipientEmail)` - so it
        // would have gone quiet with no log line. See lib/email.ts.
        const agencyRecipients = await resolveOrgNotificationRecipients(project.org_id, supabase)
        if (agencyRecipients.length === 0) {
          console.error("[api] status-update: no notification recipients for the lead agency", {
            projectId,
            orgId: project.org_id,
          })
        }
        const agencyProfile = agencyRecipients[0] ?? null
        const recipientEmail = agencyProfile?.email?.trim()
        if (recipientEmail) {
          const projectName = project.title?.trim() || "Project"
          const reviewUrl = `${siteBaseUrl()}/agency/dashboard`
          const statusFlag = body.status.replace(/_/g, " ")
          const agencyRecipient =
            agencyProfile?.company_name?.trim() ||
            agencyProfile?.full_name?.trim() ||
            recipientEmail
          await sendTransactionalEmail({
            to: recipientEmail,
            subject: `${partnerName} submitted a status update on ${projectName}`,
            html: buildBrandedEmailHtml({
              title: "Vendor status update",
              recipientName: agencyRecipient,
              body: `${partnerName} has submitted a project status update for ${projectName}.\n\nCompletion: ${body.completion_pct}%\nStatus: ${statusFlag}\n\nLog in to review the update and respond.`,
              ctaText: "Review Update",
              ctaUrl: reviewUrl,
            }),
          })
        }
      }
    } catch (emailError) {
      console.error("[partner/status-update] notification email failed", emailError)
    }

    /**
     * Milestone: status_update.post, VENDOR SIDE.
     *
     * Unblocked by migration 088 - 'status_update.post' is on
     * vendor_emittable_event_types() - and needing no ruling: the copy already exists at
     * lib/activity-feed.ts:396 and the type is already on 080's vendor-visible whitelist.
     * The agency-side counterpart, status_update.resolve, has had an emitter since 080.
     *
     * EVERY VALUE COMES OFF THE PARTNERSHIP ROW THE ASSIGNMENT RESOLVED THROUGH, not off a
     * parameter and not off the caller's user id. `partnershipRows` was filtered by
     * `.in("vendor_org_id", callerOrgIds)`, so the row found here is provably one whose
     * vendor side is one of the caller's own organizations - which is the membership test
     * 088 makes - and its lead_org_id is the agency, which is the org_id the EXISTS pins.
     *
     * PAYLOAD: the completion percentage and the workflow status, both of which are ALREADY
     * in the email this handler sends to the same agency, and neither of which says anything
     * about any other vendor. No counts, no cross-vendor totals, no recipient list.
     *
     * NON-FATAL, LIKE EVERY OTHER MILESTONE. The status update is already committed. If the
     * partnership row cannot be found, or 088 is not applied and the insert is refused with
     * 42501, lib/milestone-events.ts logs and returns void.
     */
    try {
      const milestonePartnership = partnershipRows.find((p) => p.id === assignment.partnership_id) ?? null
      if (!milestonePartnership) {
        console.error("[partner/status-update] milestone skipped: assignment partnership not in caller set", {
          route: ROUTE,
          partnershipId: assignment.partnership_id,
        })
      } else {
        await recordMilestone(supabase, {
          eventType: "status_update.post",
          actorSide: "vendor",
          orgId: orgIdFromColumn(milestonePartnership.lead_org_id),
          actorId: user.id,
          vendorOrgId: orgIdFromColumn(milestonePartnership.vendor_org_id),
          partnershipId: milestonePartnership.id,
          subjectType: "project",
          subjectId: projectId,
          payload: {
            completion_pct: body.completion_pct,
            status: body.status,
          },
        })
      }
    } catch (milestoneErr) {
      console.error("[partner/status-update] milestone context failed (non-fatal)", {
        route: ROUTE,
        projectId,
        message: milestoneErr instanceof Error ? milestoneErr.message : String(milestoneErr),
      })
    }

    console.log("[api] success", { route: ROUTE, method: "POST", userId: user.id, projectId })
    return NextResponse.json({ update: created }, { headers: noStoreHeaders })
  } catch (e) {
    console.error("[partner/status-update] POST unhandled", e)
    return NextResponse.json({ error: "Failed" }, { status: 500, headers: noStoreHeaders })
  }
}
