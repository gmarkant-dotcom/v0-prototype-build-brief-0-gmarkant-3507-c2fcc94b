import { resolveCallerOrgIds, resolveCallerWriteOrgId, callerOwnsOrg, orgIdFromColumn } from "@/lib/entitlements"
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
import { recordMilestone } from '@/lib/milestone-events'

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

    if (!project || !callerOwnsOrg(callerOrgIds, project.org_id)) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    const { data: assignment } = await supabase
      // 079-EMBED: rewritten from `partner:profiles!partnerships_partner_id_fkey(...)`.
      .from('project_assignments')
      .select(`
        id,
        project_id,
        partnership:partnerships(
          id,
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

    // Milestone: onboarding.deploy. Emitted last, after the deployment row, the agreement
    // rows, the vendor's notification and the vendor's email - so a breadcrumb never
    // outlives the deploy it describes. recordMilestone catches everything and returns
    // void, so it cannot turn a completed deploy into a 500.
    //
    // EVERY FIELD BELOW IS ABOUT THE ONE RECIPIENT THIS ROW IS FOR. onboarding.deploy is on
    // public.vendor_visible_event_types() and migration 080's counterparty policy grants the
    // WHOLE row, payload included, to the vendor org behind partnership_id. A deploy targets
    // exactly ONE assignment, so each fact below is that vendor's own: how many documents
    // went to them, and whether an NDA or an SOW was raised for them. All of it is already
    // visible to them in their own onboarding tab. `customMessage` is left out for the same
    // reason as on the package route - they were sent it verbatim in the mail.
    //
    // 079 PARAMETER CLASS: milestone_events.org_id REFERENCES organizations(id). writeOrgId
    // is the caller's own organization - the same value written to
    // onboarding_deployments.org_id above. `partnerId` is partnerships.vendor_org_id, an
    // ORGANIZATION id, already proved non-null by the guard at line 116. user.id is the ACTOR.
    await recordMilestone(supabase, {
      eventType: 'onboarding.deploy',
      orgId: writeOrgId,
      actorId: user.id,
      vendorOrgId: orgIdFromColumn(partnerId),
      // Null only if the embed could not read the partnership row, which the guard above
      // has effectively ruled out; kept nullable rather than asserted, because a null here
      // costs the vendor visibility of one line and an assertion would cost the deploy.
      partnershipId: (partnership?.id as string | null) ?? null,
      // The project. `onboarding.deploy` is not in UNION_REPLACING_EVENT_TYPES so it cannot
      // dedupe a derived line away, and a project subject is what resolves the project name
      // its feed predicate renders.
      subjectType: 'project',
      subjectId: projectId,
      payload: {
        deployment_id: deployment.id,
        // Never `documentIds.length` directly: documentIds comes off the request body and
        // is only defaulted when absent, so a non-array client payload would put a string
        // length in a counterparty-readable field.
        document_count: Array.isArray(documentIds) ? documentIds.length : 0,
        nda_created: createNda === true,
        sow_created: createSow === true,
      },
    })

    return NextResponse.json({ success: true, deployment })
  } catch (e) {
    console.error('onboarding deploy:', e)
    return NextResponse.json({ error: 'Deploy failed' }, { status: 500 })
  }
}
