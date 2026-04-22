import { type NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  notifyProjectAssignment,
  notifyProjectResponse,
  notifyProjectAwarded,
} from '@/lib/notifications'
import { sendTransactionalEmail, siteBaseUrl } from '@/lib/email'

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
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.log('[api] start', { route, method: 'GET', userId: user.id, role: 'agency' })

    const { data: project } = await supabase
      .from('projects')
      .select('agency_id')
      .eq('id', projectId)
      .single()

    if (!project || project.agency_id !== user.id) {
      return NextResponse.json({ error: 'Project not found or access denied' }, { status: 404 })
    }

    const { data: assignments, error } = await supabase
      .from('project_assignments')
      .select(`
        *,
        partnership:partnerships(
          id,
          partner:profiles!partnerships_partner_id_fkey(
            id, email, full_name, company_name
          )
        )
      `)
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })

    if (error) throw error

    console.log('[api] success', { route, method: 'GET', userId: user.id, role: 'agency', rowCount: assignments?.length ?? 0 })
    return NextResponse.json({ assignments }, { headers: noStoreHeaders })
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
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: project } = await supabase
      .from('projects')
      .select('agency_id, status, title')
      .eq('id', projectId)
      .single()

    if (!project || project.agency_id !== user.id) {
      return NextResponse.json({ error: 'Project not found or access denied' }, { status: 404 })
    }

    const { partnershipId, notes } = await request.json()

    if (!partnershipId) {
      return NextResponse.json({ error: 'Partnership ID required' }, { status: 400 })
    }

    const { data: partnership } = await supabase
      .from('partnerships')
      .select('id, agency_id, partner_id, status')
      .eq('id', partnershipId)
      .eq('agency_id', user.id)
      .single()

    if (!partnership) {
      return NextResponse.json({ error: 'Partnership not found' }, { status: 404 })
    }

    if (partnership.status !== 'active' || !partnership.partner_id) {
      return NextResponse.json({ error: 'Partnership must be active with a connected partner account' }, { status: 400 })
    }

    const { data: existing } = await supabase
      .from('project_assignments')
      .select('id')
      .eq('project_id', projectId)
      .eq('partnership_id', partnershipId)
      .single()

    if (existing) {
      return NextResponse.json({ error: 'Partner already assigned to this project' }, { status: 400 })
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
      .from('project_assignments')
      .insert(insertPayload)
      .select(`
        *,
        partnership:partnerships(
          partner:profiles!partnerships_partner_id_fkey(
            id, email, full_name, company_name
          )
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
      partnership.partner_id,
      projectName,
      agencyName,
      assignment.id,
      projectId
    )

    const partnerEmail = assignment.partnership?.partner?.email
    if (partnerEmail) {
      const base = siteBaseUrl()
      await sendTransactionalEmail({
        to: partnerEmail,
        subject: `New RFP from ${agencyName}: ${projectName}`,
        html: `
          <p style="font-family:system-ui,sans-serif;line-height:1.6;color:#0C3535">
            ${agencyName} has sent you an RFP for ${projectName} on Ligament.
          </p>
          <p style="font-family:system-ui,sans-serif;line-height:1.6;color:#0C3535">
            Review the scope, timeline, and budget details, then submit your bid directly through the platform.
          </p>
          <p style="font-family:system-ui,sans-serif">
            <a href="${base}/partner/rfps" style="color:#0C3535;font-weight:700">View RFP</a>
          </p>
          <p style="font-family:system-ui,sans-serif;color:#666;font-size:13px">The Ligament Team<br /><a href="https://withligament.com">withligament.com</a></p>
        `,
      })
    }

    return NextResponse.json({ assignment })
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
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { assignmentId, status } = await request.json()

    if (!assignmentId || !status) {
      return NextResponse.json({ error: 'Assignment ID and status required' }, { status: 400 })
    }

    const { data: assignment } = await supabase
      .from('project_assignments')
      .select(`
        *,
        partnership:partnerships(agency_id, partner_id),
        project:projects(id, agency_id, title, status)
      `)
      .eq('id', assignmentId)
      .eq('project_id', projectId)
      .single()

    if (!assignment) {
      return NextResponse.json({ error: 'Assignment not found' }, { status: 404 })
    }

    const isAgency = assignment.project.agency_id === user.id
    const isPartner = assignment.partnership.partner_id === user.id

    if (!isAgency && !isPartner) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    if (isPartner && assignment.status === 'invited') {
      if (!['accepted', 'declined'].includes(status)) {
        return NextResponse.json({ error: 'Invalid status for partner' }, { status: 400 })
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

      const partnerName = partnerProfile?.company_name || partnerProfile?.full_name || 'Partner'
      const projectTitle = assignment.project?.title || 'Project'

      await notifyProjectResponse(
        supabase,
        assignment.partnership.agency_id,
        partnerName,
        projectTitle,
        status === 'accepted',
        projectId
      )

      const { data: agencyUser } = await supabase
        .from('profiles')
        .select('email, company_name, full_name')
        .eq('id', assignment.partnership.agency_id)
        .single()

      if (agencyUser?.email) {
        const responseSubject =
          status === 'accepted'
            ? `${partnerName} accepted the RFP for ${projectTitle}`
            : `${partnerName} declined the RFP for ${projectTitle}`
        const responseBody =
          status === 'accepted'
            ? `<p style="font-family:system-ui,sans-serif">${partnerName} has accepted the RFP and confirmed their interest in ${projectTitle}.</p>
            <p style="font-family:system-ui,sans-serif">You can now expect a bid submission from them in the platform.</p>`
            : `<p style="font-family:system-ui,sans-serif">${partnerName} has declined the RFP for ${projectTitle}.</p>
            <p style="font-family:system-ui,sans-serif">You may want to broadcast this scope to additional partners or reach out directly through the platform.</p>`
        await sendTransactionalEmail({
          to: agencyUser.email,
          subject: responseSubject,
          html: `${responseBody}
            <p><a href="${siteBaseUrl()}/agency/bids">View Assignment</a></p>
            <p style="font-family:system-ui,sans-serif;color:#666;font-size:13px">The Ligament Team<br /><a href="https://withligament.com">withligament.com</a></p>`,
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
            .eq('agency_id', user.id)
          if (projUpdErr) {
            console.error('[api] PATCH assignment awarded: project status bump failed', {
              projectId,
              message: projUpdErr.message,
              code: projUpdErr.code,
            })
          }
        }
      }

      if (status === 'awarded' && assignment.partnership.partner_id) {
        const { data: agencyProfile } = await supabase
          .from('profiles')
          .select('company_name, full_name')
          .eq('id', user.id)
          .single()

        const agencyName = agencyProfile?.company_name || agencyProfile?.full_name || 'Lead agency'
        const projectTitle = assignment.project?.title || 'Project'

        await notifyProjectAwarded(
          supabase,
          assignment.partnership.partner_id,
          projectTitle,
          agencyName,
          projectId
        )

        const { data: partnerRow } = await supabase
          .from('profiles')
          .select('email')
          .eq('id', assignment.partnership.partner_id)
          .single()

        if (partnerRow?.email) {
          await sendTransactionalEmail({
            to: partnerRow.email,
            subject: `You've been awarded ${projectTitle}`,
            html: `<p style="font-family:system-ui,sans-serif">Congratulations, you have been selected for ${projectTitle}.</p>
              <p style="font-family:system-ui,sans-serif">Log in to your Ligament partner portal to view the full award details and prepare for onboarding.</p>
              <p><a href="${siteBaseUrl()}/partner/projects">View Award</a></p>
              <p style="font-family:system-ui,sans-serif;color:#666;font-size:13px">The Ligament Team<br /><a href="https://withligament.com">withligament.com</a></p>`,
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
