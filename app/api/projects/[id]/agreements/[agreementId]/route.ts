import { type NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/** Partner marks NDA or SOW as signed (or lead agency updates status). */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; agreementId: string }> }
) {
  try {
    const { id: projectId, agreementId } = await params
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { status } = body as { status?: string }

    if (!status || !['viewed', 'signed', 'declined'].includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }

    const { data: agreement, error: aErr } = await supabase
      .from('assignment_agreements')
      .select('id, assignment_id')
      .eq('id', agreementId)
      .single()

    if (aErr || !agreement) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const { data: pa, error: pErr } = await supabase
      .from('project_assignments')
      .select(`
        id,
        project_id,
        partnership:partnerships(partner_id)
      `)
      .eq('id', agreement.assignment_id)
      .single()

    if (pErr || !pa || pa.project_id !== projectId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const partnership = pa.partnership as { partner_id: string | null } | null

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    const { data: projectRow } = await supabase
      .from('projects')
      .select('agency_id')
      .eq('id', projectId)
      .single()

    const isPartner = profile?.role === 'partner' && partnership?.partner_id === user.id
    const isAgency = profile?.role === 'agency' && projectRow?.agency_id === user.id

    if (!isPartner && !isAgency) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const updates: Record<string, unknown> = {
      status,
      updated_at: new Date().toISOString(),
    }

    if (status === 'signed' && isPartner) {
      updates.signed_at = new Date().toISOString()
      updates.signed_by = user.id
    }

    const { data: updated, error: upErr } = await supabase
      .from('assignment_agreements')
      .update(updates)
      .eq('id', agreementId)
      .select()
      .single()

    if (upErr) throw upErr

    return NextResponse.json({ agreement: updated })
  } catch (e) {
    console.error('agreement PATCH:', e)
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }
}
