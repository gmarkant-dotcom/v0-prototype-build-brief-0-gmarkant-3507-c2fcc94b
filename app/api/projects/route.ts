import { type NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const noStoreHeaders = {
  'Cache-Control': 'private, no-store, no-cache, must-revalidate',
} as const

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
        const simple = await supabase
          .from('projects')
          .select('*')
          .eq('agency_id', user.id)
          .order('created_at', { ascending: false })

        if (simple.error) throw simple.error
        projects = simple.data
      }

      const agencyProjectIds = (projects || []).map((p: { id: string }) => p.id).filter(Boolean)
      const countByProject = new Map<string, number>()
      const firstByProject = new Map<string, { project_id: string; status: string; budget_status: string; completion_pct: number; notes: string | null; created_at: string }>()
      if (agencyProjectIds.length > 0) {
        const { data: psuRows, error: psuErr } = await supabase
          .from('partner_status_updates')
          .select('project_id, status, budget_status, completion_pct, notes, created_at')
          .in('project_id', agencyProjectIds)
          .eq('is_resolved', false)
          .in('status', ['at_risk', 'delayed', 'blocked'])
          .order('created_at', { ascending: false })

        if (!psuErr && psuRows?.length) {
          for (const row of psuRows) {
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
        return {
          ...p,
          partner_status_alert_count: countByProject.get(pid) || 0,
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
      },
      { headers: noStoreHeaders }
    )
  } catch (error) {
    console.error('[api] failure', {
      route: '/api/projects',
      method: 'GET',
      code: 500,
      message: error instanceof Error ? error.message : String(error),
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

    // Create with a minimal payload first to avoid schema/type mismatch blockers.
    // Optional fields are applied in a second pass (best-effort).
    const attempts: Record<string, unknown>[] = [
      { agency_id: user.id, name: safeName, status: 'draft' },
      { agency_id: user.id, name: safeName },
    ]

    let project: any = null
    let lastError: any = null
    const attemptErrors: string[] = []
    for (const payload of attempts) {
      const { data, error } = await supabase
        .from('projects')
        .insert(payload)
        .select()
        .single()
      if (!error && data) {
        project = data
        lastError = null
        break
      }
      lastError = error
      const msg = error?.message || error?.details || error?.hint
      if (msg) attemptErrors.push(String(msg))
    }

    if (lastError || !project) {
      const unique = [...new Set(attemptErrors)].slice(0, 3)
      throw new Error(unique.join(' | ') || 'Project creation failed')
    }

    // Best-effort update of optional fields. Any mismatch is ignored so creation still succeeds.
    const optionalFields: Record<string, unknown> = {
      client_name: clientName || null,
      description: description || null,
      budget_range: budgetRange || null,
      start_date: startDate || null,
      end_date: endDate || null,
    }

    for (const [key, value] of Object.entries(optionalFields)) {
      if (value === null || value === undefined || value === '') continue
      const { error: updateError } = await supabase
        .from('projects')
        .update({ [key]: value })
        .eq('id', project.id)

      if (updateError) {
        console.warn(`Optional field update skipped (${key}):`, updateError.message)
      }
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
