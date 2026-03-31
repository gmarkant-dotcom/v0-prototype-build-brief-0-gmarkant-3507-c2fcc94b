import { type NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET - List messages for a project/assignment
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    console.log('[projects/messages] GET start')
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

    console.log('[projects/messages] GET success', { projectId, count: messages?.length || 0 })
    return NextResponse.json({ messages })
  } catch (error) {
    console.error('Error fetching messages:', error)
    return NextResponse.json({ error: 'Failed to fetch messages' }, { status: 500 })
  }
}

// POST - Send a message
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    console.log('[projects/messages] POST start')
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

    console.log('[projects/messages] POST success', { projectId, messageId: message?.id })
    return NextResponse.json({ message })
  } catch (error) {
    console.error('Error sending message:', error)
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 })
  }
}
