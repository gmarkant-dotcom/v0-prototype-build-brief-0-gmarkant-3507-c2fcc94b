import { type NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET - List projects for current user
export async function GET(request: NextRequest) {
  try {
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

    let projects
    
    if (profile?.role === 'agency') {
      const { data, error } = await supabase
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

      if (error) throw error
      projects = data
    } else {
      const { data: userPartnerships, error: pErr } = await supabase
        .from('partnerships')
        .select('id')
        .eq('partner_id', user.id)

      if (pErr) throw pErr

      const partnershipIds = (userPartnerships || []).map((r) => r.id)
      if (partnershipIds.length === 0) {
        return NextResponse.json({ projects: [] })
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
    }

    return NextResponse.json({ projects })
  } catch (error) {
    console.error('Error fetching projects:', error)
    return NextResponse.json({ error: 'Failed to fetch projects' }, { status: 500 })
  }
}

// POST - Create a new project (agency only)
export async function POST(request: NextRequest) {
  try {
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

    const { data: project, error } = await supabase
      .from('projects')
      .insert({
        agency_id: user.id,
        title: name.trim(),
        client_name: clientName || null,
        description: description || null,
        budget_range: budgetRange || null,
        start_date: startDate || null,
        end_date: endDate || null,
        status: 'draft',
      })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ project })
  } catch (error) {
    console.error('Error creating project:', error)
    return NextResponse.json({ error: 'Failed to create project' }, { status: 500 })
  }
}
