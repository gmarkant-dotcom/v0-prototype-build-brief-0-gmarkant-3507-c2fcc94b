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

      projects = data?.map((a) => ({
        ...a.project,
        assignment: {
          id: a.id,
          status: a.status,
          invited_at: a.created_at,
          responded_at: null as string | null,
        },
      }))
    } else {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    console.log('[api] success', { route, method: 'GET', userId: user.id, role: profile?.role ?? null, rowCount: Array.isArray(projects) ? projects.length : 0 })
    return NextResponse.json({ projects }, { headers: noStoreHeaders })
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
