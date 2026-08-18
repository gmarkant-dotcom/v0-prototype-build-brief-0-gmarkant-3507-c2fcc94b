import { type NextRequest, NextResponse } from 'next/server'
import { requireAuth } from "@/lib/api-auth"
import { createClient } from '@/lib/supabase/server'
import {
  ORG_CONTACT_SELECT,
  orgWireShape,
  logOrgContactGap,
  orgGreetingName,
  resolveOrgContact,
  unwrapOne,
  type OrgEmbed,
} from '@/lib/org-contact'
import {
  notifyProjectAssignment,
  notifyProjectResponse,
  notifyProjectAwarded,
} from '@/lib/notifications'
import { buildBrandedEmailHtml, sendTransactionalEmail, siteBaseUrl } from '@/lib/email'

export const dynamic = 'force-dynamic'

const noStoreHeaders = {
  'Cache-Control': 'private, no-store, no-cache, must-revalidate',
} as const

// GET - List assignments for a project
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const route = '/api/projects/[id]/assignments'
    const { id: projectId } = await params
    const auth = await requireAuth()
    if (!auth.authorized) return auth.response
    const { user, supabase } = auth
    console.log('[api] start', { route, method: 'GET', userId: user.id, role: 'agency' })

    const { data: project } = await supabase
      .from('projects')
      .select('org_id')
      .eq('id', projectId)
      .single()

    if (!project || project.org_id !== user.id) {
      return NextResponse.json({ error: 'Project not found or access denied' }, { status: 404 })
    }

    const { data: assignments, error } = await supabase
      // 079-EMBED: rewritten from `partner:profiles!partnerships_partner_id_fkey(...)`.
      // The response key stays `partner` so components/stage-03-onboarding-production.tsx
      // does not move; only the query shape changes. lib/org-contact.ts owns the fragment
      // and the null rule.
      .from('project_assignments')
      .select(`
        *,
        partnership:partnerships(
          id,
          vendor_org_id,
          partner_email,
          vendor_org:organizations!vendor_org_id(${ORG_CONTACT_SELECT})
        )
      `)
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })

    if (error) throw error

    const shapedAssignments = (assignments || []).map((row) => {
      const record = row as Record<string, unknown>
      const pship = unwrapOne(record.partnership as Record<string, unknown> | Record<string, unknown>[] | null)
      if (!pship) return record
      const { vendor_org: embed, ...restPship } = pship
      const rowEmail = (pship.partner_email as string | null) ?? null
      const contact = resolveOrgContact(embed as OrgEmbed, rowEmail)
      if (pship.vendor_org_id) {
        logOrgContactGap('GET /api/projects/[id]/assignments', contact, {
          projectId,
          assignmentId: record.id,
          vendorOrgId: pship.vendor_org_id,
        })
      }
      return {
        ...record,
        partnership: { ...restPship, vendor_org: orgWireShape(embed as OrgEmbed, rowEmail) },
      }
    })

    console.log('[api] success', { route, method: 'GET', userId: user.id, role: 'agency', rowCount: shapedAssignments.length })
    return NextResponse.json({ assignments: shapedAssignments }, { headers: noStoreHeaders })
  } catch (error) {
    console.error('[api] failure', {
      route: '/api/projects/[id]/assignments',
      method: 'GET',
      code: 500,
      message: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: 'Failed to fetch assignments' }, { status: 500, headers: noStoreHeaders })
  }
}

// POST - Assign a partner to a project (Tier 2 - creates closed loop)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params
    const auth = await requireAuth()
    if (!auth.authorized) return auth.response
    const { user, supabase } = auth

    const { data: project } = await supabase
      .from('projects')
      .select('org_id, status, title')
      .eq('id', projectId)
      .single()

    if (!project || project.org_id !== user.id) {
      return NextResponse.json({ error: 'Project not found or access denied' }, { status: 404 })
    }

    const { partnershipId, notes } = await request.json()

    if (!partnershipId) {
      return NextResponse.json({ error: 'Partnership ID required' }, { status: 400 })
    }

    const { data: partnership } = await supabase
      .from('partnerships')
      .select('id, lead_org_id, vendor_org_id, status')
      .eq('id', partnershipId)
      .eq('lead_org_id', user.id)
      .single()

    if (!partnership) {
      return NextResponse.json({ error: 'Partnership not found' }, { status: 404 })
    }

    if (partnership.status !== 'active' || !partnership.vendor_org_id) {
      return NextResponse.json({ error: 'Partnership must be active with a connected partner account' }, { status: 400 })
    }

    const { data: existing } = await supabase
      .from('project_assignments')
      .select('id')
      .eq('project_id', projectId)
      .eq('partnership_id', partnershipId)
      .single()

    if (existing) {
      return NextResponse.json({ error: 'Vendor already assigned to this project' }, { status: 400 })
    }

    const insertPayload: Record<string, unknown> = {
      project_id: projectId,
      partnership_id: partnershipId,
      status: 'invited',
    }
    if (notes) {
      insertPayload.bid_notes = notes
    }

    const { data: assignment, error } = await supabase
      // 079-EMBED: rewritten from `partner:profiles!partnerships_partner_id_fkey(...)`.
      // Returned to the caller with the same `partner` key, and read below to address the
      // invitation email.
      .from('project_assignments')
      .insert(insertPayload)
      .select(`
        *,
        partnership:partnerships(
          vendor_org_id,
          partner_email,
          vendor_org:organizations!vendor_org_id(${ORG_CONTACT_SELECT})
        )
      `)
      .single()

    if (error) throw error

    if (project.status === 'draft') {
      await supabase
        .from('projects')
        .update({ status: 'open' })
        .eq('id', projectId)
    }

    const { data: agencyProfile } = await supabase
      .from('profiles')
      .select('company_name, full_name')
      .eq('id', user.id)
      .single()

    const agencyName = agencyProfile?.company_name || agencyProfile?.full_name || 'Lead agency'
    const projectName = project.title || 'Project'

    await notifyProjectAssignment(
      supabase,
      partnership.vendor_org_id,
      projectName,
      agencyName,
      assignment.id,
      projectId
    )

    // 079-EMBED. The vendor's address is the designated primary contact's, falling back
    // to the partnership's own pre-claim partner_email. If neither exists the send is
    // SKIPPED AND LOGGED rather than attempted against an empty address: the assignment is
    // already created, so a silent no-email is the failure to make visible.
    const assignmentPship = unwrapOne(
      (assignment as Record<string, unknown>).partnership as
        | Record<string, unknown>
        | Record<string, unknown>[]
        | null
    )
    const assignmentEmbed = assignmentPship?.vendor_org as OrgEmbed
    const assignmentRowEmail = (assignmentPship?.partner_email as string | null) ?? null
    const vendorContact = resolveOrgContact(assignmentEmbed, assignmentRowEmail)
    logOrgContactGap('POST /api/projects/[id]/assignments', vendorContact, {
      projectId,
      assignmentId: assignment.id,
      vendorOrgId: partnership.vendor_org_id,
    })

    const shapedAssignment = {
      ...(assignment as Record<string, unknown>),
      partnership: assignmentPship
        ? (() => {
            const { vendor_org: _embed, ...restPship } = assignmentPship
            return { ...restPship, vendor_org: orgWireShape(assignmentEmbed, assignmentRowEmail) }
          })()
        : assignmentPship,
    }

    const partnerEmail = vendorContact.contactEmail
    if (!partnerEmail) {
      console.warn('[api] POST /api/projects/[id]/assignments no address for the vendor, invitation email skipped', {
        projectId,
        assignmentId: assignment.id,
        vendorOrgId: partnership.vendor_org_id,
      })
    }
    if (partnerEmail) {
      const base = siteBaseUrl()
      await sendTransactionalEmail({
        to: partnerEmail,
        subject: `New RFP from ${agencyName}: ${projectName}`,
        html: buildBrandedEmailHtml({
          title: "New RFP in your inbox",
          recipientName: orgGreetingName(vendorContact, partnerEmail),
          body: `${agencyName} has sent you an RFP for ${projectName} on Ligament.\n\nReview the scope, timeline, and budget details, then submit your bid directly through the platform.`,
          ctaText: "View RFP",
          ctaUrl: `${base}/partner/rfps`,
        }),
      })
    }

    return NextResponse.json({ assignment: shapedAssignment })
  } catch (error) {
    console.error('Error creating assignment:', error)
    return NextResponse.json({ error: 'Failed to create assignment' }, { status: 500 })
  }
}

// PATCH - Update assignment status
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params
    const auth = await requireAuth()
    if (!auth.authorized) return auth.response
    const { user, supabase } = auth

    const { assignmentId, status } = await request.json()

    if (!assignmentId || !status) {
      return NextResponse.json({ error: 'Assignment ID and status required' }, { status: 400 })
    }

    const { data: assignment } = await supabase
      .from('project_assignments')
      .select(`
        *,
        partnership:partnerships(lead_org_id, vendor_org_id),
        project:projects(id, org_id, title, status)
      `)
      .eq('id', assignmentId)
      .eq('project_id', projectId)
      .single()

    if (!assignment) {
      return NextResponse.json({ error: 'Assignment not found' }, { status: 404 })
    }

    const isAgency = assignment.project.org_id === user.id
    const isPartner = assignment.partnership.vendor_org_id === user.id

    if (!isAgency && !isPartner) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    if (isPartner && assignment.status === 'invited') {
      if (!['accepted', 'declined'].includes(status)) {
        return NextResponse.json({ error: 'Invalid status for vendor' }, { status: 400 })
      }

      const { data: updated, error } = await supabase
        .from('project_assignments')
        .update({ 
          status, 
          updated_at: new Date().toISOString()
        })
        .eq('id', assignmentId)
        .select()
        .single()

      if (error) throw error

      const { data: partnerProfile } = await supabase
        .from('profiles')
        .select('company_name, full_name')
        .eq('id', user.id)
        .single()

      const partnerName = partnerProfile?.company_name || partnerProfile?.full_name || 'Vendor'
      const projectTitle = assignment.project?.title || 'Project'

      await notifyProjectResponse(
        supabase,
        assignment.partnership.lead_org_id,
        partnerName,
        projectTitle,
        status === 'accepted',
        projectId
      )

      const { data: agencyUser } = await supabase
        .from('profiles')
        .select('email, company_name, full_name')
        .eq('id', assignment.partnership.lead_org_id)
        .single()

      if (agencyUser?.email) {
        const responseSubject =
          status === 'accepted'
            ? `${partnerName} accepted the RFP for ${projectTitle}`
            : `${partnerName} declined the RFP for ${projectTitle}`
        const responsePlain =
          status === 'accepted'
            ? `${partnerName} has accepted the RFP and confirmed their interest in ${projectTitle}.\n\nYou can now expect a bid submission from them in the platform.`
            : `${partnerName} has declined the RFP for ${projectTitle}.\n\nYou may want to broadcast this scope to additional vendors or reach out directly through the platform.`
        await sendTransactionalEmail({
          to: agencyUser.email,
          subject: responseSubject,
          html: buildBrandedEmailHtml({
            title: status === 'accepted' ? "Vendor accepted RFP" : "Vendor declined RFP",
            recipientName:
              agencyUser.company_name?.trim() ||
              agencyUser.full_name?.trim() ||
              agencyUser.email?.trim() ||
              "there",
            body: responsePlain,
            ctaText: "View Assignment",
            ctaUrl: `${siteBaseUrl()}/agency/bids`,
          }),
        })
      }

      return NextResponse.json({ assignment: updated })
    }

    if (isAgency) {
      if (!['awarded', 'completed', 'declined'].includes(status)) {
        return NextResponse.json({ error: 'Invalid status for agency' }, { status: 400 })
      }

      const updates: Record<string, unknown> = {
        status,
        updated_at: new Date().toISOString(),
      }
      if (status === 'awarded') {
        updates.awarded_at = new Date().toISOString()
      }

      const { data: updated, error } = await supabase
        .from('project_assignments')
        .update(updates)
        .eq('id', assignmentId)
        .select()
        .single()

      if (error) throw error

      if (status === 'awarded') {
        const preAward = new Set(['draft', 'onboarding'])
        const proj = assignment.project as { status?: string | null } | null | undefined
        const ps = String(proj?.status ?? '').toLowerCase()
        if (preAward.has(ps)) {
          const { error: projUpdErr } = await supabase
            .from('projects')
            .update({ status: 'in_progress', updated_at: updates.updated_at as string })
            .eq('id', projectId)
            .eq('org_id', user.id)
          if (projUpdErr) {
            console.error('[api] PATCH assignment awarded: project status bump failed', {
              projectId,
              message: projUpdErr.message,
              code: projUpdErr.code,
            })
          }
        }
      }

      if (status === 'awarded' && assignment.partnership.vendor_org_id) {
        const { data: agencyProfile } = await supabase
          .from('profiles')
          .select('company_name, full_name')
          .eq('id', user.id)
          .single()

        const agencyName = agencyProfile?.company_name || agencyProfile?.full_name || 'Lead agency'
        const projectTitle = assignment.project?.title || 'Project'

        await notifyProjectAwarded(
          supabase,
          assignment.partnership.vendor_org_id,
          projectTitle,
          agencyName,
          projectId
        )

        const { data: partnerRow } = await supabase
          .from('profiles')
          .select('email, full_name, company_name')
          .eq('id', assignment.partnership.vendor_org_id)
          .single()

        if (partnerRow?.email) {
          const partnerRecipient =
            partnerRow.company_name?.trim() ||
            partnerRow.full_name?.trim() ||
            partnerRow.email.trim()
          await sendTransactionalEmail({
            to: partnerRow.email,
            subject: `You've been awarded ${projectTitle}`,
            html: buildBrandedEmailHtml({
              title: "You have been awarded",
              recipientName: partnerRecipient,
              body: `Congratulations, you have been selected for ${projectTitle}.\n\nLog in to your Ligament partner portal to view the full award details and prepare for onboarding.`,
              ctaText: "View Award",
              ctaUrl: `${siteBaseUrl()}/partner/projects`,
            }),
          })
        }
      }

      return NextResponse.json({ assignment: updated })
    }

    return NextResponse.json({ error: 'Invalid operation' }, { status: 400 })
  } catch (error) {
    console.error('Error updating assignment:', error)
    return NextResponse.json({ error: 'Failed to update assignment' }, { status: 500 })
  }
}
