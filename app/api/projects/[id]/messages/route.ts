import { type NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const noStoreHeaders = {
  'Cache-Control': 'private, no-store, no-cache, must-revalidate',
} as const

// GET - List messages for a project/assignment
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const route = '/api/projects/[id]/messages'
    const { id: projectId } = await params
    const assignmentId = request.nextUrl.searchParams.get('assignmentId')
    
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

    if (!profile?.role) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.log('[api] start', { route, method: 'GET', userId: user.id, role: profile.role })

    if (profile.role === 'agency') {
      const { data: project } = await supabase
        .from('projects')
        .select('id')
        .eq('id', projectId)
        .eq('agency_id', user.id)
        .single()
      if (!project) {
        return NextResponse.json({ error: 'Project not found' }, { status: 404 })
      }
    } else if (profile.role === 'partner') {
      const { data: assignment } = await supabase
        .from('project_assignments')
        .select('id, partnerships!inner(partner_id)')
        .eq('project_id', projectId)
        .eq('partnerships.partner_id', user.id)
        .single()
      if (!assignment) {
        return NextResponse.json({ error: 'Not assigned to this project' }, { status: 403 })
      }
    } else {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Build query based on whether we're filtering by assignment
    let query = supabase
      .from('project_messages')
      .select(`
        *,
        sender:profiles!project_messages_sender_id_fkey(
          id, email, full_name, company_name, role
        )
      `)
      .eq('project_id', projectId)
      .order('created_at', { ascending: true })

    if (assignmentId) {
      query = query.eq('assignment_id', assignmentId)
    }

    const { data: messages, error } = await query

    if (error) throw error

    console.log('[api] success', { route, method: 'GET', userId: user.id, role: profile.role, rowCount: messages?.length || 0 })
    return NextResponse.json({ messages }, { headers: noStoreHeaders })
  } catch (error) {
    console.error('[api] failure', {
      route: '/api/projects/[id]/messages',
      method: 'GET',
      code: 500,
      message: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: 'Failed to fetch messages' }, { status: 500, headers: noStoreHeaders })
  }
}

// POST - Send a message
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const route = '/api/projects/[id]/messages'
    const { id: projectId } = await params
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { assignmentId, content, messageType, parentId } = await request.json()

    if (!content) {
      return NextResponse.json({ error: 'Message content required' }, { status: 400 })
    }

    // Verify access to project (RLS will handle this, but extra check)
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()
    console.log('[api] start', { route, method: 'POST', userId: user.id, role: profile?.role ?? null })

    if (profile?.role === 'agency') {
      // Agency must own the project
      const { data: project } = await supabase
        .from('projects')
        .select('id')
        .eq('id', projectId)
        .eq('agency_id', user.id)
        .single()

      if (!project) {
        return NextResponse.json({ error: 'Project not found' }, { status: 404 })
      }
    } else {
      // Partner must be assigned to the project
      const { data: assignment } = await supabase
        .from('project_assignments')
        .select('id, partnership:partnerships!inner(partner_id)')
        .eq('project_id', projectId)
        .eq('partnerships.partner_id', user.id)
        .single()

      if (!assignment) {
        return NextResponse.json({ error: 'Not assigned to this project' }, { status: 403 })
      }
    }

    const { data: message, error } = await supabase
      .from('project_messages')
      .insert({
        project_id: projectId,
        assignment_id: assignmentId || null,
        sender_id: user.id,
        content,
        message_type: messageType || 'message',
        parent_id: parentId || null,
      })
      .select(`
        *,
        sender:profiles!project_messages_sender_id_fkey(
          id, email, full_name, company_name, role
        )
      `)
      .single()

    if (error) throw error

    console.log('[api] success', { route, method: 'POST', userId: user.id, role: profile?.role ?? null, recordId: message?.id })
    return NextResponse.json({ message })
  } catch (error) {
    console.error('[api] failure', {
      route: '/api/projects/[id]/messages',
      method: 'POST',
      code: 500,
      message: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 })
  }
}
