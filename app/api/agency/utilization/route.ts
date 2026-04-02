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

function unwrapInbox(
  embed: { project_id?: string | null; scope_item_name?: string | null; estimated_budget?: string | null } | null | undefined | unknown[]
) {
  if (!embed) return null
  const row = Array.isArray(embed) ? embed[0] : embed
  if (!row || typeof row !== "object") return null
  return row as {
    project_id?: string | null
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

    let projectMeta = new Map<string, { name: string; client_name: string | null }>()
    if (projectIds.size > 0) {
      const { data: projects, error: projErr } = await supabase
        .from("projects")
        .select("id, name, client_name")
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
        projectMeta.set(id, { name, client_name })
      }
    }

    type ScopeOut = {
      response_id: string
      scope_item_name: string
      estimated_amount: number | null
      awarded_amount: number | null
      currency: string
      variance: number | null
    }

    type ProjectOut = {
      project_id: string
      project_name: string
      client_name: string | null
      scopes: ScopeOut[]
      total_estimated: number
      total_awarded: number
      total_variance: number
      currency: string
      mixed_currency: boolean
    }

    const byProject = new Map<string, ScopeOut[]>()

    for (const r of rows) {
      const inbox = unwrapInbox(r.partner_rfp_inbox as Parameters<typeof unwrapInbox>[0])
      if (!inbox?.project_id) continue
      const projectId = String(inbox.project_id)
      if (!projectMeta.has(projectId)) continue

      const est = parseBudget(inbox.estimated_budget)
      const awd = parseBudget((r as { budget_proposal?: unknown }).budget_proposal)

      let currency = awd?.currency ?? est?.currency ?? "USD"
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
      }

      const list = byProject.get(projectId) || []
      list.push(scope)
      byProject.set(projectId, list)
    }

    const projects: ProjectOut[] = []

    for (const [projectId, scopes] of byProject) {
      const meta = projectMeta.get(projectId)
      if (!meta) continue

      const currencies = new Set(scopes.map((s) => s.currency))
      const mixed_currency = currencies.size > 1
      const currency = mixed_currency ? "MIXED" : scopes[0]?.currency ?? "USD"

      const total_estimated = scopes.reduce((sum, s) => sum + (s.estimated_amount ?? 0), 0)
      const total_awarded = scopes.reduce((sum, s) => sum + (s.awarded_amount ?? 0), 0)
      const total_variance = total_estimated - total_awarded

      projects.push({
        project_id: projectId,
        project_name: meta.name,
        client_name: meta.client_name,
        scopes,
        total_estimated,
        total_awarded,
        total_variance,
        currency,
        mixed_currency,
      })
    }

    projects.sort((a, b) => a.project_name.localeCompare(b.project_name))

    const currencyBuckets = new Map<string, { total_estimated: number; total_awarded: number }>()
    for (const p of projects) {
      for (const s of p.scopes) {
        const cur = s.currency
        const b = currencyBuckets.get(cur) || { total_estimated: 0, total_awarded: 0 }
        if (s.estimated_amount != null) b.total_estimated += s.estimated_amount
        if (s.awarded_amount != null) b.total_awarded += s.awarded_amount
        currencyBuckets.set(cur, b)
      }
    }

    const by_currency = [...currencyBuckets.entries()]
      .map(([currency, v]) => ({
        currency,
        total_estimated: v.total_estimated,
        total_awarded: v.total_awarded,
        total_remaining: v.total_estimated - v.total_awarded,
      }))
      .sort((a, b) => a.currency.localeCompare(b.currency))

    const mixed_currencies = currencyBuckets.size > 1
    const primary = by_currency[0]
    const hasData = by_currency.length > 0
    const summary = {
      total_estimated:
        !hasData ? null : mixed_currencies ? null : primary?.total_estimated ?? null,
      total_awarded: !hasData ? null : mixed_currencies ? null : primary?.total_awarded ?? null,
      total_remaining:
        !hasData ? null : mixed_currencies ? null : (primary?.total_estimated ?? 0) - (primary?.total_awarded ?? 0),
      currency: !hasData ? null : mixed_currencies ? null : primary?.currency ?? null,
      mixed_currencies: hasData && mixed_currencies,
      by_currency,
    }

    return NextResponse.json({ projects, summary }, { headers: noStoreHeaders })
  } catch (e) {
    console.error("[api/agency/utilization]", e)
    return NextResponse.json({ error: "Failed" }, { status: 500, headers: noStoreHeaders })
  }
}
