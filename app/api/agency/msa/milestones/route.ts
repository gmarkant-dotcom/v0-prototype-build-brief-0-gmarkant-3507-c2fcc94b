import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

const noStore = { "Cache-Control": "private, no-store, no-cache, must-revalidate" } as const

function parseClientBudget(raw: unknown): number | null {
  if (raw == null) return null
  if (typeof raw === "number" && Number.isFinite(raw)) return raw
  if (typeof raw !== "string") return null
  const s = raw.replace(/[$,\s]/g, "").trim()
  if (!s) return null
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : null
}

async function requireAgency(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  const { data: profile, error } = await supabase.from("profiles").select("role").eq("id", userId).single()
  if (error || profile?.role !== "agency") return null
  return profile
}

async function assertProjectOwned(
  supabase: Awaited<ReturnType<typeof createClient>>,
  agencyId: string,
  projectId: string
) {
  const { data, error } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("agency_id", agencyId)
    .maybeSingle()
  if (error || !data) return false
  return true
}

export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStore })

    if (!(await requireAgency(supabase, user.id))) {
      return NextResponse.json({ error: "Agency only" }, { status: 403, headers: noStore })
    }

    // Auth user id must match projects.agency_id under RLS (same JWT as createClient).
    const { data: projectRows, error: projErr } = await supabase
      .from("projects")
      .select("*")
      .eq("agency_id", user.id)
      .order("created_at", { ascending: false })

    // Temporary debug: raw PostgREST outcome for projects (dev or MSA_DEBUG_PROJECTS=1).
    if (process.env.NODE_ENV === "development" || process.env.MSA_DEBUG_PROJECTS === "1") {
      console.log("[api/agency/msa/milestones] DEBUG projects query raw", {
        authUserId: user.id,
        error: projErr
          ? { message: projErr.message, code: projErr.code, details: projErr.details, hint: projErr.hint }
          : null,
        data: projectRows,
        dataRowCount: projectRows?.length ?? 0,
        sampleRowsAgencyId: (projectRows || []).slice(0, 3).map((p) => (p as { agency_id?: string }).agency_id),
      })
    }

    if (projErr) {
      console.error("[api/agency/msa/milestones] projects query failed", {
        message: projErr.message,
        code: projErr.code,
        details: projErr.details,
        hint: projErr.hint,
      })
      return NextResponse.json({ error: "Failed to load projects" }, { status: 500, headers: noStore })
    }

    const projects = projectRows || []
    const agencyProjectIds = projects.map((p) => p.id as string)

    let milestoneRows: Record<string, unknown>[] = []

    if (agencyProjectIds.length > 0) {
      const { data, error: milErr } = await supabase
        .from("payment_milestones")
        .select(
          "id, project_id, partnership_id, response_id, title, amount, currency, due_date, status, notes, paid_at, created_at, updated_at"
        )
        .in("project_id", agencyProjectIds)
        .order("due_date", { ascending: true })
      if (milErr) {
        console.error("[api/agency/msa/milestones] payment_milestones query failed (continuing with empty milestones)", {
          message: milErr.message,
          code: milErr.code,
          details: milErr.details,
          hint: milErr.hint,
        })
        milestoneRows = []
      } else {
        milestoneRows = (data ?? []) as Record<string, unknown>[]
      }
    }

    const milestonesByProject = new Map<string, Record<string, unknown>[]>()
    for (const m of milestoneRows) {
      const pid = m.project_id as string
      const arr = milestonesByProject.get(pid) || []
      arr.push(m)
      milestonesByProject.set(pid, arr)
    }

    let awardedScopes: Array<{
      response_id: string
      project_id: string
      partnership_id: string | null
      scope_item_name: string
      estimated_budget: string | null
      partner_display_name: string
    }> = []

    if (agencyProjectIds.length > 0) {
      const { data: respRows, error: respErr } = await supabase
        .from("partner_rfp_responses")
        .select("id, partner_display_name, inbox_item_id")
        .eq("agency_id", user.id)
        .eq("status", "awarded")

      if (respErr) {
        console.error("[api/agency/msa/milestones] partner_rfp_responses (awarded) query failed", {
          message: respErr.message,
          code: respErr.code,
          details: respErr.details,
          hint: respErr.hint,
        })
        return NextResponse.json({ error: "Failed to load awarded bids" }, { status: 500, headers: noStore })
      }

      const inboxIds = [...new Set((respRows || []).map((r) => r.inbox_item_id as string).filter(Boolean))]
      const inboxById = new Map<
        string,
        {
          project_id: string | null
          partnership_id: string | null
          scope_item_name: string | null
          estimated_budget: string | null
        }
      >()

      if (inboxIds.length > 0) {
        const { data: inboxRows, error: inboxErr } = await supabase
          .from("partner_rfp_inbox")
          .select("id, project_id, partnership_id, scope_item_name, estimated_budget")
          .eq("agency_id", user.id)
          .in("id", inboxIds)

        if (inboxErr) {
          console.error("[api/agency/msa/milestones] partner_rfp_inbox batch for awarded responses failed", {
            message: inboxErr.message,
            code: inboxErr.code,
            details: inboxErr.details,
            hint: inboxErr.hint,
          })
          return NextResponse.json({ error: "Failed to load awarded bids" }, { status: 500, headers: noStore })
        }

        for (const row of inboxRows || []) {
          inboxById.set(row.id as string, {
            project_id: row.project_id != null ? String(row.project_id) : null,
            partnership_id: row.partnership_id != null ? String(row.partnership_id) : null,
            scope_item_name: (row.scope_item_name as string | null) ?? null,
            estimated_budget: (row.estimated_budget as string | null) ?? null,
          })
        }
      }

      for (const r of respRows || []) {
        const ib = inboxById.get(r.inbox_item_id as string)
        const project_id = ib?.project_id ?? null
        if (!project_id || !agencyProjectIds.includes(project_id)) continue
        awardedScopes.push({
          response_id: r.id as string,
          project_id,
          partnership_id: ib?.partnership_id ?? null,
          scope_item_name: (ib?.scope_item_name || "Scope").trim() || "Scope",
          estimated_budget: ib?.estimated_budget ?? null,
          partner_display_name: (r.partner_display_name as string) || "Partner",
        })
      }
    }

    const scopesByProject = new Map<string, typeof awardedScopes>()
    for (const s of awardedScopes) {
      const arr = scopesByProject.get(s.project_id) || []
      arr.push(s)
      scopesByProject.set(s.project_id, arr)
    }

    const payload = projects.map((p) => {
      const pid = p.id as string
      const raw = p as Record<string, unknown>
      const project_name =
        String(raw.title || raw.name || "")
          .trim() || "Untitled project"
      const client_name = (raw.client_name as string | null) ?? null
      const client_budget = parseClientBudget(raw.budget_range)

      const ms = milestonesByProject.get(pid) || []
      const total_milestones_amount = ms.reduce((sum, x) => sum + Number(x.amount ?? 0), 0)
      const total_paid = ms.filter((x) => x.status === "paid").reduce((sum, x) => sum + Number(x.amount ?? 0), 0)
      const total_outstanding = ms.filter((x) => x.status !== "paid").reduce((sum, x) => sum + Number(x.amount ?? 0), 0)

      const budget_alert =
        client_budget != null && total_milestones_amount > client_budget + 1e-9

      return {
        project_id: pid,
        project_name,
        client_name,
        client_budget,
        total_milestones_amount,
        total_paid,
        total_outstanding,
        budget_alert,
        milestones: ms.map((m) => ({
          id: m.id as string,
          project_id: m.project_id as string,
          partnership_id: (m.partnership_id as string | null) ?? null,
          response_id: (m.response_id as string | null) ?? null,
          title: m.title as string,
          amount: Number(m.amount),
          currency: (m.currency as string) || "USD",
          due_date: m.due_date as string,
          status: m.status as string,
          notes: (m.notes as string | null) ?? null,
          paid_at: (m.paid_at as string | null) ?? null,
          created_at: m.created_at as string,
          updated_at: (m.updated_at as string | null) ?? null,
        })),
        awarded_scopes: scopesByProject.get(pid) || [],
      }
    })

    return NextResponse.json({ projects: payload }, { headers: noStore })
  } catch (e) {
    console.error("[api/agency/msa/milestones] GET", e)
    return NextResponse.json({ error: "Failed" }, { status: 500, headers: noStore })
  }
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStore })

    if (!(await requireAgency(supabase, user.id))) {
      return NextResponse.json({ error: "Agency only" }, { status: 403, headers: noStore })
    }

    const body = await req.json().catch(() => ({}))
    const project_id = (body.project_id as string | undefined)?.trim()
    const title = (body.title as string | undefined)?.trim()
    const amount = body.amount
    const currency = ((body.currency as string | undefined)?.trim() || "USD").toUpperCase()
    const due_date = (body.due_date as string | undefined)?.trim()
    const notes = body.notes != null ? String(body.notes).trim() : null
    const partnership_id =
      body.partnership_id != null && String(body.partnership_id).trim() !== ""
        ? String(body.partnership_id).trim()
        : null
    const response_id =
      (body.response_id != null && String(body.response_id).trim() !== ""
        ? String(body.response_id).trim()
        : null) ||
      (body.partner_rfp_response_id != null && String(body.partner_rfp_response_id).trim() !== ""
        ? String(body.partner_rfp_response_id).trim()
        : null)

    if (!project_id || !title || due_date == null || due_date === "") {
      return NextResponse.json(
        { error: "project_id, title, and due_date are required" },
        { status: 400, headers: noStore }
      )
    }
    const amt = typeof amount === "number" ? amount : parseFloat(String(amount))
    if (!Number.isFinite(amt)) {
      return NextResponse.json({ error: "Invalid amount" }, { status: 400, headers: noStore })
    }

    if (!(await assertProjectOwned(supabase, user.id, project_id))) {
      return NextResponse.json({ error: "Project not found" }, { status: 404, headers: noStore })
    }

    if (response_id) {
      const { data: resp, error: rErr } = await supabase
        .from("partner_rfp_responses")
        .select("id, inbox_item_id")
        .eq("id", response_id)
        .eq("agency_id", user.id)
        .eq("status", "awarded")
        .maybeSingle()
      if (rErr || !resp) {
        return NextResponse.json({ error: "Invalid awarded response" }, { status: 400, headers: noStore })
      }
      const { data: inbox } = await supabase
        .from("partner_rfp_inbox")
        .select("project_id")
        .eq("id", resp.inbox_item_id as string)
        .maybeSingle()
      if (!inbox || String(inbox.project_id) !== project_id) {
        return NextResponse.json({ error: "Response does not belong to this project" }, { status: 400, headers: noStore })
      }
    }

    if (partnership_id) {
      const { data: ship } = await supabase
        .from("partnerships")
        .select("id")
        .eq("id", partnership_id)
        .eq("agency_id", user.id)
        .maybeSingle()
      if (!ship) {
        return NextResponse.json({ error: "Invalid partnership" }, { status: 400, headers: noStore })
      }
    }

    const { data: row, error } = await supabase
      .from("payment_milestones")
      .insert({
        agency_id: user.id,
        project_id,
        title,
        amount: amt,
        currency,
        due_date,
        status: "pending",
        notes: notes || null,
        partnership_id,
        response_id,
      })
      .select()
      .single()

    if (error) {
      console.error("[api/agency/msa/milestones] POST", error)
      return NextResponse.json({ error: error.message }, { status: 500, headers: noStore })
    }

    return NextResponse.json({ milestone: row }, { headers: noStore })
  } catch (e) {
    console.error("[api/agency/msa/milestones] POST", e)
    return NextResponse.json({ error: "Failed" }, { status: 500, headers: noStore })
  }
}

export async function PATCH(req: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStore })

    if (!(await requireAgency(supabase, user.id))) {
      return NextResponse.json({ error: "Agency only" }, { status: 403, headers: noStore })
    }

    const body = await req.json().catch(() => ({}))
    const id = (body.id as string | undefined)?.trim()
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400, headers: noStore })

    const { data: agencyProjectRows, error: apErr } = await supabase
      .from("projects")
      .select("id")
      .eq("agency_id", user.id)
    if (apErr) {
      console.error("[api/agency/msa/milestones] PATCH agency projects", apErr)
      return NextResponse.json({ error: "Failed to verify projects" }, { status: 500, headers: noStore })
    }
    const agencyProjectIds = (agencyProjectRows || []).map((p) => p.id as string)
    if (agencyProjectIds.length === 0) {
      return NextResponse.json({ error: "Milestone not found" }, { status: 404, headers: noStore })
    }

    const { data: existing, error: exErr } = await supabase
      .from("payment_milestones")
      .select("id")
      .eq("id", id)
      .in("project_id", agencyProjectIds)
      .maybeSingle()
    if (exErr || !existing) {
      return NextResponse.json({ error: "Milestone not found" }, { status: 404, headers: noStore })
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }

    if (typeof body.title === "string") updates.title = body.title.trim()
    if (body.amount !== undefined) {
      const amt = typeof body.amount === "number" ? body.amount : parseFloat(String(body.amount))
      if (!Number.isFinite(amt)) {
        return NextResponse.json({ error: "Invalid amount" }, { status: 400, headers: noStore })
      }
      updates.amount = amt
    }
    if (typeof body.currency === "string") updates.currency = body.currency.trim().toUpperCase()
    if (typeof body.due_date === "string") updates.due_date = body.due_date.trim()
    if (body.notes !== undefined) updates.notes = body.notes === null ? null : String(body.notes).trim()
    if (typeof body.status === "string") {
      const s = body.status.trim().toLowerCase()
      if (!["pending", "invoiced", "paid"].includes(s)) {
        return NextResponse.json({ error: "Invalid status" }, { status: 400, headers: noStore })
      }
      updates.status = s
      if (s === "paid") {
        updates.paid_at = new Date().toISOString()
      } else {
        updates.paid_at = null
      }
    }

    const { data: row, error } = await supabase
      .from("payment_milestones")
      .update(updates)
      .eq("id", id)
      .in("project_id", agencyProjectIds)
      .select()
      .single()

    if (error) {
      console.error("[api/agency/msa/milestones] PATCH", error)
      return NextResponse.json({ error: error.message }, { status: 500, headers: noStore })
    }

    return NextResponse.json({ milestone: row }, { headers: noStore })
  } catch (e) {
    console.error("[api/agency/msa/milestones] PATCH", e)
    return NextResponse.json({ error: "Failed" }, { status: 500, headers: noStore })
  }
}
