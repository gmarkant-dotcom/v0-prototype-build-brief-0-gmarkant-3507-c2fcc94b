import { put } from '@vercel/blob'
import { type NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const formData = await request.formData()
    const file = formData.get('file') as File
    const projectId = formData.get('projectId') as string
    const assignmentId = formData.get('assignmentId') as string | null
    const documentType = formData.get('documentType') as string
    const visibility = formData.get('visibility') as string || 'assignment'

    if (!file || !projectId || !documentType) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Verify user has access to this project
    const { data: project } = await supabase
      .from('projects')
      .select('id, agency_id')
      .eq('id', projectId)
      .single()

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    // Check if user is the agency owner or an assigned partner
    const isAgency = project.agency_id === user.id
    
    if (!isAgency) {
      // Check if user is an assigned partner
      const { data: assignment } = await supabase
        .from('project_assignments')
        .select('id, partnership_id, partnerships!inner(partner_id)')
        .eq('project_id', projectId)
        .eq('partnerships.partner_id', user.id)
        .single()

      if (!assignment) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 })
      }
    }

    // Create secure path: projects/{projectId}/assignments/{assignmentId}/{timestamp}_{filename}
    const timestamp = Date.now()
    const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_')
    const blobPath = assignmentId 
      ? `projects/${projectId}/assignments/${assignmentId}/${timestamp}_${safeName}`
      : `projects/${projectId}/shared/${timestamp}_${safeName}`

    // Upload to private Blob storage
    const blob = await put(blobPath, file, {
      access: 'private',
    })

    // Store document record in database
    const { data: document, error: dbError } = await supabase
      .from('project_documents')
      .insert({
        project_id: projectId,
        assignment_id: assignmentId || null,
        uploaded_by: user.id,
        name: file.name,
        file_type: file.type,
        file_size: file.size,
        blob_url: blob.url,
        blob_path: blob.pathname,
        document_type: documentType,
        visibility: visibility,
      })
      .select()
      .single()

    if (dbError) {
      console.error('Database error:', dbError)
      return NextResponse.json({ error: 'Failed to save document record' }, { status: 500 })
    }

    return NextResponse.json({ 
      success: true,
      document: {
        id: document.id,
        name: document.name,
        file_type: document.file_type,
        file_size: document.file_size,
        document_type: document.document_type,
        created_at: document.created_at,
      }
    })
  } catch (error) {
    console.error('Upload error:', error)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
