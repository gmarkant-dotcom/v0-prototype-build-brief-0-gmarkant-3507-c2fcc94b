import { type NextRequest, NextResponse } from 'next/server'
import { reconcileProjectClientFields } from '@/lib/clients-server'
import { createClient } from '@/lib/supabase/server'
import {
  ORG_CONTACT_SELECT,
  orgWireShape,
  logOrgContactGap,
  resolveOrgContact,
  unwrapOne,
  type OrgEmbed,
} from '@/lib/org-contact'
import { parseDoubleJson } from '@/lib/active-engagement-parse'
import { checkUsageLimit, usageLimitResponse } from '@/lib/usage-tracking'
import { actingRole, canActAs } from '@/lib/acting-role'
import { agencyEntitlementId, hasAgencyEntitlement, resolveCallerOrgIds, resolveCallerWriteOrgId } from "@/lib/entitlements"
import { recordMilestone } from "@/lib/milestone-events"
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

/**
 * 079-EMBED. Fold the two-hop organizations embed back onto the `partner` key the wire
 * shape has always used, so no consumer of GET /api/projects moves. Both nulls are
 * possible and both are logged: a null organization (missing foreign key, or row level
 * security) and a null primary contact. See lib/org-contact.ts.
 */
function normalizeAssignmentPartners(project: Record<string, unknown>): Record<string, unknown> {
  const raw = project.project_assignments
  if (!raw) return project
  const rows = Array.isArray(raw) ? raw : [raw]
  const assignments = rows.map((a) => {
    const row = (a || {}) as Record<string, unknown>
    const pship = unwrapOne(row.partnership as Record<string, unknown> | Record<string, unknown>[] | null)
    if (!pship) return row
    const { vendor_org: embed, ...restPship } = pship
    const contact = resolveOrgContact(embed as OrgEmbed, null)
    if (pship.vendor_org_id) {
      logOrgContactGap('GET /api/projects (agency)', contact, {
        projectId: project.id,
        vendorOrgId: pship.vendor_org_id,
      })
    }
    return { ...row, partnership: { ...restPship, vendor_org: orgWireShape(embed as OrgEmbed, null) } }
  })
  return { ...project, project_assignments: assignments }
}

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

    // 079: an organization column is not a user id. Reads scope to the caller's memberships.
    const callerOrgIds = await resolveCallerOrgIds(user.id, supabase)

    // Acting role, not signup role - see lib/acting-role.ts. A dual-role vendor carrying
    // role='agency' was being served the agency project list in the vendor portal.
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, active_role')
      .eq('id', user.id)
      .single()
    const acting = actingRole(profile)
    console.log('[api] start', { route, method: 'GET', userId: user.id, role: profile?.role ?? null, acting })

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

    if (acting === 'agency') {
      // Try rich query first (with relationships), then fallback to plain projects query.
      const rich = await supabase
        // 079-EMBED: rewritten from `partner:profiles!partnerships_partner_id_fkey(...)`.
        // Four embed levels deep (projects -> project_assignments -> partnerships ->
        // organizations -> profiles); four-level nesting was proved against the live
        // database read-only on 2026-08-17 before this was written. Nothing in the
        // application reads this partner today - only `status` is used, both here and by
        // every consumer of the response - but the payload key is normalized back to
        // `partner` below anyway, so a future reader finds the shape it expects.
        .from('projects')
        .select(`
          *,
          project_assignments(
            id,
            status,
            partnership:partnerships(
              vendor_org_id,
              vendor_org:organizations!vendor_org_id(${ORG_CONTACT_SELECT})
            )
          )
        `)
        .in('org_id', callerOrgIds)
        .order('created_at', { ascending: false })

      if (!rich.error) {
        projects = (rich.data || []).map((row) => normalizeAssignmentPartners(row as Record<string, unknown>))
      } else {
        console.error(
          '[api/projects] agency GET rich query failed (falling back to simple projects select)',
          JSON.stringify(rich.error)
        )
        const simple = await supabase
          .from('projects')
          .select('*')
          .in('org_id', callerOrgIds)
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
        const [inboxResult, responseResult] = await Promise.all([
          supabase
            .from('partner_rfp_inbox')
            .select('project_id')
            .in('lead_org_id', callerOrgIds)
            .in('project_id', agencyProjectIds),
          supabase
            .from('partner_rfp_responses')
            .select('status, partner_rfp_inbox(project_id)')
            .in('lead_org_id', callerOrgIds)
            .neq('status', 'draft'),
        ])

        for (const r of inboxResult.data || []) {
          const pid = r.project_id as string | null
          if (pid) inboxProjectIds.add(pid)
        }

        const idSet = new Set(agencyProjectIds)
        for (const resp of responseResult.data || []) {
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
        (projects as unknown as { id: string; partner_status_alert_count?: number }[]).map((row) => ({
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

      let total_partner_spend_usd = 0
      const [engagementResult, spendResult] = await Promise.all([
        supabase
          .from('partner_rfp_responses')
          .select('partner_rfp_inbox(project_id)')
          .in('lead_org_id', callerOrgIds)
          .eq('status', 'awarded'),
        supabase
          .from('partner_rfp_responses')
          .select('budget_proposal')
          .in('lead_org_id', callerOrgIds)
          .eq('status', 'awarded'),
      ])

      // Process engagement stats from engagementResult
      let total_awarded_engagements = 0
      let total_active_engagements = 0
      const agencyProjectIdSet = new Set(agencyProjectIds)
      if (engagementResult.error) {
        logSupabaseError('agency GET awarded partner_rfp_responses for engagement stats', engagementResult.error)
      } else {
        const projectIdPerResponse: string[] = []
        for (const r of engagementResult.data || []) {
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
            .in('org_id', callerOrgIds)
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

      // Process spend from spendResult
      if (spendResult.error) {
        logSupabaseError('agency GET awarded partner_rfp_responses for dashboard spend', spendResult.error)
      } else {
        for (const r of spendResult.data || []) {
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
    } else if (acting === 'partner') {
      const { data: userPartnerships, error: pErr } = await supabase
        .from('partnerships')
        .select('id')
        .in('vendor_org_id', callerOrgIds)

      if (pErr) throw pErr

      const partnershipIds = (userPartnerships || []).map((r) => r.id)
      if (partnershipIds.length === 0) {
        console.log('[api] success', { route, method: 'GET', userId: user.id, role: profile?.role ?? null, acting, rowCount: 0 })
        return NextResponse.json({ projects: [] }, { headers: noStoreHeaders })
      }

      const { data, error } = await supabase
        // 079-EMBED: the agency-side one, rewritten from
        // `agency:profiles!projects_agency_id_fkey(...)`. Same treatment against org_id:
        // projects.org_id points at organizations after 079, so the lead agency's company
        // name is organizations.name and the person is its designated primary contact.
        // The `agency` payload key and its `company_name` / `full_name` fields are
        // unchanged, so app/partner/projects/page.tsx does not move.
        .from('project_assignments')
        .select(`
          id,
          status,
          created_at,
          project:projects(
            *,
            lead_org:organizations!org_id(${ORG_CONTACT_SELECT})
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
          // 079-EMBED. The lead agency's identity now arrives as an organization plus its
          // primary contact. Both can be null - a missing foreign key, a deleted contact
          // (ON DELETE SET NULL), or row level security - and both are logged rather than
          // allowed to render blank downstream.
          const leadContact = resolveOrgContact(proj.lead_org as OrgEmbed, null)
          if (proj.org_id) {
            logOrgContactGap('GET /api/projects (vendor)', leadContact, {
              projectId: proj.id,
              leadOrgId: proj.org_id,
            })
          }
          // Wire key `lead_org`, renamed from `agency` by Greg's ruling. The fields name
          // their own sources: name is organizations.name, contact_name is the primary
          // contact's profiles.full_name.
          const leadOrg = leadContact.orgMissing
            ? null
            : {
                name: leadContact.orgName,
                contact_name: leadContact.contactFullName,
              }
          const titleRaw = (proj.title ?? proj.name ?? '') as string
          const title = String(titleRaw).trim() || 'Untitled project'
          return {
            id: proj.id as string,
            title,
            name: title,
            client_name: (proj.client_name as string | null) ?? null,
            status: proj.status as string,
            lead_org: leadOrg
              ? {
                  name: leadOrg.name ?? null,
                  contact_name: leadOrg.contact_name ?? null,
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

    // 079: an organization column is not a user id. Reads scope to the caller's memberships.
    const callerOrgIds = await resolveCallerOrgIds(user.id, supabase)
    // 079: a write is attributed to the caller's OWN organization. Never a visibility set.
    const writeOrgId = await resolveCallerWriteOrgId(user.id, supabase)
    if (!writeOrgId) {
      return NextResponse.json({ error: "Your account is not linked to an organization yet" }, { status: 403, headers: noStoreHeaders })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role, active_role, is_paid, is_admin')
      .eq('id', user.id)
      .single()
    console.log('[api] start', { route, method: 'POST', userId: user.id, role: profile?.role ?? null })

    if (!canActAs(profile, 'agency')) {
      return NextResponse.json({ error: 'Only agencies can create projects' }, { status: 403 })
    }

    // 079: entitlement moves onto the organization. Read the org's entitlement here rather
    // than this member's profile flag.
    if (!hasAgencyEntitlement(profile)) {
      return NextResponse.json({ error: 'Active subscription required' }, { status: 403 })
    }

    // 079: agencyEntitlementId() starts resolving auth.uid() to organizations.id, so a
    // colleague's project counts against the organization's quota rather than opening a
    // fresh usage_tracking row of their own.
    const usageCheck = await checkUsageLimit(await agencyEntitlementId(user.id, supabase), supabase, 'projects')
    if (!usageCheck.allowed) return usageLimitResponse(usageCheck)

    const body = await request.json()
    const { name, clientName, description, budgetRange, startDate, endDate } = body

    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'Project name required' }, { status: 400 })
    }

    const safeName = name.trim()
    const { data: existingNamedProjects, error: existingNamedProjectsError } = await supabase
      .from("projects")
      .select("id")
      .in("org_id", callerOrgIds)
      .ilike("name", safeName)

    if (existingNamedProjectsError) {
      console.warn("[api/projects] duplicate-name warning check failed", {
        message: existingNamedProjectsError.message,
        code: existingNamedProjectsError.code,
      })
    } else if ((existingNamedProjects || []).length > 0) {
      return NextResponse.json({ error: "A project with this name already exists" }, { status: 409 })
    }

    const insertPayload: Record<string, unknown> = {
      org_id: writeOrgId,
      name: safeName,
      status: 'draft',
      description: description || null,
      budget_range: budgetRange || null,
      start_date: startDate || null,
      end_date: endDate || null,
    }
    // Both client fields go through the one reconciler, so a project cannot be CREATED
    // incoherent either. A selected profile sets client_id and takes client_name from that
    // profile's own name; a typed name sets client_name with client_id null.
    const reconciledClient = await reconcileProjectClientFields(supabase, callerOrgIds, {
      hasClientId: 'client_id' in (body as Record<string, unknown>),
      clientId: (body as Record<string, unknown>).client_id as string | null,
      hasClientName: true,
      clientName: clientName || null,
    })
    if (!reconciledClient.ok) {
      return NextResponse.json({ error: reconciledClient.error }, { status: reconciledClient.status })
    }
    Object.assign(insertPayload, reconciledClient.fields)
    const clientId = (reconciledClient.fields.client_id as string | null) ?? null

    let { data: project, error: insertError } = await supabase
      .from('projects')
      .insert(insertPayload)
      .select('*')
      .single()

    // Pre-migration guard: projects.client_id does not exist until 077, and a request carrying
    // one would 42703 the whole creation. Retry once without it - the project is still created,
    // with its client name, and only the entity link is lost.
    if (insertError?.code === '42703' && clientId) {
      console.warn('[api/projects] client_id column missing (migration 077 not applied) - creating without the entity link')
      const { client_id: _omit, ...withoutClientId } = insertPayload
      ;({ data: project, error: insertError } = await supabase
        .from('projects')
        .insert(withoutClientId)
        .select('*')
        .single())
    }

    if (insertError || !project) {
      const msg = insertError?.message || insertError?.details || insertError?.hint || 'Project creation failed'
      throw new Error(String(msg))
    }

    // project.create - LAST, AND NON-FATAL. The project exists and has been returned to
    // the caller by the time this runs; a lost breadcrumb must never turn a successful
    // creation into an error. recordMilestone() catches everything and returns void.
    //
    // AGENCY-SIDE, so actorSide is left to its "agency" default and no partnership is
    // involved: 080's INSERT policy asks only that org_id is one of the caller's
    // organizations, and writeOrgId was resolved from membership above.
    //
    // NOTHING HAD TO BE WIDENED FOR THIS. lib/activity-feed.ts already renders
    // project.create at :383 and already records its expected subject_type as "project" at
    // :504. It is the ONE agency-side event type in the whole vocabulary that had a
    // renderer and no emitter - the other eighteen need a renderer written first, which is
    // a copy decision rather than a mechanical one. See docs/emitter-coverage.md.
    //
    // NOT vendor-visible, deliberately and correctly: project.create is absent from
    // vendor_visible_event_types(), so this row is agency-internal. A vendor has no
    // business seeing that a project exists before they are invited to bid on it.
    await recordMilestone(supabase, {
      eventType: 'project.create',
      orgId: writeOrgId,
      actorId: user.id,
      actorEmail: user.email ?? null,
      subjectType: 'project',
      subjectId: project.id as string,
      payload: { project_name: safeName },
    })

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
