import { get } from '@vercel/blob'
import { type NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const route = '/api/documents/[id]'
    const { id } = await params
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.log('[api] start', { route, method: 'GET', userId: user.id, role: null })

    // Get document record - RLS will enforce access control
    const { data: document, error } = await supabase
      .from('project_documents')
      .select(`
        *,
        projects!inner(agency_id),
        project_assignments(
          partnership_id,
          partnerships(partner_id)
        )
      `)
      .eq('id', id)
      .single()

    if (error || !document) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }

    // Additional access check beyond RLS
    const isAgency = document.projects.agency_id === user.id
    const isAssignedPartner = document.project_assignments?.partnerships?.partner_id === user.id
    
    if (!isAgency && !isAssignedPartner) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Get the file from private Blob storage
    const result = await get(document.blob_path, {
      access: 'private',
      ifNoneMatch: request.headers.get('if-none-match') ?? undefined,
    })

    if (!result) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    // Blob hasn't changed - tell browser to use cached copy
    if (result.statusCode === 304) {
      return new NextResponse(null, {
        status: 304,
        headers: {
          ETag: result.blob.etag,
          'Cache-Control': 'private, no-cache',
        },
      })
    }

    // Determine if this should be a download or inline view
    const download = request.nextUrl.searchParams.get('download') === 'true'
    const disposition = download 
      ? `attachment; filename="${document.name}"`
      : 'inline'

    console.log('[api] success', { route, method: 'GET', userId: user.id, role: null, recordId: id })
    return new NextResponse(result.stream, {
      headers: {
        'Content-Type': result.blob.contentType || document.file_type || 'application/octet-stream',
        'Content-Disposition': disposition,
        ETag: result.blob.etag,
        'Cache-Control': 'private, no-cache',
      },
    })
  } catch (error) {
    console.error('[api] failure', {
      route: '/api/documents/[id]',
      method: 'GET',
      code: 500,
      message: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: 'Failed to serve file' }, { status: 500 })
  }
}
