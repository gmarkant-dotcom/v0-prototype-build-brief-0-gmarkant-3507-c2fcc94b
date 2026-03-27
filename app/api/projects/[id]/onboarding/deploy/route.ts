import { type NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendTransactionalEmail, siteBaseUrl } from '@/lib/email'
import { createNotification } from '@/lib/notifications'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role, company_name, full_name')
      .eq('id', user.id)
      .single()

    if (profile?.role !== 'agency') {
      return NextResponse.json({ error: 'Only lead agencies can deploy onboarding' }, { status: 403 })
    }

    const body = await request.json()
    const {
      assignmentId,
      documentIds = [],
      customMessage = '',
      createNda = false,
      createSow = false,
    } = body as {
      assignmentId?: string
      documentIds?: string[]
      customMessage?: string
      createNda?: boolean
      createSow?: boolean
    }

    if (!assignmentId) {
      return NextResponse.json({ error: 'assignmentId required' }, { status: 400 })
    }

    const { data: project } = await supabase
      .from('projects')
      .select('id, title, agency_id')
      .eq('id', projectId)
      .single()

    if (!project || project.agency_id !== user.id) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    const { data: assignment } = await supabase
      .from('project_assignments')
      .select(`
        id,
        project_id,
        partnership:partnerships(
          partner_id,
          partner:profiles!partnerships_partner_id_fkey(id, email, full_name, company_name)
        )
      `)
      .eq('id', assignmentId)
      .eq('project_id', projectId)
      .single()

    if (!assignment) {
      return NextResponse.json({ error: 'Assignment not found' }, { status: 404 })
    }

    const partnership = assignment.partnership as
      | { partner_id: string | null; partner: { id: string; email: string | null; full_name: string | null; company_name: string | null } | null }
      | null

    const partner = partnership?.partner
    const partnerId = partnership?.partner_id || partner?.id

    if (!partnerId || !partner?.email) {
      return NextResponse.json(
        { error: 'Partner must have an account with an email before deploying onboarding' },
        { status: 400 }
      )
    }

    const agencyName =
      profile.company_name || profile.full_name || 'Your lead agency'

    const { data: deployment, error: depErr } = await supabase
      .from('onboarding_deployments')
      .insert({
        project_id: projectId,
        assignment_id: assignmentId,
        agency_id: user.id,
        document_ids: documentIds,
        custom_message: customMessage || null,
      })
      .select()
      .single()

    if (depErr) {
      console.error('onboarding_deployments insert:', depErr)
      return NextResponse.json({ error: 'Could not record deployment (run DB migration 012?)' }, { status: 500 })
    }

    const agreementRows: { agreement_type: string; status: string; template_label: string | null }[] = []
    if (createNda) {
      agreementRows.push({ agreement_type: 'nda', status: 'sent', template_label: 'Mutual NDA' })
    }
    if (createSow) {
      agreementRows.push({ agreement_type: 'sow', status: 'sent', template_label: 'Scope of Work' })
    }

    for (const row of agreementRows) {
      const { error: upErr } = await supabase.from('assignment_agreements').upsert(
        {
          assignment_id: assignmentId,
          agreement_type: row.agreement_type,
          status: row.status,
          template_label: row.template_label,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'assignment_id,agreement_type' }
      )
      if (upErr) console.error('assignment_agreements upsert:', upErr)
    }

    const base = siteBaseUrl()
    const projectTitle = project.title || 'Project'
    const onboardingUrl = `${base}/partner/onboarding?project=${projectId}`
    const projectUrl = `${base}/partner/projects/${projectId}`

    await createNotification({
      supabase,
      userId: partnerId,
      type: 'onboarding_deployed',
      title: 'Onboarding materials sent',
      message: `${agencyName} shared onboarding materials for "${projectTitle}".`,
      link: `/partner/projects/${projectId}?tab=onboarding`,
      data: { projectId, assignmentId, deploymentId: deployment.id },
    })

    await sendTransactionalEmail({
      to: partner.email,
      subject: `${agencyName} sent onboarding materials — ${projectTitle}`,
      html: `
        <div style="font-family:system-ui,sans-serif;line-height:1.6;color:#0C3535;max-width:560px">
          <p><strong>${agencyName}</strong> deployed an onboarding packet for <strong>${projectTitle}</strong>.</p>
          ${customMessage ? `<p style="border-left:3px solid #C8F53C;padding-left:12px;color:#333">${escapeHtml(customMessage)}</p>` : ''}
          <p>
            <a href="${projectUrl}" style="display:inline-block;background:#0C3535;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Open project hub</a>
          </p>
          <p style="font-size:13px;color:#666">
            <a href="${onboardingUrl}" style="color:#0C3535">Onboarding workspace →</a>
          </p>
        </div>
      `,
    })

    return NextResponse.json({ success: true, deployment })
  } catch (e) {
    console.error('onboarding deploy:', e)
    return NextResponse.json({ error: 'Deploy failed' }, { status: 500 })
  }
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
