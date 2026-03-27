import { del } from '@vercel/blob'
import { type NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { documentId } = await request.json()

    if (!documentId) {
      return NextResponse.json({ error: 'Document ID required' }, { status: 400 })
    }

    // Get document - only the uploader can delete
    const { data: document, error } = await supabase
      .from('project_documents')
      .select('id, blob_url, uploaded_by')
      .eq('id', documentId)
      .eq('uploaded_by', user.id)
      .single()

    if (error || !document) {
      return NextResponse.json({ error: 'Document not found or access denied' }, { status: 404 })
    }

    // Delete from Blob storage
    await del(document.blob_url)

    // Delete from database
    await supabase
      .from('project_documents')
      .delete()
      .eq('id', documentId)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete error:', error)
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 })
  }
}
