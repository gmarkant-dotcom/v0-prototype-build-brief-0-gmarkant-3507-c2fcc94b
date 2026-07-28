import { put } from '@vercel/blob'
import { type NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { validateUploadFile } from '@/lib/upload-validation'

// Folders routed to the public Supabase 'avatars' bucket (images only, public by design)
const SUPABASE_AVATAR_FOLDERS = new Set(['avatars', 'logos', 'agency-logos', 'partner-logos'])

// Folders routed to private Vercel Blob storage
const PRIVATE_BLOB_FOLDERS = new Set([
  'documents',
  'agency-documents',
  'agency-library',
  'agency-onboarding',
  'onboarding-project',
  'partner-legal',
  'partner-onboarding',
  'partner-reels',
])

// Reference materials are shared with unauthenticated guest vendors on the RFP
// response page, so they need a publicly-fetchable blob URL (no signed token),
// unlike NDAs/contracts/other agency documents, which stay private by default.
// Callers pass "reference-materials/{agencyId}" or "reference-materials/{agencyId}/{projectId}".
const REFERENCE_MATERIALS_PREFIX = 'reference-materials'
const REFERENCE_MATERIALS_PATTERN = /^reference-materials\/[a-zA-Z0-9_-]+(\/[a-zA-Z0-9_-]+)?$/

type FolderRouting = { storage: 'supabase-avatar' } | { storage: 'blob-private' } | { storage: 'blob-public' }

function resolveFolderRouting(folder: string): FolderRouting | null {
  if (SUPABASE_AVATAR_FOLDERS.has(folder)) return { storage: 'supabase-avatar' }
  if (PRIVATE_BLOB_FOLDERS.has(folder)) return { storage: 'blob-private' }
  if (folder.startsWith(REFERENCE_MATERIALS_PREFIX) && REFERENCE_MATERIALS_PATTERN.test(folder)) {
    return { storage: 'blob-public' }
  }
  return null
}

export async function POST(request: NextRequest) {
  try {
    const route = '/api/upload'
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('is_paid, is_admin, role')
      .eq('id', user.id)
      .single()
    console.log('[api] start', { route, method: 'POST', userId: user.id, role: profile?.role ?? null })

    const isDemoMode = process.env.NEXT_PUBLIC_IS_DEMO === 'true'
    const canUpload =
      isDemoMode ||
      profile?.role === 'partner' ||
      profile?.role === 'agency' ||
      profile?.is_admin ||
      profile?.is_paid
    if (!canUpload) {
      return NextResponse.json({ error: 'Upgrade to upload files' }, { status: 403 })
    }

    const formData = await request.formData()
    const file = formData.get('file') as File
    const folder = formData.get('folder') as string || 'documents'

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    const routing = resolveFolderRouting(folder)
    if (!routing) {
      return NextResponse.json({ error: 'Invalid folder' }, { status: 400 })
    }

    const validation = validateUploadFile(file)
    if (!validation.ok) {
      return NextResponse.json({ error: validation.message }, { status: 400 })
    }

    const timestamp = Date.now()

    if (routing.storage === 'supabase-avatar') {
      const ext = file.name.split('.').pop() || 'jpg'
      const filename = `${user.id}/${timestamp}.${ext}`
      const { data, error } = await supabase.storage
        .from('avatars')
        .upload(filename, file, { upsert: true, contentType: file.type })

      if (error) {
        console.error('[api/upload] supabase storage error', error)
        return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
      }

      const { data: publicUrlData } = supabase.storage
        .from('avatars')
        .getPublicUrl(filename)

      console.log('[api] success', { route, method: 'POST', userId: user.id, role: profile?.role ?? null, pathname: filename })
      return NextResponse.json({
        url: publicUrlData.publicUrl,
        pathname: filename,
        filename: file.name,
        size: file.size,
        contentType: file.type,
      })
    }

    const filename = `${folder}/${user.id}/${timestamp}-${file.name}`
    const blob = await put(filename, file, { access: routing.storage === 'blob-public' ? 'public' : 'private' })

    console.log('[api] success', { route, method: 'POST', userId: user.id, role: profile?.role ?? null, pathname: blob.pathname })
    return NextResponse.json({
      url: blob.url,
      pathname: blob.pathname,
      filename: file.name,
      size: file.size,
      contentType: blob.contentType,
    })
  } catch (error) {
    console.error('[api] failure', {
      route: '/api/upload',
      method: 'POST',
      code: 500,
      message: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
