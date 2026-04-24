import { type NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { parseDoubleJson } from '@/lib/active-engagement-parse'

export const dynamic = 'force-dynamic'

type BudgetJson = { amount?: number; currency?: string }

/** Same as /api/agency/utilization: JSON / double-encoded budget_proposal → amount + currency. */
function parsePartnerBudgetProposal(raw: unknown): { amount: number; currency: string } | null {
  const o = parseDoubleJson<BudgetJson>(raw)
  if (!o || o.amount == null || !Number.isFinite(Number(o.amount))) return null
  const currency =
    typeof o.currency === 'string' && o.currency.trim() ? o.currency.trim().toUpperCase() : 'USD'
  return { amount: Number(o.amount), currency }
}

/** Same as /api/agency/utilization: projects.budget_range → number. */
function parseClientBudget(raw: unknown): number | null {
  if (raw == null) return null
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw !== 'string') return null
  const s = raw.replace(/[$,\s]/g, '').trim()
  if (!s) return null
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : null
}

/** Active engagement: project has no end_date or end_date is today or later (UTC date). */
function projectActiveByEndDate(endDate: string | null | undefined): boolean {
  if (endDate == null || String(endDate).trim() === '') return true
  const d = new Date(endDate)
  if (!Number.isFinite(d.getTime())) return true
  const end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  const now = new Date()
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return end >= today
}

function inboxEmbedProjectId(raw: unknown): string | null {
  if (!raw) return null
  const ib = Array.isArray(raw) ? raw[0] : raw
  if (!ib || typeof ib !== 'object') return null
  const pid = (ib as { project_id?: string | null }).project_id
  return pid ? String(pid) : null
}

const noStoreHeaders = {
  'Cache-Control': 'private, no-store, no-cache, must-revalidate',
} as const

const PARTNER_ALERT_EXCLUDED_STATUSES = new Set(['on_track', 'complete'])

function unwrapAssignmentRows(raw: unknown): { status?: string }[] {
  if (!raw) return []
  const arr = Array.isArray(raw) ? raw : [raw]
  return arr.filter((a) => a && typeof a === 'object') as { status?: string }[]
}

function dashboardWorkflowForProject(
  projectId: string,
  hasAwarded: boolean,
  bidProjectIds: Set<string>,
  inboxProjectIds: Set<string>
): { key: string; label: string } {
  if (hasAwarded) return { key: 'active_engagements', label: 'Active Engagements' }
  if (bidProjectIds.has(projectId)) return { key: 'bid_management', label: 'Bid Management' }
  if (inboxProjectIds.has(projectId)) return { key: 'rfp_broadcast', label: 'RFP Broadcast' }
  return { key: 'setup', label: 'Setup' }
}

/** TEMP: verbose PostgREST / Supabase error logging for debugging 500s on GET /api/projects */
function logSupabaseError(label: string, err: unknown) {
  const e = err as {
    message?: string
    code?: string
    details?: string
    hint?: string
  }
  console.error(`[api/projects] ${label}`, {
    message: e?.message ?? (err instanceof Error ? err.message : String(err)),
    code: e?.code,
    details: e?.details,
    hint: e?.hint,
    full: err,
  })
}

// GET - List projects for current user
export async function GET(request: NextRequest) {
  try {
    const route = '/api/projects'
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()
    console.log('[api] start', { route, method: 'GET', userId: user.id, role: profile?.role ?? null })

    let projects
    let partnerStatusAlertTotal: number | undefined
    let agencyDashboardStats:
      | {
          total_unique_clients: number
          total_active_engagements: number
          total_awarded_engagements: number
          total_client_budget: number | null
          total_partner_spend_usd: number
        }
      | undefined

    if (profile?.role === 'agency') {
      // Try rich query first (with relationships), then fallback to plain projects query.
      const rich = await supabase
        .from('projects')
        .select(`
          *,
          project_assignments(
            id,
            status,
            partnership:partnerships(
              partner:profiles!partnerships_partner_id_fkey(
                id, company_name, full_name
              )
            )
          )
        `)
        .eq('agency_id', user.id)
        .order('created_at', { ascending: false })

      if (!rich.error) {
        projects = rich.data
      } else {
        console.error(
          '[api/projects] agency GET rich query failed (falling back to simple projects select)',
          JSON.stringify(rich.error)
        )
        const simple = await supabase
          .from('projects')
          .select('*')
          .eq('agency_id', user.id)
          .order('created_at', { ascending: false })

        if (simple.error) {
          console.error('[api/projects] agency GET simple projects query failed', JSON.stringify(simple.error))
          throw simple.error
        }
        projects = simple.data
      }

      const agencyProjectIds = (projects || []).map((p: { id: string }) => p.id).filter(Boolean)

      const projectIdsWithAwarded = new Set<string>()
      for (const p of projects || []) {
        const row = p as { id?: string; project_assignments?: unknown }
        const pid = String(row.id || '')
        if (!pid) continue
        const assigns = unwrapAssignmentRows(row.project_assignments)
        if (assigns.some((a) => a.status === 'awarded')) projectIdsWithAwarded.add(pid)
      }

      const inboxProjectIds = new Set<string>()
      const bidProjectIds = new Set<string>()
      if (agencyProjectIds.length > 0) {
        const { data: inboxRows } = await supabase
          .from('partner_rfp_inbox')
          .select('project_id')
          .eq('agency_id', user.id)
          .in('project_id', agencyProjectIds)

        for (const r of inboxRows || []) {
          const pid = r.project_id as string | null
          if (pid) inboxProjectIds.add(pid)
        }

        const { data: responseRows } = await supabase
          .from('partner_rfp_responses')
          .select('status, partner_rfp_inbox(project_id)')
          .eq('agency_id', user.id)
          .neq('status', 'draft')

        const idSet = new Set(agencyProjectIds)
        for (const resp of responseRows || []) {
          const inbox = resp.partner_rfp_inbox as
            | { project_id?: string | null }
            | { project_id?: string | null }[]
            | null
          const ib = Array.isArray(inbox) ? inbox[0] : inbox
          const projId = ib?.project_id
          if (projId && idSet.has(projId)) bidProjectIds.add(projId)
        }
      }

      const countByProject = new Map<string, number>()
      const firstByProject = new Map<
        string,
        {
          project_id: string
          status: string
          budget_status: string
          completion_pct: number
          notes: string | null
          created_at: string
        }
      >()
      if (agencyProjectIds.length > 0) {
        const { data: psuRows, error: psuErr } = await supabase
          .from('partner_status_updates')
          .select('project_id, status, budget_status, completion_pct, notes, created_at')
          .in('project_id', agencyProjectIds)
          .eq('is_resolved', false)
          .order('created_at', { ascending: false })

        const alertRows = (psuRows || []).filter(
          (r) => !PARTNER_ALERT_EXCLUDED_STATUSES.has(String(r.status || ''))
        )

        if (psuErr) {
          logSupabaseError('agency GET partner_status_updates query failed', psuErr)
        }
        if (!psuErr && alertRows.length) {
          for (const row of alertRows) {
            const pid = row.project_id as string
            countByProject.set(pid, (countByProject.get(pid) || 0) + 1)
            if (!firstByProject.has(pid)) firstByProject.set(pid, row)
          }
        }
      }
      partnerStatusAlertTotal = Array.from(countByProject.values()).reduce((a, b) => a + b, 0)
      projects = (projects || []).map((p: Record<string, unknown>) => {
        const pid = p.id as string
        const first = firstByProject.get(pid)
        const notes = (first?.notes as string | null) || ''
        const wf = dashboardWorkflowForProject(
          pid,
          projectIdsWithAwarded.has(pid),
          bidProjectIds,
          inboxProjectIds
        )
        const alertCount = countByProject.get(pid) ?? 0
        return {
          ...p,
          dashboard_workflow_stage: wf.key,
          dashboard_workflow_label: wf.label,
          partner_status_alert_count: alertCount,
          partner_status_alert_preview: first
            ? {
                status: first.status,
                budget_status: first.budget_status,
                completion_pct: first.completion_pct,
                notes_preview: notes.length > 120 ? `${notes.slice(0, 120)}…` : notes || null,
                created_at: first.created_at,
              }
            : null,
        }
      })
      console.log(
        '[api/projects] partner_status_alert_count per project',
        (projects as { id: string; partner_status_alert_count?: number }[]).map((row) => ({
          id: row.id,
          partner_status_alert_count: row.partner_status_alert_count ?? 0,
        }))
      )

      const clientNameSet = new Set<string>()
      let clientBudgetSum = 0
      let anyClientBudget = false
      for (const p of projects || []) {
        const row = p as { client_name?: string | null; budget_range?: unknown }
        const cn = String(row.client_name ?? '').trim()
        if (cn) clientNameSet.add(cn)
        const b = parseClientBudget(row.budget_range)
        if (b != null) {
          clientBudgetSum += b
          anyClientBudget = true
        }
      }

      let total_awarded_engagements = 0
      let total_active_engagements = 0
      const agencyProjectIdSet = new Set(agencyProjectIds)
      const { data: engagementRespRows, error: engErr } = await supabase
        .from('partner_rfp_responses')
        .select('partner_rfp_inbox(project_id)')
        .eq('agency_id', user.id)
        .eq('status', 'awarded')

      if (engErr) {
        logSupabaseError('agency GET awarded partner_rfp_responses for engagement stats', engErr)
      } else {
        const projectIdPerResponse: string[] = []
        for (const r of engagementRespRows || []) {
          const pid = inboxEmbedProjectId((r as { partner_rfp_inbox?: unknown }).partner_rfp_inbox)
          if (!pid || !agencyProjectIdSet.has(pid)) continue
          projectIdPerResponse.push(pid)
          total_awarded_engagements++
        }

        const uniqueForDates = [...new Set(projectIdPerResponse)]
        if (uniqueForDates.length > 0) {
          const { data: projRows, error: peErr } = await supabase
            .from('projects')
            .select('id, end_date')
            .eq('agency_id', user.id)
            .in('id', uniqueForDates)

          const endDateByProject = new Map<string, string | null>()
          if (peErr) {
            logSupabaseError('agency GET projects end_date for engagement stats', peErr)
            total_active_engagements = total_awarded_engagements
          } else {
            for (const pr of projRows || []) {
              endDateByProject.set(String(pr.id), (pr.end_date as string | null) ?? null)
            }
            for (const pid of projectIdPerResponse) {
              if (projectActiveByEndDate(endDateByProject.get(pid))) total_active_engagements++
            }
          }
        }
      }

      let total_partner_spend_usd = 0
      const { data: spendRows, error: spendErr } = await supabase
        .from('partner_rfp_responses')
        .select('budget_proposal')
        .eq('agency_id', user.id)
        .eq('status', 'awarded')
      if (spendErr) {
        logSupabaseError('agency GET awarded partner_rfp_responses for dashboard spend', spendErr)
      } else {
        for (const r of spendRows || []) {
          const parsed = parsePartnerBudgetProposal((r as { budget_proposal?: unknown }).budget_proposal)
          if (parsed) total_partner_spend_usd += parsed.amount
        }
      }

      agencyDashboardStats = {
        total_unique_clients: clientNameSet.size,
        total_active_engagements,
        total_awarded_engagements,
        total_client_budget: anyClientBudget ? clientBudgetSum : null,
        total_partner_spend_usd,
      }
    } else if (profile?.role === 'partner') {
      const { data: userPartnerships, error: pErr } = await supabase
        .from('partnerships')
        .select('id')
        .eq('partner_id', user.id)

      if (pErr) throw pErr

      const partnershipIds = (userPartnerships || []).map((r) => r.id)
      if (partnershipIds.length === 0) {
        console.log('[api] success', { route, method: 'GET', userId: user.id, role: profile?.role ?? null, rowCount: 0 })
        return NextResponse.json({ projects: [] }, { headers: noStoreHeaders })
      }

      const { data, error } = await supabase
        .from('project_assignments')
        .select(`
          id,
          status,
          created_at,
          project:projects(
            *,
            agency:profiles!projects_agency_id_fkey(
              id, company_name, full_name
            )
          )
        `)
        .in('partnership_id', partnershipIds)
        .order('created_at', { ascending: false })

      if (error) throw error

      projects = (data || [])
        .map((a) => {
          const row = a as {
            id: string
            status: string
            created_at: string
            project: unknown
          }
          const pr = row.project
          const proj = (Array.isArray(pr) ? pr[0] : pr) as Record<string, unknown> | null | undefined
          if (!proj || typeof proj !== 'object') return null
          const ag = proj.agency
          const agency = (Array.isArray(ag) ? ag[0] : ag) as
            | { company_name?: string | null; full_name?: string | null }
            | null
            | undefined
          const titleRaw = (proj.title ?? proj.name ?? '') as string
          const title = String(titleRaw).trim() || 'Untitled project'
          return {
            id: proj.id as string,
            title,
            name: title,
            client_name: (proj.client_name as string | null) ?? null,
            status: proj.status as string,
            agency: agency
              ? {
                  company_name: agency.company_name ?? null,
                  full_name: agency.full_name ?? null,
                }
              : null,
            assignment: {
              id: row.id,
              status: row.status,
              invited_at: row.created_at,
              responded_at: null as string | null,
            },
          }
        })
        .filter(Boolean)
    } else {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    console.log('[api] success', { route, method: 'GET', userId: user.id, role: profile?.role ?? null, rowCount: Array.isArray(projects) ? projects.length : 0 })
    return NextResponse.json(
      {
        projects,
        ...(partnerStatusAlertTotal !== undefined ? { partner_status_alert_total: partnerStatusAlertTotal } : {}),
        ...(agencyDashboardStats !== undefined ? { agency_dashboard_stats: agencyDashboardStats } : {}),
      },
      { headers: noStoreHeaders }
    )
  } catch (error) {
    console.error('[api] failure GET /api/projects detailed', {
      isError: error instanceof Error,
      message: error instanceof Error ? error.message : String(error),
      stringified: JSON.stringify(error),
      keys: error && typeof error === 'object' ? Object.keys(error as object) : [],
    })
    return NextResponse.json({ error: 'Failed to fetch projects' }, { status: 500, headers: noStoreHeaders })
  }
}

// POST - Create a new project (agency only)
export async function POST(request: NextRequest) {
  try {
    const route = '/api/projects'
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role, is_paid, is_admin')
      .eq('id', user.id)
      .single()
    console.log('[api] start', { route, method: 'POST', userId: user.id, role: profile?.role ?? null })

    if (profile?.role !== 'agency') {
      return NextResponse.json({ error: 'Only agencies can create projects' }, { status: 403 })
    }

    const isDemo = process.env.NEXT_PUBLIC_IS_DEMO === 'true'
    if (!isDemo && !profile?.is_paid && !profile?.is_admin) {
      return NextResponse.json({ error: 'Active subscription required' }, { status: 403 })
    }

    const body = await request.json()
    const { name, clientName, description, budgetRange, startDate, endDate } = body

    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'Project name required' }, { status: 400 })
    }

    const safeName = name.trim()
    const activeStatusesForWarning = ["active", "open", "in_progress", "bidding", "onboarding"]
    const { data: existingNamedProjects, error: existingNamedProjectsError } = await supabase
      .from("projects")
      .select("id")
      .eq("agency_id", user.id)
      .ilike("name", safeName)
      .in("status", activeStatusesForWarning)

    if (existingNamedProjectsError) {
      console.warn("[api/projects] duplicate-name warning check failed", {
        message: existingNamedProjectsError.message,
        code: existingNamedProjectsError.code,
      })
    } else if ((existingNamedProjects || []).length > 0) {
      return NextResponse.json({ error: "A project with this name already exists" }, { status: 409 })
    }

    const insertPayload: Record<string, unknown> = {
      agency_id: user.id,
      name: safeName,
      status: 'draft',
      client_name: clientName || null,
      description: description || null,
      budget_range: budgetRange || null,
      start_date: startDate || null,
      end_date: endDate || null,
    }

    const { data: project, error: insertError } = await supabase
      .from('projects')
      .insert(insertPayload)
      .select('*')
      .single()

    if (insertError || !project) {
      const msg = insertError?.message || insertError?.details || insertError?.hint || 'Project creation failed'
      throw new Error(String(msg))
    }

    console.log('[api] success', { route, method: 'POST', userId: user.id, role: profile?.role ?? null, recordId: project.id })
    return NextResponse.json({ project })
  } catch (error) {
    console.error('[api] failure', {
      route: '/api/projects',
      method: 'POST',
      code: 500,
      message: error instanceof Error ? error.message : String(error),
    })
    const message =
      (error as any)?.message ||
      (error as any)?.details ||
      (error as any)?.hint ||
      'Failed to create project'
    return NextResponse.json({ error: String(message) }, { status: 500 })
  }
}
