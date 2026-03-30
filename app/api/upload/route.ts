import { put } from '@vercel/blob'
import { type NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  try {
    // Verify user is authenticated
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    // Check if user is paid (or in demo mode)
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_paid, is_admin, role')
      .eq('id', user.id)
      .single()
    
    const isDemoMode = process.env.NEXT_PUBLIC_IS_DEMO === 'true'
    const canUpload =
      isDemoMode ||
      profile?.role === 'partner' ||
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

    // Create a unique filename with timestamp and user ID for isolation
    const timestamp = Date.now()
    const filename = `${folder}/${user.id}/${timestamp}-${file.name}`

    const blob = await put(filename, file, {
      access: 'private',
    })

    return NextResponse.json({ 
      url: blob.url,
      pathname: blob.pathname,
      filename: file.name,
      size: file.size,
      contentType: blob.contentType,
    })
  } catch (error) {
    console.error('Upload error:', error)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
