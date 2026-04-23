import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildBrandedEmailHtml, sendTransactionalEmail, siteBaseUrl } from "@/lib/email"
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

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, full_name, company_name, email")
      .eq("id", user.id)
      .single()
    if (profile?.role !== "partner") {
      return NextResponse.json({ error: "Partner only" }, { status: 403, headers: noStoreHeaders })
    }

    const { data: partnerships } = await supabase.from("partnerships").select("id").eq("partner_id", user.id)
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

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, full_name, company_name, email")
      .eq("id", user.id)
      .single()
    if (profile?.role !== "partner") {
      return NextResponse.json({ error: "Partner only" }, { status: 403, headers: noStoreHeaders })
    }

    const bodyRaw = await req.json().catch(() => null)
    const { data: partnerships } = await supabase.from("partnerships").select("id").eq("partner_id", user.id)
    const partnershipIds = (partnerships || []).map((p) => p.id as string)
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
      profile.company_name?.trim() || profile.full_name?.trim() || profile.email?.trim() || "A partner"
    try {
      const { data: project } = await supabase
        .from("projects")
        .select("agency_id, title")
        .eq("id", projectId)
        .maybeSingle()
      if (project?.agency_id) {
        const { data: agencyProfile } = await supabase
          .from("profiles")
          .select("email, company_name, full_name")
          .eq("id", project.agency_id)
          .maybeSingle()
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
              title: "Partner status update",
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

    console.log("[api] success", { route: ROUTE, method: "POST", userId: user.id, projectId })
    return NextResponse.json({ update: created }, { headers: noStoreHeaders })
  } catch (e) {
    console.error("[partner/status-update] POST unhandled", e)
    return NextResponse.json({ error: "Failed" }, { status: 500, headers: noStoreHeaders })
  }
}
