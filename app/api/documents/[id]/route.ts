import { get } from '@vercel/blob'
import { requireAuth } from "@/lib/api-auth"
import { type NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSafeContentTypeForFilename, isSafeToRenderInline } from '@/lib/upload-validation'

export const dynamic = 'force-dynamic'

type PartnershipRef = { vendor_org_id?: string | null }
type AssignmentRef = { partnerships?: PartnershipRef | PartnershipRef[] | null }

function partnerHasAssignmentOnDocument(
  document: { project_assignments?: AssignmentRef | AssignmentRef[] | null },
  userId: string
): boolean {
  const raw = document.project_assignments
  const assignments: AssignmentRef[] = Array.isArray(raw) ? raw : raw ? [raw] : []
  for (const pa of assignments) {
    const ps = pa.partnerships
    const nests: PartnershipRef[] = Array.isArray(ps) ? ps : ps ? [ps] : []
    for (const p of nests) {
      if (p.vendor_org_id === userId) return true
    }
  }
  return false
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const route = '/api/documents/[id]'
    const { id } = await params
    const auth = await requireAuth()
    if (!auth.authorized) return auth.response
    const { user, supabase } = auth
    console.log('[api] start', { route, method: 'GET', userId: user.id, role: null })

    // Get document record - RLS will enforce access control
    const { data: document, error } = await supabase
      .from('project_documents')
      .select(`
        *,
        projects!inner(org_id),
        project_assignments(
          partnership_id,
          partnerships(vendor_org_id)
        )
      `)
      .eq('id', id)
      .single()

    if (error || !document) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }

    // Additional access check beyond RLS (project_assignments may be one row or an array from PostgREST)
    const isAgency = document.projects.org_id === user.id
    const isAssignedPartner = partnerHasAssignmentOnDocument(document as { project_assignments?: AssignmentRef | AssignmentRef[] | null }, user.id)

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

    // Never trust the stored/client-supplied file_type for the response header, since it
    // may predate validation or have been set by an attacker. Re-derive a safe
    // Content-Type from the filename extension instead.
    const safeContentType = getSafeContentTypeForFilename(document.name)

    // Determine if this should be a download or inline view. Only image/PDF types
    // are ever rendered inline; everything else is forced to download regardless
    // of the `download` query param, since inline rendering of arbitrary content
    // types (e.g. HTML) in an authenticated origin is a stored-XSS vector.
    const download = request.nextUrl.searchParams.get('download') === 'true'
    const disposition = download || !isSafeToRenderInline(safeContentType)
      ? `attachment; filename="${document.name.replace(/"/g, "'")}"`
      : 'inline'

    console.log('[api] success', { route, method: 'GET', userId: user.id, role: null, recordId: id })
    return new NextResponse(result.stream, {
      headers: {
        'Content-Type': safeContentType,
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
