import { type NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { buildBrandedEmailHtml, sendTransactionalEmail, siteBaseUrl } from '@/lib/email'

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

    const partnership = pa.partnership as unknown as { partner_id: string | null } | null

    const { data: profile } = await supabase
      .from('profiles')
      .select('role, full_name, company_name, email')
      .eq('id', user.id)
      .single()

    const { data: projectRow } = await supabase
      .from('projects')
      .select('agency_id, title')
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

    const counterpartUserId = isPartner ? projectRow?.agency_id || null : partnership?.partner_id || null
    const partyName =
      profile?.company_name?.trim() || profile?.full_name?.trim() || profile?.email?.trim() || 'A teammate'
    const projectName = projectRow?.title?.trim() || 'Project'
    try {
      if (counterpartUserId) {
        const { data: counterpartProfile } = await supabase
          .from('profiles')
          .select('email, role, company_name, full_name')
          .eq('id', counterpartUserId)
          .maybeSingle()
        const recipientEmail = counterpartProfile?.email?.trim()
        if (recipientEmail) {
          const recipientIsAgency = counterpartProfile?.role === 'agency'
          const viewPath = recipientIsAgency
            ? `/agency/dashboard`
            : `/partner/projects`
          const viewUrl = `${siteBaseUrl()}${viewPath}`
          const recipientDisplay =
            counterpartProfile?.company_name?.trim() ||
            counterpartProfile?.full_name?.trim() ||
            recipientEmail

          const emailByStatus: Record<
            'viewed' | 'signed' | 'declined',
            { subject: string; title: string; body: string }
          > = {
            viewed: {
              subject: `${partyName} viewed the agreement for ${projectName}`,
              title: "Agreement viewed",
              body: `${partyName} has viewed the agreement for ${projectName}. Log in to review the latest agreement status.`,
            },
            signed: {
              subject: `${partyName} signed the agreement for ${projectName}`,
              title: "Agreement signed",
              body: `${partyName} has signed the agreement for ${projectName}. Log in to view the signed document.`,
            },
            declined: {
              subject: `${partyName} declined the agreement for ${projectName}`,
              title: "Agreement declined",
              body: `${partyName} has declined to sign the agreement for ${projectName}. Log in to review and follow up.`,
            },
          }
          const content = emailByStatus[status as 'viewed' | 'signed' | 'declined']
          await sendTransactionalEmail({
            to: recipientEmail,
            subject: content.subject,
            html: buildBrandedEmailHtml({
              title: content.title,
              recipientName: recipientDisplay,
              body: content.body,
              ctaText: "View Agreement",
              ctaUrl: viewUrl,
            }),
          })
        }
      }
    } catch (emailError) {
      console.error('agreement PATCH notification failed:', emailError)
    }

    return NextResponse.json({ agreement: updated })
  } catch (e) {
    console.error('agreement PATCH:', e)
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }
}
