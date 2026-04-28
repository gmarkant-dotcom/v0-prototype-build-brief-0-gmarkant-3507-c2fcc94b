import { type NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { notifyPartnershipInvitation, notifyPartnershipAccepted } from '@/lib/notifications'
import { buildBrandedEmailHtml, sendTransactionalEmail, siteBaseUrl } from '@/lib/email'

export const dynamic = 'force-dynamic'

const noStoreHeaders = {
  'Cache-Control': 'private, no-store, no-cache, must-revalidate',
} as const

// GET - List partnerships for current user
export async function GET(request: NextRequest) {
  try {
    const route = '/api/partnerships'
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user's role
    const { data: profile, error: profileErr } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()
    if (profileErr) {
      console.error('[api] GET /partnerships profile load failed', {
        route,
        userId: user.id,
        message: profileErr.message,
        code: profileErr.code,
      })
      return NextResponse.json({ error: 'Failed to load profile' }, { status: 500, headers: noStoreHeaders })
    }
    console.log('[api] start', { route, method: 'GET', userId: user.id, role: profile?.role ?? null })

    let partnerships
    
    if (profile?.role === 'agency') {
      // Agency sees rows where they are agency_id (not partner_id).
      const rich = await supabase
        .from('partnerships')
        .select(`
          *,
          partner:profiles!partnerships_partner_id_fkey(
            id, email, full_name, company_name, capabilities
          )
        `)
        .eq('agency_id', user.id)
        .order('created_at', { ascending: false })

      if (!rich.error && rich.data) {
        partnerships = rich.data
      } else {
        if (rich.error) {
          console.error('[api] GET /partnerships agency branch embed failed, falling back to plain select', {
            userId: user.id,
            message: rich.error.message,
            code: rich.error.code,
            details: rich.error.details,
            hint: rich.error.hint,
          })
        }
        const simple = await supabase
          .from('partnerships')
          .select('*')
          .eq('agency_id', user.id)
          .order('created_at', { ascending: false })
        if (simple.error) throw simple.error
        partnerships = simple.data
      }
    } else {
      // Partner sees agencies that invited them (by partner_id OR by email)
      // First get the partner's email from their profile
      const { data: partnerProfile, error: partnerProfileErr } = await supabase
        .from('profiles')
        .select('email')
        .eq('id', user.id)
        .single()
      if (partnerProfileErr) {
        console.error('[api] GET /partnerships partner profile email load failed', {
          route,
          userId: user.id,
          message: partnerProfileErr.message,
          code: partnerProfileErr.code,
        })
        return NextResponse.json({ error: 'Failed to load partner profile' }, { status: 500, headers: noStoreHeaders })
      }

      // Get partnerships by partner_id
      const { data: byId, error: byIdError } = await supabase
        .from('partnerships')
        .select('*')
        .eq('partner_id', user.id)
        .order('created_at', { ascending: false })

      if (byIdError) throw byIdError
      
      // Also get partnerships by email (for invitations sent before account creation)
      let byEmailData: typeof byId = []
      if (partnerProfile?.email) {
        const { data: byEmail, error: byEmailError } = await supabase
          .from('partnerships')
          .select('*')
          .ilike('partner_email', partnerProfile.email.trim())
          .is('partner_id', null) // Only get unclaimed email invitations
          .order('created_at', { ascending: false })

        if (byEmailError) {
          console.error('[api] GET /partnerships partner branch ilike partner_email query failed', {
            route,
            userId: user.id,
            emailPresent: Boolean(partnerProfile?.email),
            message: byEmailError.message,
            code: byEmailError.code,
          })
        } else if (byEmail && byEmail.length > 0) {
          byEmailData = byEmail

          // Auto-claim these invitations by setting partner_id
          for (const invitation of byEmail) {
            const { error: claimErr } = await supabase
              .from('partnerships')
              .update({ partner_id: user.id })
              .eq('id', invitation.id)
            if (claimErr) {
              console.error('[api] GET /partnerships auto-claim invitation update failed', {
                route,
                userId: user.id,
                partnershipId: invitation.id,
                message: claimErr.message,
                code: claimErr.code,
              })
            }
          }
        }
      }
      
      const allPartnerships = [...(byId || []), ...byEmailData]
      
      // Manually fetch agency profiles for each partnership
      const agencyIds = [...new Set(allPartnerships.map(p => p.agency_id).filter(Boolean))]
      
      let agencyProfiles: Record<string, { id: string; email: string; full_name: string; company_name: string }> = {}
      if (agencyIds.length > 0) {
        const { data: agencies, error: agenciesErr } = await supabase
          .from('profiles')
          .select('id, email, full_name, company_name')
          .in('id', agencyIds)

        if (agenciesErr) {
          console.error('[api] GET /partnerships agency profiles batch load failed', {
            route,
            userId: user.id,
            agencyIdCount: agencyIds.length,
            message: agenciesErr.message,
            code: agenciesErr.code,
          })
        }

        if (agencies) {
          agencyProfiles = agencies.reduce((acc, agency) => {
            acc[agency.id] = agency
            return acc
          }, {} as typeof agencyProfiles)
        }
      }
      
      // Attach agency data; strip private lead-agency notes (never exposed to partners).
      partnerships = allPartnerships.map((p) => {
        const { partnership_notes: _omitNotes, ...rest } = p as Record<string, unknown>
        return {
          ...rest,
          agency: agencyProfiles[p.agency_id as string] || null,
        }
      })
    }

    console.log('[api] success', {
      route,
      method: 'GET',
      userId: user.id,
      role: profile?.role ?? null,
      rowCount: Array.isArray(partnerships) ? partnerships.length : 0,
    })
    return NextResponse.json({ partnerships }, { headers: noStoreHeaders })
  } catch (error) {
    console.error('[api] failure', {
      route: '/api/partnerships',
      method: 'GET',
      code: 500,
      message: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: 'Failed to fetch partnerships' }, { status: 500, headers: noStoreHeaders })
  }
}

// POST - Create a new partnership (agency invites partner)
export async function POST(request: NextRequest) {
  try {
    const route = '/api/partnerships'
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Verify user is an agency
    const { data: profile, error: postProfileErr } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()
    if (postProfileErr) {
      console.error('[api] POST /partnerships profile load failed', {
        route,
        userId: user.id,
        message: postProfileErr.message,
        code: postProfileErr.code,
      })
      return NextResponse.json({ error: 'Failed to load profile' }, { status: 500 })
    }
    console.log('[api] start', { route, method: 'POST', userId: user.id, role: profile?.role ?? null })

    if (profile?.role !== 'agency') {
      return NextResponse.json({ error: 'Only agencies can invite partners' }, { status: 403 })
    }

    const payload = (await request.json().catch(() => ({}))) as {
      partnerId?: string
      partnerEmail?: string
      message?: string | null
    }
    const message = payload.message
    const partnerId = typeof payload.partnerId === 'string' ? payload.partnerId.trim() : ''
    const partnerEmail = typeof payload.partnerEmail === 'string' ? payload.partnerEmail.trim() : ''

    if (!partnerId && !partnerEmail) {
      return NextResponse.json({ error: 'Partner ID or partner email required' }, { status: 400 })
    }

    let partner: { id: string; email: string | null; role: string | null } | null = null

    if (partnerId) {
      const { data: partnerById, error: partnerByIdErr } = await supabase
        .from('profiles')
        .select('id, email, role')
        .eq('id', partnerId)
        .maybeSingle()

      if (partnerByIdErr) {
        console.error('[api] POST /partnerships partner lookup by id failed', {
          route,
          userId: user.id,
          partnerId,
          message: partnerByIdErr.message,
          code: partnerByIdErr.code,
        })
        return NextResponse.json({ error: 'Failed to look up partner' }, { status: 500 })
      }
      if (!partnerById) {
        return NextResponse.json({ error: 'Partner not found' }, { status: 404 })
      }
      partner = partnerById
    } else {
      // Backward-compatible path: look up by email and resolve to profile.
      const { data: partnerByEmail, error: partnerLookupErr } = await supabase
        .from('profiles')
        .select('id, email, role')
        .ilike('email', partnerEmail)
        .maybeSingle()

      if (partnerLookupErr) {
        console.error('[api] POST /partnerships partner lookup by email failed', {
          route,
          userId: user.id,
          partnerEmail,
          message: partnerLookupErr.message,
          code: partnerLookupErr.code,
        })
        return NextResponse.json({ error: 'Failed to look up partner' }, { status: 500 })
      }
      partner = partnerByEmail
    }

    // Partner exists - verify they are a partner role
    if (partner && partner.role !== 'partner') {
      return NextResponse.json({ error: 'Can only invite partner agencies, not lead agencies' }, { status: 400 })
    }

    const normalizedPartnerEmail = (partner?.email || partnerEmail).trim().toLowerCase()
    if (!normalizedPartnerEmail) {
      return NextResponse.json({ error: 'Partner email required' }, { status: 400 })
    }

    // Check if partnership already exists (by partner_id or partner_email)
    let existingQuery = supabase
      .from('partnerships')
      .select('id, status, partner_id')
      .eq('agency_id', user.id)
    
    if (partner) {
      existingQuery = existingQuery.eq('partner_id', partner.id)
    } else {
      existingQuery = existingQuery.ilike('partner_email', normalizedPartnerEmail)
    }
    
    const { data: existing, error: existingErr } = await existingQuery.maybeSingle()

    if (existingErr) {
      console.error('[api] POST /partnerships existing partnership lookup failed', {
        route,
        userId: user.id,
        hasPartnerRow: !!partner,
        message: existingErr.message,
        code: existingErr.code,
      })
      return NextResponse.json({ error: 'Failed to check existing partnership' }, { status: 500 })
    }

    if (existing) {
      // If partnership was terminated (declined), allow re-invitation by updating status back to pending
      if (existing.status === 'terminated') {
        const { data: reactivated, error: reactivateError } = await supabase
          .from('partnerships')
          .update({ 
            status: 'pending', 
            invitation_message: message || null,
            accepted_at: null,
            updated_at: new Date().toISOString()
          })
          .eq('id', existing.id)
          .select('*')
          .single()
        
        if (reactivateError) throw reactivateError
        
        // Get agency name for notification/email
        const { data: agencyProfile } = await supabase
          .from('profiles')
          .select('company_name, full_name')
          .eq('id', user.id)
          .single()
        
        const agencyName = agencyProfile?.company_name || agencyProfile?.full_name || 'A lead agency'
        
        // Check if partner has an account (existing.partner_id is set from previous invitation)
        const existingPartnerId = existing.partner_id
        
        // Notify the partner of re-invitation if they have an account
        if (existingPartnerId) {
          const { notifyPartnershipInvitation } = await import('@/lib/notifications')
          await notifyPartnershipInvitation(supabase, existingPartnerId, agencyName, reactivated.id)
        }
        
    // Send email for re-invitation
        const siteUrl = siteBaseUrl()
        const acceptUrl = partner
          ? `${siteUrl}/partner/invitations`
          : `${siteUrl}/auth/sign-up?invite_type=partnership&email=${encodeURIComponent(normalizedPartnerEmail)}&next=${encodeURIComponent("/partner/invitations")}`
        let reinviteBody = `${agencyName} would like to reconnect with you on Ligament and has sent a new partnership invitation.`
        if (message && String(message).trim()) {
          reinviteBody += `\n\nPersonal message:\n${String(message).trim()}`
        }
        try {
          await sendTransactionalEmail({
            to: normalizedPartnerEmail,
            subject: `${agencyName} has re-invited you to their partner network on Ligament`,
            html: buildBrandedEmailHtml({
              title: "Partnership re-invitation",
              recipientName: normalizedPartnerEmail,
              body: reinviteBody,
              ctaText: partner ? "View Invitation" : "Accept Invitation",
              ctaUrl: acceptUrl,
            }),
          })
        } catch (emailErr) {
          console.error('Error sending partnership re-invitation email:', emailErr)
        }
        
        return NextResponse.json({ 
          partnership: reactivated, 
          message: 'Partnership invitation re-sent successfully' 
        })
      }
      
      // For active or pending partnerships, don't allow duplicate
      return NextResponse.json({ 
        error: `Partnership already exists (status: ${existing.status})` 
      }, { status: 400 })
    }

    // Create partnership - with partner_id if they exist, or just email if they don't
    const insertData: {
      agency_id: string
      partner_id?: string
      partner_email: string
      status: string
      invitation_message?: string
    } = {
      agency_id: user.id,
      partner_email: normalizedPartnerEmail,
      status: 'pending',
      invitation_message: message || undefined,
    }
    
    // If partner exists, also set partner_id
    if (partner) {
      insertData.partner_id = partner.id
    }

    const { data: partnership, error } = await supabase
      .from('partnerships')
      .insert(insertData)
      .select('*')
      .single()

    if (error) throw error

    // Get agency name for notification/email
    const { data: agencyProfile } = await supabase
      .from('profiles')
      .select('company_name, full_name')
      .eq('id', user.id)
      .single()
    
    const agencyName = agencyProfile?.company_name || agencyProfile?.full_name || 'A lead agency'

    // If partner exists, send in-app notification
    if (partner) {
      await notifyPartnershipInvitation(supabase, partner.id, agencyName, partnership.id)
    }
    
    // Send email invitation to partner (whether they have account or not)
    try {
      const siteUrl = siteBaseUrl()
      const acceptUrl = partner
        ? `${siteUrl}/partner/invitations`
        : `${siteUrl}/auth/sign-up?invite_type=partnership&email=${encodeURIComponent(normalizedPartnerEmail)}&next=${encodeURIComponent("/partner/invitations")}`
      let inviteBody = `${agencyName} has selected you as a potential partner on Ligament, a platform for vendor orchestration between creative and production agencies.\n\nJoining their network means you will be considered for scoped project opportunities they broadcast directly to their trusted partners.`
      if (message && String(message).trim()) {
        inviteBody += `\n\nPersonal message:\n${String(message).trim()}`
      }
      await sendTransactionalEmail({
        to: normalizedPartnerEmail,
        subject: `${agencyName} has invited you to join their partner network on Ligament`,
        html: buildBrandedEmailHtml({
          title: "Partnership invitation",
          recipientName: normalizedPartnerEmail,
          body: inviteBody,
          ctaText: partner ? "View Invitation" : "Accept Invitation",
          ctaUrl: acceptUrl,
        }),
      })
    } catch (emailErr) {
      console.error('Error sending partnership invitation email:', emailErr)
      // Don't fail the whole request if email fails
    }

    console.log('[api] success', { route, method: 'POST', userId: user.id, role: profile?.role ?? null, recordId: partnership.id })
    return NextResponse.json({ 
      partnership,
      partnerExists: !!partner,
      message: partner 
        ? 'Invitation sent to partner' 
        : 'Invitation created. Partner will see it when they sign up with this email.'
    })
  } catch (error) {
    console.error('[api] failure', {
      route: '/api/partnerships',
      method: 'POST',
      code: 500,
      message: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: 'Failed to create partnership' }, { status: 500 })
  }
}

// PATCH - Update partnership status (partner accepts/declines)
export async function PATCH(request: NextRequest) {
  try {
    const route = '/api/partnerships'
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.log('[api] start', { route, method: 'PATCH', userId: user.id, role: null })

    const { partnershipId, status, action } = await request.json()

    if (!partnershipId) {
      return NextResponse.json({ error: 'Partnership ID required' }, { status: 400 })
    }

    // Get partnership to verify ownership
    const { data: partnership, error: partnershipFetchErr } = await supabase
      .from('partnerships')
      .select('agency_id, partner_id, status')
      .eq('id', partnershipId)
      .maybeSingle()

    if (partnershipFetchErr) {
      console.error('[api] PATCH /partnerships load partnership failed', {
        route,
        userId: user.id,
        partnershipId,
        message: partnershipFetchErr.message,
        code: partnershipFetchErr.code,
      })
      return NextResponse.json({ error: 'Failed to load partnership' }, { status: 500 })
    }

    if (!partnership) {
      return NextResponse.json({ error: 'Partnership not found' }, { status: 404 })
    }

    // Partners can only accept (pending -> active)
    // Agencies can suspend/terminate
    const isAgency = partnership.agency_id === user.id
    const isPartner = partnership.partner_id === user.id
    
    if (!isAgency && !isPartner) {
      return NextResponse.json({ error: 'Access denied - you are not part of this partnership' }, { status: 403 })
    }

    if (action === 'confirm_nda') {
      if (!isAgency) {
        return NextResponse.json({ error: 'Only agencies can confirm NDA status' }, { status: 403 })
      }
      const now = new Date().toISOString()
      const { data: updated, error } = await supabase
        .from('partnerships')
        .update({
          nda_confirmed_at: now,
          nda_confirmed_by: user.id,
          updated_at: now,
        })
        .eq('id', partnershipId)
        .eq('agency_id', user.id)
        .select()
        .single()
      if (error) throw error

      const { data: inboxRows } = await supabase
        .from('partner_rfp_inbox')
        .select('id, recipient_email, scope_item_name')
        .eq('partnership_id', partnershipId)
        .eq('nda_gate_enforced', true)
        .is('nda_confirmed_at', null)

      await supabase
        .from('partner_rfp_inbox')
        .update({ nda_confirmed_at: now, updated_at: now })
        .eq('partnership_id', partnershipId)
        .eq('nda_gate_enforced', true)
        .is('nda_confirmed_at', null)

      const partnerEmailFromInbox = (inboxRows || [])
        .map((row) => (row.recipient_email || '').trim().toLowerCase())
        .find(Boolean)
      let partnerEmail = partnerEmailFromInbox || null
      if (!partnerEmail && partnership.partner_id) {
        const { data: partnerProfile } = await supabase
          .from('profiles')
          .select('email')
          .eq('id', partnership.partner_id)
          .maybeSingle()
        partnerEmail = (partnerProfile?.email || '').trim().toLowerCase() || null
      }

      if (partnerEmail) {
        const baseUrl = siteBaseUrl()
        const { data: agencyProfile } = await supabase
          .from('profiles')
          .select('company_name, full_name')
          .eq('id', user.id)
          .maybeSingle()
        const agencyLabel =
          (agencyProfile?.company_name || agencyProfile?.full_name || 'Lead agency')
        const scopeName = (inboxRows?.[0]?.scope_item_name as string | undefined) || 'this scope'
        await sendTransactionalEmail({
          to: partnerEmail,
          subject: `Your NDA has been confirmed, ${scopeName} is now accessible`,
          html: buildBrandedEmailHtml({
            title: "NDA confirmed",
            recipientName: partnerEmail,
            body: `${agencyLabel} has confirmed your NDA for ${scopeName}.\n\nYou can now log in and view the full RFP details and submit your bid.`,
            ctaText: "View RFP",
            ctaUrl: `${baseUrl}/partner/rfps`,
          }),
        })
      }

      return NextResponse.json({ partnership: updated })
    }

    if (!status) {
      return NextResponse.json({ error: 'Status required' }, { status: 400 })
    }

    if (!['active', 'suspended', 'terminated'].includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }

    // Partner responding to invitation (accept or decline)
    if (isPartner && partnership.status === 'pending') {
      if (status === 'active') {
        // Accept invitation
        const { data: updated, error } = await supabase
          .from('partnerships')
          .update({ status: 'active', accepted_at: new Date().toISOString() })
          .eq('id', partnershipId)
          .select()
          .single()

        if (error) throw error
        
        // Get partner name for notification
        const { data: partnerProfile } = await supabase
          .from('profiles')
          .select('company_name, full_name')
          .eq('id', user.id)
          .single()
        
        const partnerName = partnerProfile?.company_name || partnerProfile?.full_name || 'A partner'
        
        // Notify agency that partner accepted
        await notifyPartnershipAccepted(supabase, partnership.agency_id, partnerName, partnershipId)

        const { data: agencyProfile } = await supabase
          .from('profiles')
          .select('email, company_name, full_name')
          .eq('id', partnership.agency_id)
          .single()

        if (agencyProfile?.email) {
          await sendTransactionalEmail({
            to: agencyProfile.email,
            subject: `${partnerName} accepted your partnership invitation`,
            html: buildBrandedEmailHtml({
              title: "Partner accepted invitation",
              recipientName:
                agencyProfile.company_name?.trim() ||
                agencyProfile.full_name?.trim() ||
                agencyProfile.email?.trim() ||
                "there",
              body: `${partnerName} has accepted your invitation and joined your partner network on Ligament.\n\nThey are now available to receive RFP broadcasts from your agency.`,
              ctaText: "View Partner",
              ctaUrl: `${siteBaseUrl()}/agency/pool`,
            }),
          })
        }
        
        return NextResponse.json({ partnership: updated })
      } else if (status === 'terminated') {
        // Decline invitation
        const { data: updated, error } = await supabase
          .from('partnerships')
          .update({ status: 'terminated', updated_at: new Date().toISOString() })
          .eq('id', partnershipId)
          .select()
          .single()

        if (error) throw error
        
        // Get partner name for notification
        const { data: partnerProfile } = await supabase
          .from('profiles')
          .select('company_name, full_name')
          .eq('id', user.id)
          .single()
        
        const partnerName = partnerProfile?.company_name || partnerProfile?.full_name || 'A partner'
        
        // Notify agency that partner declined
        const { notifyPartnershipDeclined } = await import('@/lib/notifications')
        await notifyPartnershipDeclined(supabase, partnership.agency_id, partnerName, partnershipId)

        // Send email to agency notifying them of the decline
        try {
          const { data: agencyProfile } = await supabase
            .from('profiles')
            .select('email, company_name, full_name')
            .eq('id', partnership.agency_id)
            .single()

          if (agencyProfile?.email) {
            await sendTransactionalEmail({
              to: agencyProfile.email,
              subject: `${partnerName} declined your partnership invitation`,
              html: buildBrandedEmailHtml({
                title: "Partnership invitation declined",
                recipientName:
                  agencyProfile.company_name?.trim() ||
                  agencyProfile.full_name?.trim() ||
                  agencyProfile.email?.trim() ||
                  "there",
                body: `${partnerName} has declined your partnership invitation on Ligament.\n\nYou can invite other partners from your partner pool or discover new ones in the marketplace.`,
                ctaText: "View Partner Pool",
                ctaUrl: `${siteBaseUrl()}/agency/pool`,
              }),
            })
          }
        } catch (emailErr) {
          console.error('Error sending partnership declined email:', emailErr)
        }

        return NextResponse.json({ partnership: updated })
      }
    }

    // Agency managing partnership
    if (isAgency) {
      const { data: updated, error } = await supabase
        .from('partnerships')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', partnershipId)
        .select()
        .single()

      if (error) throw error
      console.log('[api] success', { route, method: 'PATCH', userId: user.id, role: null, recordId: updated.id, status: updated.status })
      return NextResponse.json({ partnership: updated })
    }

    return NextResponse.json({ error: 'Invalid operation' }, { status: 400 })
  } catch (error) {
    console.error('[api] failure', {
      route: '/api/partnerships',
      method: 'PATCH',
      code: 500,
      message: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: 'Failed to update partnership' }, { status: 500 })
  }
}

// DELETE - Remove a partnership (agency only)
export async function DELETE(request: NextRequest) {
  try {
    const route = '/api/partnerships'
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.log('[api] start', { route, method: 'DELETE', userId: user.id, role: null })

    const { searchParams } = new URL(request.url)
    const partnershipId = searchParams.get('id')

    if (!partnershipId) {
      return NextResponse.json({ error: 'Partnership ID required' }, { status: 400 })
    }

    // Verify user is an agency and owns this partnership
    const { data: partnership, error: fetchError } = await supabase
      .from('partnerships')
      .select('agency_id, partner_id')
      .eq('id', partnershipId)
      .single()

    if (fetchError) {
      console.error('[api] DELETE /partnerships load partnership failed', {
        route,
        userId: user.id,
        partnershipId,
        message: fetchError.message,
        code: fetchError.code,
      })
      return NextResponse.json({ error: 'Partnership not found' }, { status: 404 })
    }
    if (!partnership) {
      return NextResponse.json({ error: 'Partnership not found' }, { status: 404 })
    }

    if (partnership.agency_id !== user.id) {
      return NextResponse.json({ error: 'Only the agency can delete this partnership' }, { status: 403 })
    }

    // Delete the partnership
    const { error: deleteError } = await supabase
      .from('partnerships')
      .delete()
      .eq('id', partnershipId)

    if (deleteError) throw deleteError

    console.log('[api] success', { route, method: 'DELETE', userId: user.id, role: null, recordId: partnershipId })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[api] failure', {
      route: '/api/partnerships',
      method: 'DELETE',
      code: 500,
      message: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: 'Failed to delete partnership' }, { status: 500 })
  }
}
