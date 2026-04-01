import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
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

/** Latest status row for this partner + project (any resolution). */
export async function GET(_req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStoreHeaders })
    }

    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single()
    if (profile?.role !== "partner") {
      return NextResponse.json({ error: "Partner only" }, { status: 403, headers: noStoreHeaders })
    }

    const { data: partnerships } = await supabase.from("partnerships").select("id").eq("partner_id", user.id)
    const partnershipIds = (partnerships || []).map((p) => p.id as string)
    if (partnershipIds.length === 0) {
      return NextResponse.json({ latest: null }, { headers: noStoreHeaders })
    }

    const { data: row, error } = await supabase
      .from("partner_status_updates")
      .select("*")
      .eq("project_id", projectId)
      .in("partnership_id", partnershipIds)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) {
      console.error("[partner/status-update] GET", { message: error.message, code: error.code })
      return NextResponse.json({ error: "Failed to load status" }, { status: 500, headers: noStoreHeaders })
    }

    return NextResponse.json({ latest: row }, { headers: noStoreHeaders })
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

    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single()
    if (profile?.role !== "partner") {
      return NextResponse.json({ error: "Partner only" }, { status: 403, headers: noStoreHeaders })
    }

    const body = parseBody(await req.json().catch(() => null))
    if ("error" in body) {
      return NextResponse.json({ error: body.error }, { status: 400, headers: noStoreHeaders })
    }

    const { data: partnerships } = await supabase.from("partnerships").select("id").eq("partner_id", user.id)
    const partnershipIds = (partnerships || []).map((p) => p.id as string)
    if (partnershipIds.length === 0) {
      return NextResponse.json({ error: "No partnership" }, { status: 403, headers: noStoreHeaders })
    }

    const { data: assignment, error: aErr } = await supabase
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
    if (!assignment) {
      return NextResponse.json(
        { error: "No project assignment for this project and your partnership" },
        { status: 400, headers: noStoreHeaders }
      )
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

    console.log("[api] success", { route: ROUTE, method: "POST", userId: user.id, projectId })
    return NextResponse.json({ update: created }, { headers: noStoreHeaders })
  } catch (e) {
    console.error("[partner/status-update] POST unhandled", e)
    return NextResponse.json({ error: "Failed" }, { status: 500, headers: noStoreHeaders })
  }
}
