import { resolveCallerOrgIds, resolveCallerWriteOrgId } from "@/lib/entitlements"
import { type NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  ORG_CONTACT_SELECT,
  logOrgContactGap,
  resolveOrgContact,
  unwrapOne,
  type OrgEmbed,
} from '@/lib/org-contact'
import { canActAs } from '@/lib/acting-role'
import { buildBrandedEmailHtml, sendTransactionalEmail, siteBaseUrl } from '@/lib/email'
import { createOrgNotification } from '@/lib/notifications'

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

    // 079: an organization column is not a user id. Reads scope to the caller's memberships.
    const callerOrgIds = await resolveCallerOrgIds(user.id, supabase)
    // 079: a write is attributed to the caller's OWN organization. Never a visibility set.
    const writeOrgId = await resolveCallerWriteOrgId(user.id, supabase)
    if (!writeOrgId) {
      return NextResponse.json({ error: "Your account is not linked to an organization yet" }, { status: 403 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role, active_role, company_name, full_name')
      .eq('id', user.id)
      .single()

    if (!canActAs(profile, 'agency')) {
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
      .select('id, title, org_id')
      .eq('id', projectId)
      .single()

    if (!project || !callerOrgIds.includes(project.org_id as string)) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    const { data: assignment } = await supabase
      // 079-EMBED: rewritten from `partner:profiles!partnerships_partner_id_fkey(...)`.
      .from('project_assignments')
      .select(`
        id,
        project_id,
        partnership:partnerships(
          vendor_org_id,
          partner_email,
          vendor_org:organizations!vendor_org_id(${ORG_CONTACT_SELECT})
        )
      `)
      .eq('id', assignmentId)
      .eq('project_id', projectId)
      .single()

    if (!assignment) {
      return NextResponse.json({ error: 'Assignment not found' }, { status: 404 })
    }

    const partnership = unwrapOne(
      assignment.partnership as Record<string, unknown> | Record<string, unknown>[] | null
    )
    // 079-EMBED. This route DEPENDS on having an address: it deploys onboarding by
    // emailing the vendor, so a null contact is a 400 rather than a fallback. That is the
    // one place the shared fallback rule stops at "log and refuse" instead of "log and
    // degrade", because there is nothing useful to deploy without a recipient. The rule is
    // still the same rule: primary contact first, the partnership's own pre-claim
    // partner_email second, refuse third.
    const vendorContact = resolveOrgContact(
      partnership?.vendor_org as OrgEmbed,
      (partnership?.partner_email as string | null) ?? null
    )
    logOrgContactGap('POST /api/projects/[id]/onboarding/deploy', vendorContact, {
      projectId,
      assignmentId,
      vendorOrgId: partnership?.vendor_org_id,
    })

    const partnerId = (partnership?.vendor_org_id as string | null) || vendorContact.orgId

    if (!partnerId || !vendorContact.contactEmail) {
      return NextResponse.json(
        { error: 'Vendor must have a contact with an email address before deploying onboarding' },
        { status: 400 }
      )
    }

    const agencyName =
      profile?.company_name || profile?.full_name || 'Your lead agency'

    const { data: deployment, error: depErr } = await supabase
      .from('onboarding_deployments')
      .insert({
        project_id: projectId,
        assignment_id: assignmentId,
        org_id: writeOrgId,
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

    // 079-AMBIGUOUS, RESOLVED. partnerId is partnerships.vendor_org_id, an ORGANIZATION id
    // after 079, and notifications.user_id is a USER id. Greg has ruled: every member of
    // the organization, one rule at all sixteen call sites, matching what
    // resolveOrgNotificationRecipients() already does for email. See the ruling at the top
    // of lib/notifications.ts.
    await createOrgNotification({
      supabase,
      orgId: partnerId,
      site: 'POST /api/projects/[id]/onboarding/deploy',
      type: 'onboarding_deployed',
      title: 'Onboarding materials sent',
      message: `${agencyName} shared onboarding materials for "${projectTitle}".`,
      link: `/partner/projects/${projectId}?tab=onboarding`,
      data: { projectId, assignmentId, deploymentId: deployment.id },
    })

    let deployBody = `${agencyName} has sent your onboarding package for ${projectTitle}.\n\nInside you will find kickoff details, project documents, and next steps. Log in to your vendor portal to review everything and get started.`
    if (customMessage && String(customMessage).trim()) {
      deployBody += `\n\nMessage from ${agencyName}:\n${String(customMessage).trim()}`
    }
    // 079-EMBED. The company name leads, then the contact's name, then the address.
    // orgGreetingName() puts the person first; here the package is addressed to the
    // company, which is the pre-079 ordering at this site and is preserved deliberately.
    const partnerRecipientName =
      vendorContact.orgName ?? vendorContact.contactFullName ?? vendorContact.contactEmail ?? "there"
    await sendTransactionalEmail({
      to: vendorContact.contactEmail,
      subject: `Your onboarding package is ready - ${projectTitle}`,
      html: buildBrandedEmailHtml({
        title: "Onboarding package ready",
        recipientName: partnerRecipientName,
        body: deployBody,
        ctaText: "View Onboarding Package",
        ctaUrl: onboardingUrl,
      }),
    })

    return NextResponse.json({ success: true, deployment })
  } catch (e) {
    console.error('onboarding deploy:', e)
    return NextResponse.json({ error: 'Deploy failed' }, { status: 500 })
  }
}
