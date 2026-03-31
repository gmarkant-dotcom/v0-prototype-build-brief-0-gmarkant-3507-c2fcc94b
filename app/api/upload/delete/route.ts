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

    const { url } = await request.json()

    if (!url) {
      return NextResponse.json({ error: 'No URL provided' }, { status: 400 })
    }

    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
    }

    const path = parsed.pathname.replace(/^\/+/, '')
    const parts = path.split('/').filter(Boolean)
    const ownedByUser =
      // upload route: {folder}/{userId}/{timestamp-filename}
      (parts.length >= 2 && parts[1] === user.id) ||
      // partner rfp uploads: partner-rfp-bids/{partnerId}/{inboxId}/{file}
      (parts.length >= 3 && parts[0] === 'partner-rfp-bids' && parts[1] === user.id)

    if (!ownedByUser) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await del(url)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete error:', error)
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 })
  }
}
