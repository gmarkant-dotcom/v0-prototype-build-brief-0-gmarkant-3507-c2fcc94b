import { type NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { notifyPartnershipInvitation, notifyPartnershipAccepted } from '@/lib/notifications'
import { Resend } from 'resend'

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
            id, email, full_name, company_name
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

    const { partnerEmail, message } = await request.json()

    if (!partnerEmail) {
      return NextResponse.json({ error: 'Partner email required' }, { status: 400 })
    }

    // Find the partner by email (case-insensitive)
    const { data: partner, error: partnerLookupErr } = await supabase
      .from('profiles')
      .select('id, email, role')
      .ilike('email', partnerEmail.trim())
      .maybeSingle()

    if (partnerLookupErr) {
      console.error('[api] POST /partnerships partner lookup by email failed', {
        route,
        userId: user.id,
        partnerEmail: partnerEmail.trim(),
        message: partnerLookupErr.message,
        code: partnerLookupErr.code,
      })
      return NextResponse.json({ error: 'Failed to look up partner' }, { status: 500 })
    }

    // Partner exists - verify they are a partner role
    if (partner && partner.role !== 'partner') {
      return NextResponse.json({ error: 'Can only invite partner agencies, not lead agencies' }, { status: 400 })
    }

    // Check if partnership already exists (by partner_id or partner_email)
    let existingQuery = supabase
      .from('partnerships')
      .select('id, status, partner_id')
      .eq('agency_id', user.id)
    
    if (partner) {
      existingQuery = existingQuery.eq('partner_id', partner.id)
    } else {
      existingQuery = existingQuery.ilike('partner_email', partnerEmail.trim())
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
        const resendApiKey = process.env.RESEND_API_KEY
        if (resendApiKey) {
          const { Resend } = await import('resend')
          const resend = new Resend(resendApiKey)
          const siteUrl = 'https://withligament.com'
          // If partner has an account, link to invitations page; otherwise link to signup
          const acceptUrl = existingPartnerId 
            ? `${siteUrl}/partner/invitations` 
            : `${siteUrl}/signup?email=${encodeURIComponent(partnerEmail)}&invite=${reactivated.id}`

          await resend.emails.send({
            from: 'Ligament <notifications@withligament.com>',
            to: partnerEmail.trim(),
            subject: `${agencyName} has re-invited you to partner on Ligament`,
            html: `
              <!DOCTYPE html>
              <html>
              <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
              </head>
              <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #081F1F;">
                <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
                  <div style="text-align: center; margin-bottom: 32px;">
                    <div style="display: inline-block; background: #C8F53C; padding: 12px 24px; border-radius: 8px;">
                      <span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: 24px; color: #0C3535; letter-spacing: 0.05em; text-transform: uppercase;">LIGAMENT</span>
                    </div>
                  </div>
                  
                  <div style="background: #0C3535; border-radius: 16px; padding: 40px; border: 1px solid rgba(255,255,255,0.12);">
                    <div style="margin-bottom: 24px;">
                      <span style="font-family: 'IBM Plex Mono', monospace; font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: #C8F53C; background: rgba(200,245,60,0.1); padding: 6px 12px; border-radius: 4px; border: 1px solid rgba(200,245,60,0.3);">New Invitation</span>
                    </div>
                    
                    <h1 style="color: #FFFFFF; font-family: 'Barlow Condensed', sans-serif; font-size: 28px; margin: 0 0 16px 0; font-weight: 600; text-transform: uppercase; letter-spacing: 0.02em;">
                      You&apos;ve Been Re-Invited
                    </h1>
                    
                    <p style="color: #9BB8B8; font-size: 16px; line-height: 1.7; margin: 0 0 24px 0;">
                      <strong style="color: #FFFFFF;">${agencyName}</strong> would like to invite you again to join their partner network on Ligament.
                    </p>
                    
                    ${message ? `
                    <div style="background: rgba(255,255,255,0.05); border-radius: 8px; padding: 20px; margin: 0 0 24px 0; border-left: 3px solid #C8F53C;">
                      <p style="color: #9BB8B8; font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; margin: 0 0 8px 0; font-family: 'IBM Plex Mono', monospace;">Personal Message</p>
                      <p style="color: #E8E8E8; font-size: 14px; line-height: 1.6; margin: 0;">"${message}"</p>
                    </div>
                    ` : ''}
                    
                    <a href="${acceptUrl}" style="display: inline-block; background: #C8F53C; color: #0C3535; text-decoration: none; padding: 16px 32px; border-radius: 8px; font-weight: 700; font-size: 14px; text-transform: uppercase; letter-spacing: 0.05em;">
                      ${partner ? 'View Invitation' : 'Accept Invitation'}
                    </a>
                  </div>
                  
                  <div style="text-align: center; margin-top: 32px;">
                    <p style="color: #9BB8B8; font-size: 11px; font-family: 'IBM Plex Mono', monospace; margin: 0;">
                      <a href="${siteUrl}" style="color: #C8F53C; text-decoration: none;">withligament.com</a>
                    </p>
                  </div>
                </div>
              </body>
              </html>
            `,
          })
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
      partner_email: partnerEmail.trim().toLowerCase(),
      status: 'pending',
      invitation_message: message || null,
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
    const resendApiKey = process.env.RESEND_API_KEY
    if (resendApiKey) {
      try {
        const resend = new Resend(resendApiKey)
        // Always use production URL for email links (not sandbox URLs)
        const siteUrl = 'https://withligament.com'
        const acceptUrl = partner 
          ? `${siteUrl}/partner/invitations` 
          : `${siteUrl}/signup?email=${encodeURIComponent(partnerEmail)}&invite=${partnership.id}`
        
        await resend.emails.send({
          from: 'Ligament <notifications@withligament.com>',
          to: partnerEmail.trim(),
          subject: `${agencyName} has invited you to partner on Ligament`,
          html: `
            <!DOCTYPE html>
            <html>
            <head>
              <meta charset="utf-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
            </head>
            <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #081F1F;">
              <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
                <!-- Header with Logo -->
                <div style="text-align: center; margin-bottom: 32px;">
                  <div style="display: inline-block; background: #C8F53C; padding: 12px 24px; border-radius: 8px;">
                    <span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: 24px; color: #0C3535; letter-spacing: 0.05em; text-transform: uppercase;">LIGAMENT</span>
                  </div>
                </div>
                
                <!-- Main Card -->
                <div style="background: #0C3535; border-radius: 16px; padding: 40px; border: 1px solid rgba(255,255,255,0.12);">
                  <!-- Badge -->
                  <div style="margin-bottom: 24px;">
                    <span style="font-family: 'IBM Plex Mono', monospace; font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: #C8F53C; background: rgba(200,245,60,0.1); padding: 6px 12px; border-radius: 4px; border: 1px solid rgba(200,245,60,0.3);">Partnership Invitation</span>
                  </div>
                  
                  <h1 style="color: #FFFFFF; font-family: 'Barlow Condensed', sans-serif; font-size: 28px; margin: 0 0 16px 0; font-weight: 600; text-transform: uppercase; letter-spacing: 0.02em;">
                    You&apos;ve Been Invited
                  </h1>
                  
                  <p style="color: #9BB8B8; font-size: 16px; line-height: 1.7; margin: 0 0 24px 0;">
                    <strong style="color: #FFFFFF;">${agencyName}</strong> would like to add you as a partner agency on Ligament, the agency collaboration platform.
                  </p>
                  
                  ${message ? `
                  <div style="background: rgba(255,255,255,0.05); border-radius: 8px; padding: 20px; margin: 0 0 24px 0; border-left: 3px solid #C8F53C;">
                    <p style="color: #9BB8B8; font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; margin: 0 0 8px 0; font-family: 'IBM Plex Mono', monospace;">Personal Message</p>
                    <p style="color: #E8E8E8; font-size: 14px; line-height: 1.6; margin: 0;">
                      "${message}"
                    </p>
                  </div>
                  ` : ''}
                  
                  <p style="color: #9BB8B8; font-size: 14px; line-height: 1.6; margin: 0 0 32px 0;">
                    ${partner 
                      ? 'Log in to your Ligament account to review and accept this partnership invitation.'
                      : 'Create your free Ligament account to accept this invitation and start collaborating on projects together.'}
                  </p>
                  
                  <!-- CTA Button -->
                  <a href="${acceptUrl}" style="display: inline-block; background: #C8F53C; color: #0C3535; text-decoration: none; padding: 16px 32px; border-radius: 8px; font-weight: 700; font-size: 14px; text-transform: uppercase; letter-spacing: 0.05em;">
                    ${partner ? 'View Invitation' : 'Accept Invitation'}
                  </a>
                  
                  <!-- Divider -->
                  <div style="border-top: 1px solid rgba(255,255,255,0.1); margin: 32px 0 24px 0;"></div>
                  
                  <!-- What is Ligament -->
                  <div style="background: rgba(255,255,255,0.03); border-radius: 8px; padding: 16px;">
                    <p style="color: #9BB8B8; font-size: 12px; line-height: 1.6; margin: 0;">
                      <strong style="color: #E8E8E8;">What is Ligament?</strong><br>
                      Ligament connects lead agencies with specialized partners for seamless project collaboration. Share briefs, manage workflows, and deliver exceptional work together.
                    </p>
                  </div>
                </div>
                
                <!-- Footer -->
                <div style="text-align: center; margin-top: 32px;">
                  <p style="color: #9BB8B8; font-size: 11px; font-family: 'IBM Plex Mono', monospace; margin: 0 0 8px 0;">
                    If you didn&apos;t expect this invitation, you can safely ignore this email.
                  </p>
                  <p style="color: #9BB8B8; font-size: 11px; font-family: 'IBM Plex Mono', monospace; margin: 0;">
                    <a href="${siteUrl}" style="color: #C8F53C; text-decoration: none;">withligament.com</a>
                  </p>
                </div>
              </div>
            </body>
            </html>
          `,
        })
      } catch (emailErr) {
        console.error('Error sending partnership invitation email:', emailErr)
        // Don't fail the whole request if email fails
      }
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
      const { data: updated, error } = await supabase
        .from('partnerships')
        .update({
          nda_confirmed_at: new Date().toISOString(),
          nda_confirmed_by: user.id,
          updated_at: new Date().toISOString(),
        })
        .eq('id', partnershipId)
        .eq('agency_id', user.id)
        .select()
        .single()
      if (error) throw error
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
          .select('email')
          .eq('id', partnership.agency_id)
          .single()

        if (agencyProfile?.email) {
          const { sendTransactionalEmail, siteBaseUrl } = await import('@/lib/email')
          await sendTransactionalEmail({
            to: agencyProfile.email,
            subject: `${partnerName} accepted your partnership invitation`,
            html: `<p style="font-family:system-ui,sans-serif"><strong>${partnerName}</strong> accepted your invitation to collaborate on Ligament.</p>
              <p><a href="${siteBaseUrl()}/agency/pool">Partner pool →</a></p>`,
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
