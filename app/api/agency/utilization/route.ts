import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { parseDoubleJson } from "@/lib/active-engagement-parse"

export const dynamic = "force-dynamic"

const noStoreHeaders = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate",
} as const

type BudgetJson = { amount?: number; currency?: string }

function parseBudget(raw: unknown): { amount: number; currency: string } | null {
  const o = parseDoubleJson<BudgetJson>(raw)
  if (!o || o.amount == null || !Number.isFinite(Number(o.amount))) return null
  const currency = typeof o.currency === "string" && o.currency.trim() ? o.currency.trim().toUpperCase() : "USD"
  return { amount: Number(o.amount), currency }
}

/** Parse projects.budget_range: strip $, commas, whitespace; parseFloat. Numbers pass through. */
function parseClientBudget(raw: unknown): number | null {
  if (raw == null) return null
  if (typeof raw === "number" && Number.isFinite(raw)) return raw
  if (typeof raw !== "string") return null
  const s = raw.replace(/[$,\s]/g, "").trim()
  if (!s) return null
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : null
}

/** Project still "active" for engagement stats: no end_date or end_date is today or later (UTC). */
function projectActiveByEndDate(endDate: string | null | undefined): boolean {
  if (endDate == null || String(endDate).trim() === "") return true
  const d = new Date(endDate)
  if (!Number.isFinite(d.getTime())) return true
  const end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  const now = new Date()
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return end >= today
}

function unwrapInbox(
  embed:
    | {
        project_id?: string | null
        partnership_id?: string | null
        scope_item_name?: string | null
        estimated_budget?: string | null
      }
    | null
    | undefined
    | unknown[]
) {
  if (!embed) return null
  const row = Array.isArray(embed) ? embed[0] : embed
  if (!row || typeof row !== "object") return null
  return row as {
    project_id?: string | null
    partnership_id?: string | null
    scope_item_name?: string | null
    estimated_budget?: string | null
  }
}

export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStoreHeaders })
    }

    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single()
    if (profileErr || profile?.role !== "agency") {
      return NextResponse.json({ error: "Agency only" }, { status: 403, headers: noStoreHeaders })
    }

    const { data: respRows, error: respErr } = await supabase
      .from("partner_rfp_responses")
      .select(
        `
        id,
        budget_proposal,
        partner_rfp_inbox (
          project_id,
          partnership_id,
          scope_item_name,
          estimated_budget
        )
      `
      )
      .eq("agency_id", user.id)
      .eq("status", "awarded")

    if (respErr) {
      console.error("[api/agency/utilization] responses", respErr)
      return NextResponse.json({ error: "Failed to load utilization data" }, { status: 500, headers: noStoreHeaders })
    }

    const rows = respRows || []
    const projectIds = new Set<string>()
    for (const r of rows) {
      const inbox = unwrapInbox(r.partner_rfp_inbox as Parameters<typeof unwrapInbox>[0])
      const pid = inbox?.project_id
      if (pid) projectIds.add(String(pid))
    }

    type ProjectMeta = {
      name: string
      client_name: string | null
      client_budget: number | null
      start_date: string | null
      end_date: string | null
    }
    let projectMeta = new Map<string, ProjectMeta>()
    if (projectIds.size > 0) {
      const { data: projects, error: projErr } = await supabase
        .from("projects")
        .select("id, name, client_name, budget_range, start_date, end_date")
        .eq("agency_id", user.id)
        .in("id", [...projectIds])

      if (projErr) {
        console.error("[api/agency/utilization] projects", projErr)
        return NextResponse.json({ error: "Failed to load projects" }, { status: 500, headers: noStoreHeaders })
      }
      for (const p of projects || []) {
        const id = p.id as string
        const name = ((p as { name?: string | null }).name || "").trim() || "Untitled project"
        const client_name = ((p as { client_name?: string | null }).client_name ?? null) as string | null
        const client_budget = parseClientBudget((p as { budget_range?: unknown }).budget_range)
        const rawStart = (p as { start_date?: string | null }).start_date
        const rawEnd = (p as { end_date?: string | null }).end_date
        const start_date =
          rawStart != null && String(rawStart).trim() !== "" ? String(rawStart) : null
        const end_date = rawEnd != null && String(rawEnd).trim() !== "" ? String(rawEnd) : null
        projectMeta.set(id, { name, client_name, client_budget, start_date, end_date })
      }
    }

    const pairKeys = new Set<string>()
    for (const r of rows) {
      const inbox = unwrapInbox(r.partner_rfp_inbox as Parameters<typeof unwrapInbox>[0])
      if (!inbox?.project_id || !inbox.partnership_id) continue
      const projectId = String(inbox.project_id)
      if (!projectMeta.has(projectId)) continue
      pairKeys.add(`${projectId}:${String(inbox.partnership_id)}`)
    }

    const assignmentByPair = new Map<string, string>()
    if (pairKeys.size > 0 && projectIds.size > 0) {
      const { data: asgRows, error: asgErr } = await supabase
        .from("project_assignments")
        .select("id, project_id, partnership_id, status")
        .in("project_id", [...projectIds])
        .eq("status", "awarded")

      if (asgErr) {
        console.error("[api/agency/utilization] assignments", asgErr)
      } else {
        for (const a of asgRows || []) {
          const pid = a.project_id as string
          const pship = a.partnership_id as string
          assignmentByPair.set(`${pid}:${pship}`, a.id as string)
        }
      }
    }

    const assignmentIdsForStatus = new Set<string>()
    type ScopeOut = {
      response_id: string
      scope_item_name: string
      estimated_amount: number | null
      awarded_amount: number | null
      currency: string
      variance: number | null
      project_assignment_id: string | null
      partner_completion_pct: number | null
    }

    const byProject = new Map<string, ScopeOut[]>()

    for (const r of rows) {
      const inbox = unwrapInbox(r.partner_rfp_inbox as Parameters<typeof unwrapInbox>[0])
      if (!inbox?.project_id) continue
      const projectId = String(inbox.project_id)
      if (!projectMeta.has(projectId)) continue

      const partnershipId = inbox.partnership_id != null ? String(inbox.partnership_id) : null
      const project_assignment_id =
        partnershipId != null ? assignmentByPair.get(`${projectId}:${partnershipId}`) ?? null : null
      if (project_assignment_id) assignmentIdsForStatus.add(project_assignment_id)

      const est = parseBudget(inbox.estimated_budget)
      const awd = parseBudget((r as { budget_proposal?: unknown }).budget_proposal)

      const currency = awd?.currency ?? est?.currency ?? "USD"
      const estimated_amount = est?.amount ?? null
      const awarded_amount = awd?.amount ?? null

      let variance: number | null = null
      if (estimated_amount != null && awarded_amount != null) {
        variance = estimated_amount - awarded_amount
      }

      const scope: ScopeOut = {
        response_id: String((r as { id: string }).id),
        scope_item_name: (inbox.scope_item_name || "").trim() || "Scope",
        estimated_amount,
        awarded_amount,
        currency,
        variance,
        project_assignment_id,
        partner_completion_pct: null,
      }

      const list = byProject.get(projectId) || []
      list.push(scope)
      byProject.set(projectId, list)
    }

    const latestCompletionByAssignment = new Map<string, number | null>()
    if (assignmentIdsForStatus.size > 0) {
      const { data: statusRows, error: stErr } = await supabase
        .from("partner_status_updates")
        .select("project_assignment_id, completion_pct, created_at")
        .in("project_assignment_id", [...assignmentIdsForStatus])
        .order("created_at", { ascending: false })

      if (stErr) {
        console.error("[api/agency/utilization] partner_status_updates", stErr)
      } else {
        for (const row of statusRows || []) {
          const aid = row.project_assignment_id as string
          if (!latestCompletionByAssignment.has(aid)) {
            const pct = row.completion_pct
            latestCompletionByAssignment.set(
              aid,
              typeof pct === "number" && Number.isFinite(pct) ? Math.round(pct) : null
            )
          }
        }
      }
    }

    for (const [, scopes] of byProject) {
      for (const s of scopes) {
        if (s.project_assignment_id) {
          s.partner_completion_pct = latestCompletionByAssignment.has(s.project_assignment_id)
            ? (latestCompletionByAssignment.get(s.project_assignment_id) ?? null)
            : null
        }
      }
    }

    type ProjectOut = {
      project_id: string
      project_name: string
      client_name: string | null
      client_budget: number | null
      start_date: string | null
      end_date: string | null
      scopes: ScopeOut[]
      total_awarded: number
      currency: string
      mixed_currency: boolean
    }

    const projects: ProjectOut[] = []

    for (const [projectId, scopes] of byProject) {
      const meta = projectMeta.get(projectId)
      if (!meta) continue

      const currencies = new Set(scopes.map((s) => s.currency))
      const mixed_currency = currencies.size > 1
      const currency = mixed_currency ? "MIXED" : scopes[0]?.currency ?? "USD"

      const total_awarded = scopes.reduce((sum, s) => sum + (s.awarded_amount ?? 0), 0)

      projects.push({
        project_id: projectId,
        project_name: meta.name,
        client_name: meta.client_name,
        client_budget: meta.client_budget,
        start_date: meta.start_date,
        end_date: meta.end_date,
        scopes,
        total_awarded,
        currency,
        mixed_currency,
      })
    }

    projects.sort((a, b) => a.project_name.localeCompare(b.project_name))

    const currencyBuckets = new Map<string, { total_awarded: number }>()
    for (const p of projects) {
      for (const s of p.scopes) {
        const cur = s.currency
        const b = currencyBuckets.get(cur) || { total_awarded: 0 }
        if (s.awarded_amount != null) b.total_awarded += s.awarded_amount
        currencyBuckets.set(cur, b)
      }
    }

    const by_currency = [...currencyBuckets.entries()]
      .map(([currency, v]) => ({
        currency,
        total_awarded: v.total_awarded,
      }))
      .sort((a, b) => a.currency.localeCompare(b.currency))

    const mixed_currencies = currencyBuckets.size > 1
    const primary = by_currency[0]
    const hasAwardData = by_currency.length > 0

    let total_client_budget: number | null = null
    let sumCb = 0
    let anyCb = false
    for (const p of projects) {
      if (p.client_budget != null) {
        sumCb += p.client_budget
        anyCb = true
      }
    }
    if (anyCb) total_client_budget = sumCb

    const total_awarded_all = projects.reduce((s, p) => s + p.total_awarded, 0)

    /** Distinct partnership_ids with ≥1 awarded response on a project that has not passed end_date. */
    const activeEngagedPartnershipIds = new Set<string>()
    for (const r of rows) {
      const inbox = unwrapInbox(r.partner_rfp_inbox as Parameters<typeof unwrapInbox>[0])
      if (!inbox?.project_id || !inbox.partnership_id) continue
      const projectId = String(inbox.project_id)
      const meta = projectMeta.get(projectId)
      if (!meta) continue
      if (!projectActiveByEndDate(meta.end_date)) continue
      activeEngagedPartnershipIds.add(String(inbox.partnership_id))
    }
    const partners_with_active_engagements = activeEngagedPartnershipIds.size

    const summary = {
      total_client_budget,
      total_awarded:
        !hasAwardData ? null : mixed_currencies ? null : primary?.total_awarded ?? null,
      total_awarded_all,
      total_margin:
        total_client_budget == null ? null : total_client_budget - total_awarded_all,
      currency: !hasAwardData ? null : mixed_currencies ? null : primary?.currency ?? null,
      mixed_currencies: hasAwardData && mixed_currencies,
      by_currency,
      partners_with_active_engagements,
    }

    return NextResponse.json({ projects, summary }, { headers: noStoreHeaders })
  } catch (e) {
    console.error("[api/agency/utilization]", e)
    return NextResponse.json({ error: "Failed" }, { status: 500, headers: noStoreHeaders })
  }
}
