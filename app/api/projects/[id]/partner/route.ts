import { type NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/** Partner-only: single project + assignment + agency + agreements + deployments */
export const dynamic = 'force-dynamic'

const noStoreHeaders = {
  'Cache-Control': 'private, no-store, no-cache, must-revalidate',
} as const

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const route = '/api/projects/[id]/partner'
    const { id: projectId } = await params
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

    if (profile?.role !== 'partner') {
      return NextResponse.json({ error: 'Partner access only' }, { status: 403 })
    }
    console.log('[api] start', { route, method: 'GET', userId: user.id, role: profile.role })

    const { data: partnerships } = await supabase
      .from('partnerships')
      .select('id')
      .eq('partner_id', user.id)

    const partnershipIds = (partnerships || []).map((p) => p.id)
    if (partnershipIds.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const { data: assignment, error: aErr } = await supabase
      .from('project_assignments')
      .select(`
        id,
        status,
        bid_notes,
        partnership_id,
        project:projects(
          id,
          title,
          client_name,
          description,
          budget_range,
          status,
          start_date,
          end_date,
          created_at,
          agency_id
        )
      `)
      .eq('project_id', projectId)
      .in('partnership_id', partnershipIds)
      .maybeSingle()

    if (aErr) throw aErr
    if (!assignment?.project) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const project = (assignment.project as unknown) as {
      id: string
      title: string
      agency_id: string
      client_name: string | null
      description: string | null
      budget_range: string | null
      status: string
      start_date: string | null
      end_date: string | null
      created_at: string
    }

    const { data: agency } = await supabase
      .from('profiles')
      .select('id, email, full_name, company_name')
      .eq('id', project.agency_id)
      .single()

    let agreements: unknown[] = []
    let deployments: unknown[] = []

    const { data: agreementsData, error: agrErr } = await supabase
      .from('assignment_agreements')
      .select('*')
      .eq('assignment_id', assignment.id)
      .order('created_at', { ascending: false })

    if (!agrErr && agreementsData) agreements = agreementsData

    const { data: depData, error: depErr } = await supabase
      .from('onboarding_deployments')
      .select('*')
      .eq('assignment_id', assignment.id)
      .order('deployed_at', { ascending: false })

    if (!depErr && depData) deployments = depData

    console.log('[api] success', { route, method: 'GET', userId: user.id, role: profile.role, recordId: project.id })
    return NextResponse.json({
      assignment: {
        id: assignment.id,
        status: assignment.status,
        bid_notes: assignment.bid_notes,
      },
      project: {
        id: project.id,
        title: project.title,
        client_name: project.client_name,
        description: project.description,
        budget_range: project.budget_range,
        status: project.status,
        start_date: project.start_date,
        end_date: project.end_date,
        created_at: project.created_at,
      },
      agency: agency || null,
      agreements,
      deployments,
    }, { headers: noStoreHeaders })
  } catch (e) {
    console.error('[api] failure', {
      route: '/api/projects/[id]/partner',
      method: 'GET',
      code: 500,
      message: e instanceof Error ? e.message : String(e),
    })
    return NextResponse.json({ error: 'Failed to load project' }, { status: 500, headers: noStoreHeaders })
  }
}
