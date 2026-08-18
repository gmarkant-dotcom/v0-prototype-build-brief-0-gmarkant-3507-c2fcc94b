import { type NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { notifyPartnershipInvitation, notifyPartnershipAccepted } from '@/lib/notifications'
import { buildBrandedEmailHtml, resolveOrgNotificationRecipients, sendTransactionalEmail, siteBaseUrl } from '@/lib/email'
import { hasLigamentAccount } from '@/lib/server/account-existence'
import { resolveCallerOrgIds, resolveCallerWriteOrgId, resolveOrgIdForUser, callerOwnsOrg, orgIdFromColumn } from "@/lib/entitlements"
import { actingRole, canActAs } from '@/lib/acting-role'
import { can, capabilityDeniedMessage } from '@/lib/capabilities'
import { recordMilestone } from '@/lib/milestone-events'
import {
  ORG_CONTACT_SELECT_RICH,
  orgWireShape,
  logOrgContactGap,
  resolveOrgContact,
  type OrgEmbed,
} from '@/lib/org-contact'

export const dynamic = 'force-dynamic'

const noStoreHeaders = {
  'Cache-Control': 'private, no-store, no-cache, must-revalidate',
} as const

const revalidateHeaders = {
  "Cache-Control": "private, max-age=0, stale-while-revalidate=30",
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

    // 079: an organization column is not a user id. Reads scope to the caller's memberships.
    const callerOrgIds = await resolveCallerOrgIds(user.id, supabase)

    // Get the role the user is ACTING AS. active_role is the portal they are in right now;
    // role is the signup-time account fact. Branching on role served every dual-role vendor
    // the agency half of this handler - see docs/invitation-diagnosis.md 0.6 and
    // lib/acting-role.ts for the fallback rule.
    const { data: profile, error: profileErr } = await supabase
      .from('profiles')
      .select('role, active_role')
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
    const acting = actingRole(profile)
    console.log('[api] start', {
      route,
      method: 'GET',
      userId: user.id,
      role: profile?.role ?? null,
      activeRole: profile?.active_role ?? null,
      acting,
    })

    let partnerships

    // Anything that is not the agency portal falls to the vendor branch, including a caller
    // whose role columns resolve to nothing at all: that branch only ever returns rows keyed
    // to the caller's own id or email, so it is the safe default.
    if (acting === 'agency') {
      // Agency sees rows where they are lead_org_id (not vendor_org_id). 'removed' rows are
      // hidden entirely - the agency explicitly dismissed them from the pool, but the row
      // is kept (not deleted) for any associated rfp_magic_tokens/bid history.
      const rich = await supabase
        // 079-EMBED: rewritten from `partner:profiles!partnerships_partner_id_fkey(...)`.
        // vendor_org_id points at organizations after 079, so the company name comes from
        // organizations.name and the contact comes from the designated primary contact.
        // capabilities, company_logo_url and created_at have no organization-level column
        // and continue to come from that contact's own profile row. lib/org-contact.ts owns
        // the fragment, the null rule and the wire shape. The wire key is `vendor_org`,
        // renamed from `partner` by Greg's ruling: the value is an organization, not a
        // partner, so the old key was a name that lied. Consumers listed in
        // docs/079-embed-closure-report.md, Item 3.
        .from('partnerships')
        .select(`
          *,
          vendor_org:organizations!vendor_org_id(${ORG_CONTACT_SELECT_RICH})
        `)
        .in('lead_org_id', callerOrgIds)
        .neq('status', 'removed')
        .order('created_at', { ascending: false })

      if (!rich.error && rich.data) {
        // Normalize the two-hop embed back onto the wire key every consumer already reads.
        // A row whose organization or contact came back null is logged rather than left to
        // render blank - see lib/org-contact.ts for why both nulls are possible.
        partnerships = rich.data.map((row) => {
          const record = row as Record<string, unknown>
          const { vendor_org: embed, ...rest } = record
          const rowEmail = (record.partner_email as string | null) ?? null
          const contact = resolveOrgContact(embed as OrgEmbed, rowEmail)
          if (record.vendor_org_id) {
            logOrgContactGap('GET /api/partnerships (agency)', contact, {
              partnershipId: record.id,
              vendorOrgId: record.vendor_org_id,
            })
          }
          return { ...rest, vendor_org: orgWireShape(embed as OrgEmbed, rowEmail, { rich: true }) }
        })
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
          .in('lead_org_id', callerOrgIds)
          .neq('status', 'removed')
          .order('created_at', { ascending: false })
        if (simple.error) throw simple.error
        partnerships = simple.data
      }

      // Ghost/unclaimed rows (vendor_org_id IS NULL - the Invited/Discovered sections on
      // /agency/pool) carry no rfp_magic_tokens link of their own, so pool_status and
      // domain-match info (the "Domain Match - Review" badge) are cross-referenced by email
      // from the latest matching token, mirroring the classification write path in
      // app/api/rfp/guest/[token]/route.ts.
      const ghostRows = ((partnerships || []) as Record<string, unknown>[]).filter(
        (p) => !p.vendor_org_id && p.partner_email
      )
      if (ghostRows.length > 0) {
        const ghostEmails = [...new Set(ghostRows.map((r) => String(r.partner_email || '').toLowerCase()))]
        const { data: tokenRows } = await supabase
          .from('rfp_magic_tokens')
          .select('vendor_email, vendor_name, pool_status, domain_match_profile_id, created_at')
          .in('org_id', callerOrgIds)
          .in('vendor_email', ghostEmails)
          .order('created_at', { ascending: false })

        const latestTokenByEmail = new Map<
          string,
          { vendor_name: string | null; pool_status: string | null; domain_match_profile_id: string | null }
        >()
        for (const t of tokenRows || []) {
          const key = String(t.vendor_email || '').toLowerCase()
          if (!latestTokenByEmail.has(key)) {
            latestTokenByEmail.set(key, {
              vendor_name: t.vendor_name as string | null,
              pool_status: t.pool_status as string | null,
              domain_match_profile_id: t.domain_match_profile_id as string | null,
            })
          }
        }

        // partnership_notes.matched_profile_id/pool_flag - the import-path equivalent of the
        // rfp_magic_tokens-based domain match above (email-scan import, spreadsheet/manual
        // import via lib/server/partner-pool-import.ts). A token-based flag always takes
        // precedence when both exist; otherwise falls back to the notes-based one so the
        // same "Domain Match - Review" badge (and a new "Already on Ligament" badge) render
        // regardless of which import path produced the row.
        const notesProfileIds = new Set<string>()
        for (const row of ghostRows) {
          const notes = (row.partnership_notes as { matched_profile_id?: string } | null) || null
          if (notes?.matched_profile_id) notesProfileIds.add(notes.matched_profile_id)
        }

        const domainProfileIds = [
          ...new Set([
            ...[...latestTokenByEmail.values()].map((t) => t.domain_match_profile_id).filter(Boolean),
            ...notesProfileIds,
          ]),
        ] as string[]
        const domainProfileById = new Map<string, { id: string; company_name: string | null; full_name: string | null }>()
        if (domainProfileIds.length > 0) {
          const { data: domainProfiles } = await supabase
            .from('profiles')
            .select('id, company_name, full_name')
            .in('id', domainProfileIds)
          for (const p of domainProfiles || []) {
            domainProfileById.set(p.id as string, p as { id: string; company_name: string | null; full_name: string | null })
          }
        }

        for (const row of ghostRows) {
          const key = String(row.partner_email || '').toLowerCase()
          const tok = latestTokenByEmail.get(key)
          const notes = (row.partnership_notes as { matched_profile_id?: string; pool_flag?: string } | null) || null

          row.vendor_name = tok?.vendor_name || null
          row.pool_status = tok?.pool_status || notes?.pool_flag || null
          const matchedProfileId = tok?.domain_match_profile_id || notes?.matched_profile_id || null
          row.domain_match_profile = matchedProfileId ? domainProfileById.get(matchedProfileId) || null : null
        }
      }
    } else {
      // Partner sees agencies that invited them (by vendor_org_id OR by email)
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
        return NextResponse.json({ error: 'Failed to load vendor profile' }, { status: 500, headers: noStoreHeaders })
      }

      // Get partnerships by vendor_org_id
      const { data: byId, error: byIdError } = await supabase
        .from('partnerships')
        .select('*')
        .in('vendor_org_id', callerOrgIds)
        .order('created_at', { ascending: false })

      if (byIdError) throw byIdError
      
      // Also get partnerships by email (for invitations sent before account creation)
      let byEmailData: typeof byId = []
      if (partnerProfile?.email) {
        const { data: byEmail, error: byEmailError } = await supabase
          .from('partnerships')
          .select('*')
          .ilike('partner_email', partnerProfile.email.trim())
          .is('vendor_org_id', null) // Only get unclaimed email invitations
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

          // 079 GHOST CLAIM. This wrote `vendor_org_id: user.id`, which is a USER id in a
          // column that is a foreign key to organizations(id). Correct by accident for the
          // sixteen accounts 079 backfilled, where the organization id IS the founding
          // user's id. For every account created from the PHASE 12 trigger onward the two
          // differ, so the UPDATE raises 23503 and the invitation is never claimed.
          //
          // The old loop logged that error and continued, so the request still returned 200
          // and the vendor saw "No invitations yet" with nothing broken anywhere they could
          // see it. That is the failure diagnosed on 2026-08-14 and it would have returned
          // silently. It does not any more: an unclaimable invitation now fails the request.
          //
          // Scoped to the caller's OWN organization, never to a counterparty set. A vendor
          // claims an invitation into the organization they are a member of and nowhere
          // else.
          const claimOrgId = await resolveCallerWriteOrgId(user.id, supabase)
          if (!claimOrgId) {
            console.error('[api] GET /partnerships auto-claim aborted, caller belongs to no organization', {
              route,
              userId: user.id,
              unclaimedCount: byEmail.length,
            })
            return NextResponse.json(
              { error: 'Your account is not linked to an organization yet, so these invitations could not be claimed. Contact support.' },
              { status: 500, headers: noStoreHeaders }
            )
          }

          for (const invitation of byEmail) {
            const { error: claimErr } = await supabase
              .from('partnerships')
              .update({ vendor_org_id: claimOrgId })
              .eq('id', invitation.id)
            if (claimErr) {
              console.error('[api] GET /partnerships auto-claim invitation update failed', {
                route,
                userId: user.id,
                orgId: claimOrgId,
                partnershipId: invitation.id,
                message: claimErr.message,
                code: claimErr.code,
              })
              // Surfaced, not swallowed. This branch only runs when there IS an unclaimed
              // invitation, so failing here costs availability only in the case that is
              // already broken, and it converts a silent empty inbox into a visible error.
              return NextResponse.json(
                { error: 'An invitation could not be claimed for your account. Please retry, and contact support if it persists.' },
                { status: 500, headers: noStoreHeaders }
              )
            }
          }
        }
      }
      
      const allPartnerships = [...(byId || []), ...byEmailData]
      
      // Manually fetch agency profiles for each partnership
      const agencyIds = [...new Set(allPartnerships.map(p => p.lead_org_id).filter(Boolean))]
      
      // 079-EMBED (14th site, NOT one of the thirteen). This is the same break in
      // non-embed form: it looked lead_org_id up in `profiles`, which is the
      // "JOIN profiles ON profiles.id = an org id" trap 079's table comment names. It
      // works for every backfilled organization and returns nothing for every one created
      // after 079, blanking the lead agency's name across the whole vendor portal. It is
      // fixed here rather than left, because it feeds the sibling wire key of the embed
      // rewritten above and sits in the same handler. Reported separately.
      let leadOrgs: Record<string, NonNullable<ReturnType<typeof orgWireShape>>> = {}
      if (agencyIds.length > 0) {
        const { data: agencies, error: agenciesErr } = await supabase
          .from('organizations')
          .select(ORG_CONTACT_SELECT_RICH)
          .in('id', agencyIds)

        if (agenciesErr) {
          console.error('[api] GET /partnerships lead agency organizations batch load failed', {
            route,
            userId: user.id,
            agencyIdCount: agencyIds.length,
            message: agenciesErr.message,
            code: agenciesErr.code,
          })
        }

        for (const org of agencies || []) {
          const orgId = (org as { id?: string }).id
          if (!orgId) continue
          const contact = resolveOrgContact(org as OrgEmbed, null)
          logOrgContactGap('GET /api/partnerships (vendor, lead agency)', contact, {
            leadOrgId: orgId,
          })
          const shaped = orgWireShape(org as OrgEmbed, null, { rich: true })
          if (shaped) leadOrgs[orgId] = shaped
        }

        // An organization id that came back with no row at all is invisible to the loop
        // above, so it is counted here rather than silently dropped.
        const missing = agencyIds.filter((id) => !leadOrgs[id as string])
        if (missing.length > 0) {
          console.warn('[api] GET /partnerships lead agency organizations not readable', {
            route,
            userId: user.id,
            missingCount: missing.length,
            reason: 'row level security on organizations, or the row does not exist',
          })
        }
      }
      
      // Attach agency data; strip private lead-agency notes (never exposed to partners).
      partnerships = allPartnerships.map((p) => {
        const { partnership_notes: _omitNotes, ...rest } = p as Record<string, unknown>
        return {
          ...rest,
          lead_org: leadOrgs[p.lead_org_id as string] || null,
        }
      })
    }

    console.log('[api] success', {
      route,
      method: 'GET',
      userId: user.id,
      role: profile?.role ?? null,
      acting,
      rowCount: Array.isArray(partnerships) ? partnerships.length : 0,
    })
    return NextResponse.json({ partnerships }, { headers: revalidateHeaders })
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

    // 079: an organization column is not a user id. Reads scope to the caller's memberships.
    const callerOrgIds = await resolveCallerOrgIds(user.id, supabase)
    // 079: a write is attributed to the caller's OWN organization. Never a visibility set.
    const writeOrgId = await resolveCallerWriteOrgId(user.id, supabase)
    if (!writeOrgId) {
      return NextResponse.json({ error: "Your account is not linked to an organization yet" }, { status: 403, headers: noStoreHeaders })
    }

    // Verify user can act as an agency. Same widening as requireAgencyRole() - a dual-role
    // account keeps role='agency' or role='partner' forever, only active_role moves.
    const { data: profile, error: postProfileErr } = await supabase
      .from('profiles')
      .select('role, active_role, is_admin')
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
    console.log('[api] start', { route, method: 'POST', userId: user.id, role: profile?.role ?? null, activeRole: profile?.active_role ?? null })

    if (!canActAs(profile, 'agency')) {
      return NextResponse.json({ error: 'Only agencies can invite vendors' }, { status: 403 })
    }

    // Capability gate. canActAs() above answers WHICH SIDE; this answers MAY THEY. Sending a
    // partnership invitation is irreversible - the email cannot be unsent - so it defaults to
    // admin in docs/capabilities.md. This route covers both the first invitation and the
    // re-invitation of a terminated partnership below, which rewrites invitation_sent_at and
    // destroys the original send time. Resolves true for everyone today.
    if (!can(profile, 'vendor.invite')) {
      return NextResponse.json({ error: capabilityDeniedMessage('vendor.invite') }, { status: 403 })
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
      return NextResponse.json({ error: 'Vendor ID or vendor email required' }, { status: 400 })
    }

    // The invitee's own `role` is deliberately not selected and not tested. See the note
    // above the linkage below.
    let partner: { id: string; email: string | null } | null = null

    if (partnerId) {
      const { data: partnerById, error: partnerByIdErr } = await supabase
        .from('profiles')
        .select('id, email')
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
        return NextResponse.json({ error: 'Failed to look up vendor' }, { status: 500 })
      }
      if (!partnerById) {
        return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })
      }
      partner = partnerById
    } else {
      // Backward-compatible path: look up by email and resolve to profile.
      const { data: partnerByEmail, error: partnerLookupErr } = await supabase
        .from('profiles')
        .select('id, email')
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
        return NextResponse.json({ error: 'Failed to look up vendor' }, { status: 500 })
      }
      partner = partnerByEmail
    }

    // There is deliberately no check on the invitee's `profiles.role` here. There used to be
    // one - `if (partner && partner.role !== 'partner') return 400 "Can only invite partner
    // agencies, not lead agencies"` - and it was correct before migration 056. 056 made every
    // new signup `role='agency', secondary_role='partner'` unconditionally, so `role` stopped
    // carrying the lead-agency-versus-vendor signal the check was reading. Against live data
    // it rejected 12 of 14 accounts, including three that are operating as vendors right now.
    //
    // It was also enforced arbitrarily: `partner` is resolved with the session client, so the
    // check only ever fired when row level security let this agency read the invitee's profile
    // (an existing partnership, or a discoverable profile). Brand-new invitees were never
    // tested at all. A guard absent from the majority path is not a guard.
    //
    // Do not reinstate it against `secondary_role` either: that predicate rejects
    // gmarkant@icloud.com, whose `secondary_role` is 'agency' and who is the one unambiguous
    // vendor in the system. If the product ever needs to distinguish "this account offers
    // vendor services" it needs a field that means that, not `role`.
    const normalizedPartnerEmail = (partner?.email || partnerEmail).trim().toLowerCase()
    // `partner` above is resolved with the session client, so it is null for any invitee
    // this agency has no partnership with and who is not discoverable - which is most new
    // invitations. It still governs partnership linkage and the in-app notification, both of
    // which need a readable profile row. Only the EMAIL branch moves to this service-role
    // boolean, so someone who already has a login stops receiving signup copy.
    const inviteeHasAccount = Boolean(partner) || (await hasLigamentAccount(normalizedPartnerEmail))
    if (!normalizedPartnerEmail) {
      return NextResponse.json({ error: 'Partner email required' }, { status: 400 })
    }

    // Check if partnership already exists (by vendor_org_id or partner_email)
    let existingQuery = supabase
      .from('partnerships')
      .select('id, status, vendor_org_id')
      .in('lead_org_id', callerOrgIds)
    
    if (partner) {
      existingQuery = existingQuery.eq('vendor_org_id', partner.id)
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
        
        // Check if partner has an account (existing.vendor_org_id is set from previous invitation)
        const existingPartnerId = existing.vendor_org_id
        
        // Notify the partner of re-invitation if they have an account
        if (existingPartnerId) {
          const { notifyPartnershipInvitation } = await import('@/lib/notifications')
          await notifyPartnershipInvitation(supabase, existingPartnerId, agencyName, reactivated.id)
        }
        
    // Send email for re-invitation
        const siteUrl = siteBaseUrl()
        const acceptUrl = inviteeHasAccount
          ? `${siteUrl}/partner/invitations`
          : `${siteUrl}/auth/sign-up?invite_type=partnership&email=${encodeURIComponent(normalizedPartnerEmail)}&next=${encodeURIComponent("/partner/invitations")}`
        let reinviteBody = `${agencyName} would like to reconnect with you on Ligament and has sent a new partnership invitation.`
        if (message && String(message).trim()) {
          reinviteBody += `\n\nPersonal message:\n${String(message).trim()}`
        }
        try {
          const reinviteSent = await sendTransactionalEmail({
            to: normalizedPartnerEmail,
            subject: `${agencyName} has re-invited you to their vendor network on Ligament`,
            html: buildBrandedEmailHtml({
              title: "Partnership re-invitation",
              recipientName: normalizedPartnerEmail,
              body: reinviteBody,
              ctaText: inviteeHasAccount ? "View Invitation" : "Accept Invitation",
              ctaUrl: acceptUrl,
            }),
          })
          if (reinviteSent) {
            await supabase
              .from('partnerships')
              .update({ invitation_sent_at: new Date().toISOString() })
              .eq('id', reactivated.id)
          }
        } catch (emailErr) {
          console.error('Error sending partnership re-invitation email:', emailErr)
        }

        // Milestone: vendor.invite. This branch revives a TERMINATED partnership, which is a
        // fresh invitation to a relationship that had ended rather than a resend of a live
        // one, so it carries vendor.invite and not vendor.invite_resend. The dedicated
        // resend route (app/api/agency/pool/resend-invitation/route.ts) is the
        // vendor.invite_resend site and is not emitting yet. 079: user.id is the company.
        await recordMilestone(supabase, {
          eventType: 'vendor.invite',
          // 079 PARAMETER CLASS: milestone_events.org_id is an organization column and has
          // NO foreign key (migration 080 left it off deliberately), so a user id written
          // here raises nothing at all - it just makes the row invisible to its own agency,
          // whose RLS policy reads org_id = ANY (current_user_org_ids()). A silent one.
          orgId: writeOrgId,
          actorId: user.id,
          vendorOrgId: existingPartnerId ?? null,
          partnershipId: reactivated.id as string,
          subjectType: 'partnership',
          subjectId: reactivated.id as string,
          payload: {
            partner_email: normalizedPartnerEmail,
            reactivated_from: 'terminated',
            invitee_has_account: inviteeHasAccount,
          },
        })

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

    // Create partnership - with vendor_org_id if they exist, or just email if they don't
    const insertData: {
      lead_org_id: string
      vendor_org_id?: string
      partner_email: string
      status: string
      invitation_message?: string
    } = {
      lead_org_id: writeOrgId,
      partner_email: normalizedPartnerEmail,
      status: 'pending',
      invitation_message: message || undefined,
    }
    
    // 079 PARAMETER CLASS, PREVIOUSLY DEFERRED. `partner` is a profiles row, and
    // partnerships.vendor_org_id REFERENCES organizations(id) after 079 - so writing
    // `partner.id` here puts a user id in an organization column. It is invisible for the
    // sixteen accounts whose organization was backfilled with their founder's id and a 23503
    // for every account created since. Resolved through org_members instead. A matched
    // profile with no organization leaves vendor_org_id null, which is exactly the GHOST row
    // this product already understands (partner_email set, claimed later) rather than a bad
    // foreign key.
    const partnerOrgId = partner ? await resolveOrgIdForUser(partner.id, supabase) : null
    if (partner && !partnerOrgId) {
      console.error('[api] POST /partnerships: matched vendor profile belongs to no organization', {
        route,
        partnerProfileId: partner.id,
        partnerEmail,
      })
    }
    if (partnerOrgId) {
      insertData.vendor_org_id = partnerOrgId
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

    // If partner exists, send in-app notification.
    //
    // Passes partnership.vendor_org_id rather than partner.id. Same value - the insert
    // above writes vendor_org_id = partner.id - but notifyPartnershipInvitation now takes
    // an ORGANIZATION id and fans out over its members, so the argument should name the
    // column it comes from.
    //
    // The write path defect this comment used to report - `partner.id`, a profiles id, stored
    // in vendor_org_id - is closed above via resolveOrgIdForUser().
    if (partner && partnership.vendor_org_id) {
      await notifyPartnershipInvitation(supabase, partnership.vendor_org_id, agencyName, partnership.id)
    }
    
    // Send email invitation to partner (whether they have account or not)
    try {
      const siteUrl = siteBaseUrl()
      const acceptUrl = inviteeHasAccount
        ? `${siteUrl}/partner/invitations`
        : `${siteUrl}/auth/sign-up?invite_type=partnership&email=${encodeURIComponent(normalizedPartnerEmail)}&next=${encodeURIComponent("/partner/invitations")}`
      let inviteBody = `${agencyName} has selected you as a potential vendor on Ligament, a platform for vendor orchestration between creative and production agencies.\n\nJoining their network means you will be considered for scoped project opportunities they broadcast directly to their trusted vendors.`
      if (message && String(message).trim()) {
        inviteBody += `\n\nPersonal message:\n${String(message).trim()}`
      }
      const inviteSent = await sendTransactionalEmail({
        to: normalizedPartnerEmail,
        subject: `${agencyName} has invited you to join their vendor network on Ligament`,
        html: buildBrandedEmailHtml({
          title: "Partnership invitation",
          recipientName: normalizedPartnerEmail,
          body: inviteBody,
          ctaText: inviteeHasAccount ? "View Invitation" : "Accept Invitation",
          ctaUrl: acceptUrl,
        }),
      })
      if (inviteSent) {
        await supabase
          .from('partnerships')
          .update({ invitation_sent_at: new Date().toISOString() })
          .eq('id', partnership.id)
      }
    } catch (emailErr) {
      console.error('Error sending partnership invitation email:', emailErr)
      // Don't fail the whole request if email fails
    }

    // Milestone: vendor.invite. Emitted after the row and the mail, so a breadcrumb never
    // outlives a failed invitation. Vendor-visible by whitelist: the vendor is told an
    // invitation exists either way, so naming the person who sent it adds no disclosure.
    // 079: user.id is the acting company here.
    await recordMilestone(supabase, {
      eventType: 'vendor.invite',
      // 079 PARAMETER CLASS: see the sibling emit above. vendorOrgId was `partner?.id`, a
      // profiles id, and is now the resolved organization - the same value the insert writes.
      orgId: writeOrgId,
      actorId: user.id,
      vendorOrgId: partnerOrgId,
      partnershipId: partnership.id as string,
      subjectType: 'partnership',
      subjectId: partnership.id as string,
      payload: {
        partner_email: normalizedPartnerEmail,
        invitee_has_account: inviteeHasAccount,
      },
    })

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

    // 079: an organization column is not a user id. Reads scope to the caller's memberships.
    const callerOrgIds = await resolveCallerOrgIds(user.id, supabase)
    console.log('[api] start', { route, method: 'PATCH', userId: user.id, role: null })

    const { partnershipId, status, action } = await request.json()

    if (!partnershipId) {
      return NextResponse.json({ error: 'Partnership ID required' }, { status: 400 })
    }

    // Get partnership to verify ownership
    const { data: partnership, error: partnershipFetchErr } = await supabase
      .from('partnerships')
      .select('lead_org_id, vendor_org_id, status')
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
    const isAgency = callerOwnsOrg(callerOrgIds, partnership.lead_org_id)
    const isPartner = callerOwnsOrg(callerOrgIds, partnership.vendor_org_id)
    
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
        .in('lead_org_id', callerOrgIds)
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
      if (!partnerEmail && partnership.vendor_org_id) {
        // PHASE 5: was `.from('profiles').eq('id', partnership.vendor_org_id)` - an
        // ORGANIZATION id against the profiles table, resolving only while the two ids
        // coincide. It returned nothing for any vendor created after 079 and the
        // confirmation email was skipped in silence. resolveOrgNotificationRecipients() is
        // the helper that already answers "who do we email for this organization".
        const recipients = await resolveOrgNotificationRecipients(
          orgIdFromColumn(partnership.vendor_org_id),
          supabase
        )
        partnerEmail = (recipients[0]?.email || '').trim().toLowerCase() || null
        if (!partnerEmail) {
          console.error('[api] PATCH /partnerships: no notification recipient for the vendor organization', {
            route,
            partnershipId,
            vendorOrgId: partnership.vendor_org_id,
          })
        }
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

    if (action === 'confirm_msa') {
      if (!isAgency) {
        return NextResponse.json({ error: 'Only agencies can confirm MSA status' }, { status: 403 })
      }
      const now = new Date().toISOString()
      const { data: updated, error } = await supabase
        .from('partnerships')
        .update({
          msa_confirmed_at: now,
          msa_confirmed_by: user.id,
          updated_at: now,
        })
        .eq('id', partnershipId)
        .in('lead_org_id', callerOrgIds)
        .select()
        .single()
      if (error) throw error

      let partnerEmail: string | null = null
      if (partnership.vendor_org_id) {
        // PHASE 5: was `.from('profiles').eq('id', partnership.vendor_org_id)` - an
        // ORGANIZATION id against the profiles table, resolving only while the two ids
        // coincide. It returned nothing for any vendor created after 079 and the
        // confirmation email was skipped in silence. resolveOrgNotificationRecipients() is
        // the helper that already answers "who do we email for this organization".
        const recipients = await resolveOrgNotificationRecipients(
          orgIdFromColumn(partnership.vendor_org_id),
          supabase
        )
        partnerEmail = (recipients[0]?.email || '').trim().toLowerCase() || null
        if (!partnerEmail) {
          console.error('[api] PATCH /partnerships: no notification recipient for the vendor organization', {
            route,
            partnershipId,
            vendorOrgId: partnership.vendor_org_id,
          })
        }
      }

      if (partnerEmail) {
        const baseUrl = siteBaseUrl()
        const { data: agencyProfile } = await supabase
          .from('profiles')
          .select('company_name, full_name')
          .eq('id', user.id)
          .maybeSingle()
        const agencyLabel = (agencyProfile?.company_name || agencyProfile?.full_name || 'Lead agency')
        await sendTransactionalEmail({
          to: partnerEmail,
          subject: `${agencyLabel} has confirmed your MSA`,
          html: buildBrandedEmailHtml({
            title: "MSA confirmed",
            recipientName: partnerEmail,
            body: `${agencyLabel} has confirmed your MSA on Ligament. Your partnership agreement is now on file.`,
            ctaText: "View Partnership",
            ctaUrl: `${baseUrl}/partner`,
          }),
        })
      }

      // Milestone: msa.confirm. This is the one milestone in the product that already had an
      // actor column - partnerships.msa_confirmed_by, migration 051 - and the map says to
      // treat it as the precedent it is rather than replace it. The column stays; the event
      // is emitted beside it so the two agree.
      //
      // NOT on the vendor-visible whitelist. docs/capabilities.md section 5 marks msa.confirm
      // not vendor-visible while docs/milestone-attribution-map.md section 2 marks the same
      // milestone with a (V). The two disagree, so this follows the whitelist rule and fails
      // closed. Adding 'msa.confirm' to vendor_visible_event_types() in migration 080 is a
      // one-line change and a decision for Greg.
      //
      // 079: partnership.lead_org_id is the acting company, partnership.vendor_org_id the vendor.
      await recordMilestone(supabase, {
        eventType: 'msa.confirm',
        // 079 PARAMETER CLASS: the comment above already said lead_org_id is the acting
        // company; the code said user.id. They agree now. This branch is guarded by
        // `if (!isAgency) return 403`, and isAgency is
        // `callerOrgIds.includes(partnership.lead_org_id)` - so this value is provably one of
        // the caller's own organizations, not a counterparty.
        orgId: orgIdFromColumn(partnership.lead_org_id),
        actorId: user.id,
        vendorOrgId: orgIdFromColumn(partnership.vendor_org_id),
        partnershipId: partnershipId as string,
        subjectType: 'partnership',
        subjectId: partnershipId as string,
        payload: { msa_confirmed_at: now },
      })

      return NextResponse.json({ partnership: updated })
    }

    if (!status) {
      return NextResponse.json({ error: 'Status required' }, { status: 400 })
    }

    if (!['active', 'suspended', 'terminated', 'removed'].includes(status)) {
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
        
        const partnerName = partnerProfile?.company_name || partnerProfile?.full_name || 'A vendor'
        
        // Notify agency that partner accepted
        await notifyPartnershipAccepted(supabase, partnership.lead_org_id, partnerName, partnershipId)

        // PHASE 5: the ACCEPT half of the decline path's defect. This looked the lead
        // agency up in `profiles` by an ORGANIZATION id, ignored the error, and skipped the
        // email when it resolved to nothing - so a vendor accepting an invitation from any
        // agency created after 079 told that agency nothing at all.
        const agencyProfile = (await resolveOrgNotificationRecipients(
          orgIdFromColumn(partnership.lead_org_id),
          supabase
        ))[0] ?? null
        if (!agencyProfile?.email) {
          console.error('[api] PATCH /partnerships: no notification recipient for the lead organization', {
            route,
            partnershipId,
            leadOrgId: partnership.lead_org_id,
            action: 'accept',
          })
        }

        if (agencyProfile?.email) {
          await sendTransactionalEmail({
            to: agencyProfile.email,
            subject: `${partnerName} accepted your partnership invitation`,
            html: buildBrandedEmailHtml({
              title: "Vendor accepted invitation",
              recipientName:
                agencyProfile.company_name?.trim() ||
                agencyProfile.full_name?.trim() ||
                agencyProfile.email?.trim() ||
                "there",
              body: `${partnerName} has accepted your invitation and joined your vendor network on Ligament.\n\nThey are now available to receive RFP broadcasts from your agency.`,
              ctaText: "View Vendor",
              ctaUrl: `${siteBaseUrl()}/agency/pool`,
            }),
          })
        }
        
        return NextResponse.json({ partnership: updated })
      } else if (status === 'terminated') {
        // Decline invitation.
        //
        // 085 ORDERING. BOTH LOOKUPS BELOW HAPPEN BEFORE THE UPDATE, AND THAT ORDER IS LOAD
        // BEARING. Migration 085 narrows the counterparty half of
        // current_user_visible_profile_ids() to exclude ended relationships, and 'terminated'
        // is an ended relationship. Resolved AFTER the update, the lead agency is no longer a
        // commercial counterparty of this vendor, the profiles read behind
        // resolveOrgNotificationRecipients() returns nothing, and the decline email is simply
        // not sent - while the request still returns 200 and the vendor still sees their
        // invitation cleared. That is the exact silent-notification failure commit c00ca1a was
        // written to close, reopening through a policy change instead of a lookup bug.
        //
        // Reordering costs nothing today: neither lookup depends on the new status, and both
        // read rows the caller can already see while the partnership is still pending. So this
        // is correct with or without 085 and is safe to deploy before it. DO NOT MOVE EITHER
        // LOOKUP BACK BELOW THE UPDATE.
        const { data: partnerProfile } = await supabase
          .from('profiles')
          .select('company_name, full_name')
          .eq('id', user.id)
          .single()

        const partnerName = partnerProfile?.company_name || partnerProfile?.full_name || 'A vendor'

        // Resolved here, while the partnership is still readable as a live counterparty.
        // Held and used after the update.
        //
        // Wrapped in its own try/catch on purpose. Before this reordering the lookup sat
        // inside the email try/catch, so a lookup failure could never stop the decline from
        // being recorded. Moving it above the UPDATE without this guard would have quietly
        // handed it that power - a throw here would 500 the request and the vendor's decline
        // would not happen at all. Notifying the agency is strictly less important than
        // recording what the vendor did.
        let declineRecipient: Awaited<ReturnType<typeof resolveOrgNotificationRecipients>>[number] | null = null
        try {
          declineRecipient = (await resolveOrgNotificationRecipients(
            orgIdFromColumn(partnership.lead_org_id),
            supabase
          ))[0] ?? null
        } catch (recipientErr) {
          console.error('[api] PATCH /partnerships: decline recipient lookup threw, declining anyway', {
            route,
            partnershipId,
            leadOrgId: partnership.lead_org_id,
            message: recipientErr instanceof Error ? recipientErr.message : String(recipientErr),
          })
        }

        const { data: updated, error } = await supabase
          .from('partnerships')
          .update({ status: 'terminated', updated_at: new Date().toISOString() })
          .eq('id', partnershipId)
          .select()
          .single()

        if (error) throw error

        // Notify agency that partner declined.
        //
        // KNOWN TO BE FAILING TODAY, AND NOT FIXED HERE. The live "Scoped insert
        // notifications" policy on public.notifications is
        //   user_id = auth.uid() OR user_id IN (current_user_active_counterparty_user_ids())
        // and that helper is status = 'active' only. A declined invitation was 'pending'
        // before this handler ran and is 'terminated' after it, so the agency's user id is in
        // neither branch and this INSERT is refused by row level security in both orderings.
        // It is refused quietly: createOrgNotification() logs and returns false, the request
        // still returns 200. Widening that policy would scope a WRITE by a visibility set,
        // which this project's rules forbid outright, so it is reported rather than patched.
        // See docs/m1-foundation-report.md, Phase 1. THE EMAIL BELOW IS THE PATH THAT ACTUALLY
        // REACHES THE AGENCY, which is why its ordering is the one that was fixed.
        const { notifyPartnershipDeclined } = await import('@/lib/notifications')
        await notifyPartnershipDeclined(supabase, partnership.lead_org_id, partnerName, partnershipId)

        // Send email to agency notifying them of the decline
        try {
          // PHASE 5c: THE DECLINE PATH. A vendor CAN clear an unwanted invitation - the row
          // moves to 'terminated' and leaves their Invitations tab - but the agency was never
          // told, because this looked them up in `profiles` by an ORGANIZATION id and simply
          // skipped the send when it found nothing. The vendor's decline landed nowhere the
          // agency could see it. That is the half of "a vendor cannot clear an invitation"
          // that was actually broken, and it is the half that gets worse the moment Phase 2
          // starts creating invitations nobody chose to send.
          const agencyProfile = declineRecipient
          if (!agencyProfile?.email) {
            console.error('[api] PATCH /partnerships: no notification recipient for the lead organization', {
              route,
              partnershipId,
              leadOrgId: partnership.lead_org_id,
              action: 'decline',
            })
          }

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
                body: `${partnerName} has declined your partnership invitation on Ligament.\n\nYou can invite other vendors from your vendor pool or discover new ones in the marketplace.`,
                ctaText: "View Vendor Pool",
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

    // 079: an organization column is not a user id. Reads scope to the caller's memberships.
    const callerOrgIds = await resolveCallerOrgIds(user.id, supabase)
    console.log('[api] start', { route, method: 'DELETE', userId: user.id, role: null })

    const { searchParams } = new URL(request.url)
    const partnershipId = searchParams.get('id')

    if (!partnershipId) {
      return NextResponse.json({ error: 'Partnership ID required' }, { status: 400 })
    }

    // Verify user is an agency and owns this partnership
    const { data: partnership, error: fetchError } = await supabase
      .from('partnerships')
      .select('lead_org_id, vendor_org_id')
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

    if (!callerOwnsOrg(callerOrgIds, partnership.lead_org_id)) {
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
