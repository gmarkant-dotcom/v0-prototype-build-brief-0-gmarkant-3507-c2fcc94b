import { resolveCallerOrgIds, resolveCallerWriteOrgId, orgIdFromColumn, resolveOrgIdForUser, type OrgId } from "@/lib/entitlements"
import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import {
  ORG_CONTACT_SELECT,
  logOrgContactGap,
  orgDisplayName,
  resolveOrgContact,
  type OrgEmbed,
} from "@/lib/org-contact"
import { Resend } from "resend"
import { buildBrandedEmailHtml, siteBaseUrl } from "@/lib/email"
import { can, capabilityDeniedMessage } from "@/lib/capabilities"
import { cuePartnershipInvitations, type CueTarget } from "@/lib/broadcast-partnership-cue"
import { recordMilestones } from "@/lib/milestone-events"
import { normalizeBusinessCriteriaRequired } from "@/lib/business-criteria"
import { normalizeBudgetCategories } from "@/lib/budget-categories"
import { normalizeRfpEvaluationCriteria } from "@/lib/rfp-evaluation-criteria"

type ScopeItemPayload = {
  id: string
  name: string
  description: string
  estimatedBudget?: string
  timeline?: string
}

type BroadcastItem = {
  scopeItemId: string
  scopeItem: ScopeItemPayload
  partnerIds: string[]
  newRecipients: { email: string; name: string; requireNda: boolean }[]
}

type PartnershipRow = {
  id: string
  nda_confirmed_at?: string | null
  partner_email?: string | null
  // 079-EMBED. Was `partner`, a profiles row reached through partnerships_partner_id_fkey.
  // Now the vendor's organization plus its designated primary contact.
  vendor_org?: OrgEmbed
}

function normalizeManualRecipients(
  raw: unknown
): { email: string; name: string; requireNda: boolean }[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null
      const obj = entry as { email?: unknown; name?: unknown; requireNda?: unknown }
      const email = typeof obj.email === "string" ? obj.email.trim().toLowerCase() : ""
      if (!email) return null
      return {
        email,
        name: typeof obj.name === "string" ? obj.name.trim() : "",
        requireNda: obj.requireNda !== false,
      }
    })
    .filter((entry): entry is { email: string; name: string; requireNda: boolean } => Boolean(entry))
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // 079: an organization column is not a user id. Reads scope to the caller's memberships.
    const callerOrgIds = await resolveCallerOrgIds(user.id, supabase)
    // 079: a write is attributed to the caller's OWN organization. Never a visibility set.
    const writeOrgId = await resolveCallerWriteOrgId(user.id, supabase)
    if (!writeOrgId) {
      return NextResponse.json({ error: "Your account is not linked to an organization yet" }, { status: 403 })
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, active_role, company_name, full_name, is_admin")
      .eq("id", user.id)
      .single()

    if (profile?.role !== "agency" && profile?.active_role !== "agency") {
      return NextResponse.json({ error: "Only lead agencies can broadcast RFPs" }, { status: 403 })
    }

    // Capability gate. The question above is WHICH SIDE; this one is MAY THEY. Broadcasting
    // is irreversible - the mail leaves the building and cannot be unsent - so it defaults to
    // admin in docs/capabilities.md. 079: every member of the organization will satisfy the
    // `lead_org_id = auth.uid()` ownership predicate that is the only other gate on this route,
    // which is the day this check starts doing work. It resolves true for everyone today.
    if (!can(profile, "rfp.broadcast")) {
      return NextResponse.json({ error: capabilityDeniedMessage("rfp.broadcast") }, { status: 403 })
    }

    const body = await request.json()
    const projectId =
      typeof body.projectId === "string" && body.projectId.length > 0 ? body.projectId : null
    // P2-4. Never trust the client payload: an explicit true is the only thing that closes an
    // RFP; anything else, including a missing key, leaves it open.
    const closeBiddingAtDeadline = body.close_bidding_at_deadline === true
    const masterRfp = body.masterRfp
    const ndaRequired = body.ndaRequired === true
    const requireTermsDisclosure = body.requireTermsDisclosure !== false
    const ndaLink =
      typeof body.ndaLink === "string" && body.ndaLink.trim().length > 0
        ? body.ndaLink.trim()
        : ""
    const items = (Array.isArray(body.items) ? body.items : []) as BroadcastItem[]
    const topLevelNewRecipientsByScope =
      body.newRecipientsByScope && typeof body.newRecipientsByScope === "object"
        ? (body.newRecipientsByScope as Record<string, unknown>)
        : {}
    const responseDeadlineRaw =
      typeof body.response_deadline === "string" && body.response_deadline.trim().length > 0
        ? body.response_deadline.trim()
        : null
    const responseDeadline =
      responseDeadlineRaw && !Number.isNaN(new Date(responseDeadlineRaw).getTime())
        ? new Date(responseDeadlineRaw).toISOString()
        : null

    if (!masterRfp || typeof masterRfp !== "object") {
      return NextResponse.json({ error: "masterRfp is required" }, { status: 400 })
    }
    // P2-1: budget categories ride inside master_rfp_json with everything else the wizard
    // sends, so no new column and no new write path - but the client payload is still not
    // trusted, same as business_criteria_required directly below.
    ;(masterRfp as Record<string, unknown>).budget_categories = normalizeBudgetCategories(
      (masterRfp as Record<string, unknown>).budget_categories
    )
    ;(masterRfp as Record<string, unknown>).evaluation_criteria = normalizeRfpEvaluationCriteria(
      (masterRfp as Record<string, unknown>).evaluation_criteria
    )
    ;(masterRfp as Record<string, unknown>).business_criteria_required = normalizeBusinessCriteriaRequired(
      (masterRfp as Record<string, unknown>).business_criteria_required
    )

    if (items.length === 0) {
      return NextResponse.json({ error: "No broadcast items" }, { status: 400 })
    }

    const agencyDisplay =
      profile.company_name?.trim() || profile.full_name?.trim() || "Lead agency"
    const baseUrl = siteBaseUrl()

    const rows: Record<string, unknown>[] = []

    // PHASE 2: broadcasting cues an invitation to partner. Collected here and acted on once,
    // after the inbox rows are safely in - a cue must never be the reason a broadcast fails,
    // and a cue for a broadcast that did not happen would be a lie. Behind
    // BROADCAST_CUES_PARTNERSHIP, default OFF: see lib/feature-flags.ts.
    const cueTargets: CueTarget[] = []
    const seenRecipientKeys = new Set<string>()
    const manualRecipientNotifications: {
      recipientEmail: string
      subject: string
      recipientName: string
      heading: string
      paragraphs: string[]
      ctaLabel: string
      ctaUrl: string
    }[] = []
    const existingPartnerNotifications: {
      partnerEmail: string
      partnerName: string
      scopeName: string
      requiresNda: boolean
    }[] = []

    for (const item of items) {
      const si = item.scopeItem
      const scopeItemId =
        (typeof si?.id === "string" && si.id.trim()) ||
        (typeof item.scopeItemId === "string" && item.scopeItemId.trim()) ||
        ""
      if (!scopeItemId) {
        return NextResponse.json({ error: "Each broadcast item requires scopeItem.id" }, { status: 400 })
      }

      const scopeItemName = (si.name || "Scope").toString()
      const scopeItemDescription = (si.description || "").toString()
      const estimatedBudget = (si.estimatedBudget || "").toString()
      const timeline = (si.timeline || "").toString()

      for (const partnerId of item.partnerIds || []) {
        if (typeof partnerId !== "string" || !partnerId.length) continue

        const { data: partnership, error: pErr } = await supabase
          // 079-EMBED: rewritten from `partner:profiles!partnerships_partner_id_fkey(...)`.
          // This is the site where the fallback matters most: it decides who receives the
          // RFP. partner_email is already selected and is already the pre-claim address,
          // so resolveOrgContact() folds the two into one rule instead of the two-branch
          // expression that was here.
          .from("partnerships")
          .select(
            `id, nda_confirmed_at, partner_email, vendor_org:organizations!vendor_org_id(${ORG_CONTACT_SELECT})`
          )
          .in("lead_org_id", callerOrgIds)
          .eq("vendor_org_id", partnerId)
          .eq("status", "active")
          .maybeSingle()

        if (pErr) {
          console.error("partnership lookup:", pErr)
          return NextResponse.json({ error: "Could not verify partnership" }, { status: 500 })
        }

        if (!partnership) {
          return NextResponse.json(
            {
              error: "One or more selected vendors are not active vendors of your agency.",
              partnerId,
            },
            { status: 400 }
          )
        }

        const partnerScopeKey = `partner:${scopeItemId}:${partnerId}`
        if (seenRecipientKeys.has(partnerScopeKey)) continue
        seenRecipientKeys.add(partnerScopeKey)

        const row = {
          lead_org_id: writeOrgId,
          vendor_org_id: partnerId,
          recipient_email: null,
          partnership_id: partnership.id,
          project_id: projectId,
          scope_item_id: scopeItemId,
          scope_item_name: scopeItemName,
          scope_item_description: scopeItemDescription || null,
          estimated_budget: estimatedBudget || null,
          timeline: timeline || null,
          response_deadline: responseDeadline,
          close_bidding_at_deadline: closeBiddingAtDeadline,
          master_rfp_json: { ...(masterRfp as Record<string, unknown>), nda_link: ndaLink || null },
          agency_company_name: agencyDisplay,
          nda_gate_enforced: false,
          require_terms_disclosure: requireTermsDisclosure,
          status: "new",
        }
        rows.push(row)

        const vendorContact = resolveOrgContact(
          (partnership as PartnershipRow).vendor_org,
          (partnership as PartnershipRow).partner_email ?? null
        )
        logOrgContactGap("POST /api/agency/broadcast-rfp (pool vendor)", vendorContact, {
          projectId,
          partnershipId: partnership.id,
          vendorOrgId: partnerId,
        })
        const partnerEmail = (vendorContact.contactEmail || "").trim().toLowerCase()
        const partnerName = orgDisplayName(vendorContact, "Vendor")
        if (!partnerEmail.trim()) {
          console.warn("[broadcast-rfp] active partner has no email; skipping notification", {
            partnerId,
            scopeItemId,
          })
        } else {
          seenRecipientKeys.add(`email:${scopeItemId}:${partnerEmail.trim().toLowerCase()}`)
        }
        // Case (i) by construction - this branch already required an ACTIVE partnership - so
        // the cue helper will skip it. Collected anyway rather than special-cased, so that
        // "does this recipient already have a relationship" is decided in exactly one place.
        if (partnerEmail.trim()) {
          cueTargets.push({ vendorOrgId: partnerId as OrgId, email: partnerEmail })
        }

        const requiresNdaForExistingPartner = ndaRequired && ndaLink.length > 0 && !partnership?.nda_confirmed_at
        if (partnerEmail.trim()) {
          existingPartnerNotifications.push({
            partnerEmail,
            partnerName,
            scopeName: scopeItemName,
            requiresNda: requiresNdaForExistingPartner,
          })
        }
      }

      const normalizedItemNewRecipients = normalizeManualRecipients(
        Array.isArray(item.newRecipients) && item.newRecipients.length > 0
          ? item.newRecipients
          : topLevelNewRecipientsByScope[scopeItemId]
      )
      for (const nr of normalizedItemNewRecipients) {
        const email = (nr?.email || "").trim().toLowerCase()
        if (!email) {
          console.warn("[broadcast-rfp] manual recipient skipped: empty_email")
          continue
        }
        const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
        if (!isValidEmail) {
          console.error("[broadcast-rfp] manual recipient skipped: invalid_email", { email })
          continue
        }
        const manualScopeKey = `email:${scopeItemId}:${email}`
        if (seenRecipientKeys.has(manualScopeKey)) {
          console.warn("[broadcast-rfp] manual recipient skipped: duplicate_scope_email", {
            email,
            scopeItemId,
          })
          continue
        }
        seenRecipientKeys.add(manualScopeKey)

        const { data: existingProfile, error: existingProfileError } = await supabase
          .from("profiles")
          .select("id, email")
          .ilike("email", email)
          .maybeSingle<{ id: string; email: string | null }>()

        if (existingProfileError) {
          console.error("[broadcast-rfp] failed profile lookup for manual recipient", {
            email,
            message: existingProfileError.message,
          })
        }

        // 079 PARAMETER CLASS: `existingProfile.id` is a profiles id, and every column it
        // was being compared to and written into below - partnerships.vendor_org_id,
        // partner_rfp_inbox.vendor_org_id - is an ORGANIZATION column that REFERENCES
        // organizations(id). Correct by accident for the sixteen backfilled accounts, and
        // for every account created since a partnership lookup that finds nothing plus an
        // inbox row carrying an id that names no organization. Resolved through org_members.
        //
        // A matched profile with no organization is treated as NOT an account holder, which
        // makes the row a GHOST (vendor_org_id null, recipient_email set) - the state this
        // product already understands and claims later - rather than a bad foreign key.
        const existingProfileOrgId = existingProfile?.id
          ? await resolveOrgIdForUser(existingProfile.id, supabase)
          : null
        if (existingProfile?.id && !existingProfileOrgId) {
          console.error("[broadcast-rfp] matched recipient profile belongs to no organization", {
            email,
            profileId: existingProfile.id,
          })
        }
        const isExistingUser = Boolean(existingProfileOrgId)
        let partnershipForManual: PartnershipRow | null = null
        if (existingProfileOrgId) {
          const { data: existingPartnership } = await supabase
            // 079-EMBED: the embed is REMOVED here rather than rewritten. This lookup
            // consumes exactly two fields - `id` for partnership_id and
            // `nda_confirmed_at` for the NDA gate, both read within twenty lines below -
            // and never touched the partner profile it was selecting. Rewriting it to the
            // two-hop organizations form would have added a join, an RLS surface and a
            // null case for data nobody reads. The recipient here is the manually typed
            // email address, not the pool vendor's contact.
            .from("partnerships")
            .select("id, nda_confirmed_at, partner_email")
            .in("lead_org_id", callerOrgIds)
            .eq("vendor_org_id", existingProfileOrgId)
            .in("status", ["active", "pending"])
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle<PartnershipRow>()
          partnershipForManual = existingPartnership || null
        }

        const inviteToken = crypto.randomUUID()
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
        const ndaLinkPresent = ndaRequired && ndaLink.length > 0
        const ndaAlreadySigned = Boolean(partnershipForManual?.nda_confirmed_at)
        const ndaGateEnforced = Boolean(nr.requireNda === true && ndaLinkPresent && !ndaAlreadySigned)
        const claimedAt = isExistingUser ? new Date().toISOString() : null

        rows.push({
          lead_org_id: writeOrgId,
          vendor_org_id: existingProfileOrgId,
          recipient_email: email,
          partnership_id: partnershipForManual?.id || null,
          project_id: projectId,
          scope_item_id: scopeItemId,
          scope_item_name: scopeItemName,
          scope_item_description: scopeItemDescription || null,
          estimated_budget: estimatedBudget || null,
          timeline: timeline || null,
          response_deadline: responseDeadline,
          close_bidding_at_deadline: closeBiddingAtDeadline,
          master_rfp_json: { ...(masterRfp as Record<string, unknown>), nda_link: ndaLink || null },
          agency_company_name: agencyDisplay,
          invite_token: inviteToken,
          invite_token_expires_at: expiresAt,
          claimed_at: claimedAt,
          nda_gate_enforced: ndaGateEnforced,
          nda_confirmed_at: ndaAlreadySigned ? new Date().toISOString() : null,
          require_terms_disclosure: requireTermsDisclosure,
          status: "new",
        })

        // Cases (ii) and (iii). existingProfileOrgId is null exactly when this address
        // belongs to nobody, or to somebody with no organization - both of which produce a
        // GHOST row that grants the vendor nothing until they sign up and it is claimed.
        cueTargets.push({ vendorOrgId: existingProfileOrgId, email })

        const recipientName = nr?.name?.trim?.() || email
        const signUpInviteUrl = new URL("/auth/sign-up", baseUrl)
        signUpInviteUrl.searchParams.set("invite", inviteToken)
        signUpInviteUrl.searchParams.set("email", email)
        signUpInviteUrl.searchParams.set("scope", scopeItemName)
        signUpInviteUrl.searchParams.set("agency", agencyDisplay)
        const existingInviteUrl = new URL("/partner/rfps", baseUrl)
        existingInviteUrl.searchParams.set("invite", inviteToken)

        if (!isExistingUser) {
          const newUserSubject = ndaGateEnforced
            ? `${agencyDisplay} invited you to respond to a confidential RFP on Ligament`
            : `${agencyDisplay} invited you to respond to an RFP on Ligament`
          if (ndaGateEnforced) {
            signUpInviteUrl.searchParams.set("nda", "required")
          }
          manualRecipientNotifications.push({
            recipientEmail: email,
            recipientName,
            subject: newUserSubject,
            heading: ndaGateEnforced ? "Confidential RFP invite" : "You are invited to an RFP",
            paragraphs: ndaGateEnforced
              ? [
                  `${agencyDisplay} has sent you a confidential RFP for ${scopeItemName}.`,
                  "Create your account and complete the NDA to unlock access to the brief. Your invitation expires in 30 days.",
                ]
              : [
                  `${agencyDisplay} has sent you an RFP for ${scopeItemName} and invited you to join Ligament to respond.`,
                  "Create your free account to view the full brief and submit your bid. Your invitation expires in 30 days.",
                ],
            ctaLabel: ndaGateEnforced ? "Create Account & Sign NDA" : "Create Account & View RFP",
            ctaUrl: signUpInviteUrl.toString(),
          })
          continue
        }

        if (ndaGateEnforced) {
          existingInviteUrl.searchParams.set("nda", "required")
          manualRecipientNotifications.push({
            recipientEmail: email,
            recipientName,
            subject: `${agencyDisplay} requires an NDA to share this RFP with you`,
            heading: "NDA required before access",
            paragraphs: [
              `${agencyDisplay} has a confidential RFP for ${scopeItemName} ready for you on Ligament, but requires a signed NDA first.`,
              "Log in and complete the NDA to unlock access.",
            ],
            ctaLabel: "Sign NDA & View RFP",
            ctaUrl: existingInviteUrl.toString(),
          })
          continue
        }

        manualRecipientNotifications.push({
          recipientEmail: email,
          recipientName,
          subject: `New RFP from ${agencyDisplay}: ${scopeItemName}`,
          heading: "New RFP in your vendor inbox",
          paragraphs: [
            `${agencyDisplay} has sent you an RFP for ${scopeItemName} on Ligament.`,
            "Review the scope, timeline, and budget details, then submit your bid directly through the platform.",
          ],
          ctaLabel: "View RFP",
          ctaUrl: `${baseUrl}/partner/rfps`,
        })
      }
    }

    if (rows.length === 0) {
      return NextResponse.json({ error: "No recipients to broadcast to" }, { status: 400 })
    }

    // P2-4 pre-migration safety: close_bidding_at_deadline does not exist until 076. Retry once
    // without it on Postgres undefined_column (42703) so a broadcast never fails for a column
    // the schema has not gained yet - the RFP simply behaves as it does today, staying open.
    let { error: insertError } = await supabase.from("partner_rfp_inbox").insert(rows)
    if (insertError?.code === "42703") {
      console.warn("[api] broadcast-rfp: close_bidding_at_deadline column missing, retrying without it")
      const rowsWithoutClose = rows.map((row) => {
        const { close_bidding_at_deadline: _omitted, ...rest } = row as Record<string, unknown>
        return rest
      })
      ;({ error: insertError } = await supabase.from("partner_rfp_inbox").insert(rowsWithoutClose))
    }

    if (insertError) {
      console.error("partner_rfp_inbox insert:", insertError)
      return NextResponse.json(
        {
          error: "Failed to save broadcasts",
          detail: insertError.message,
        },
        { status: 500 }
      )
    }

    // PHASE 2: cue a partnership invitation per recipient who does not already have one.
    //
    // AFTER the inbox rows are in, so a cue never records an invitation to bid on an RFP
    // that failed to land. BEFORE the mail goes out, so the relationship the vendor is being
    // told about exists by the time they can click through to it.
    //
    // Awaited but never allowed to fail the broadcast: the helper returns rather than throws
    // on every path, and the broadcast is already irreversible by this point - the rows are
    // written and the mail is about to leave. A missing cue is a courtesy not extended; a
    // failed broadcast is a job not done.
    //
    // Inert until BROADCAST_CUES_PARTNERSHIP=true. The helper's first line checks the flag,
    // so with it unset this is one function call that returns a zero record and writes
    // nothing. See lib/feature-flags.ts for what flipping it causes, and to whom.
    const cueOutcome = await cuePartnershipInvitations(supabase, {
      leadOrgId: writeOrgId,
      targets: cueTargets,
      projectId,
      scopeItemName: (rows[0]?.scope_item_name as string | null) ?? null,
    })
    if (cueOutcome.created > 0 || cueOutcome.failed > 0) {
      console.log("[broadcast-rfp] partnership cue", {
        projectId,
        created: cueOutcome.created,
        skippedExisting: cueOutcome.skippedExisting,
        skippedRace: cueOutcome.skippedRace,
        failed: cueOutcome.failed,
      })
    }

    // Milestone: rfp.broadcast. One row per recipient, not one per broadcast - vendor
    // visibility is per partnership, so a single row with no partnership_id would be
    // invisible to every vendor it was actually sent to. Emitted after the inbox rows are
    // safely in, and fire-and-forget: a missing breadcrumb must never fail a broadcast that
    // has already sent mail. 079: user.id is the acting company here.
    //
    // EVERY FIELD BELOW MUST BE ABOUT THE ONE RECIPIENT THIS ROW IS FOR.
    // `rfp.broadcast` is on public.vendor_visible_event_types(), and RLS is row level: the
    // counterparty SELECT policy in migration 080 grants the WHOLE row, `payload` included,
    // to the vendor org behind this row's partnership_id. So a payload field describing the
    // BROADCAST rather than the RECIPIENT is read by every vendor in it.
    //
    // `recipient_count: rows.length` was exactly that and is removed. It told each vendor
    // how many competitors were invited - the size of the field they are bidding against,
    // which the agency never tells them anywhere else. Removed 2026-08-20, before any
    // rfp.broadcast row had ever been written, so there is nothing to redact.
    //
    // The agency still needs "to 49 vendors" on its own feed. It is DERIVED, not stored:
    // recordMilestones issues one insert for the whole batch, so every row here shares one
    // transaction timestamp, and the dashboard feed groups on it and counts the group. See
    // docs/recent-activity-merge-design.md section 1. The count exists agency-side only
    // because it is never written down.
    await recordMilestones(
      supabase,
      rows.map((row) => ({
        eventType: "rfp.broadcast" as const,
        // 079 PARAMETER CLASS: milestone_events.org_id is an organization column. `user.id`
        // was a user id - no foreign key catches it, the row simply stops being visible to
        // the agency that broadcast it once org id and user id diverge. writeOrgId is the
        // caller's own organization, already resolved above for the inbox rows themselves.
        orgId: writeOrgId,
        actorId: user.id,
        vendorOrgId: orgIdFromColumn(row.vendor_org_id),
        partnershipId: (row.partnership_id as string | null) ?? null,
        subjectType: "project" as const,
        subjectId: (row.project_id as string | null) ?? null,
        payload: {
          scope_item_name: (row.scope_item_name as string | null) ?? null,
          recipient_email: (row.recipient_email as string | null) ?? null,
          response_deadline: (row.response_deadline as string | null) ?? null,
          nda_gate_enforced: row.nda_gate_enforced === true,
        },
      }))
    )

    // TODO: Add scheduled Vercel cron job to mark expired unclaimed invite rows
    // (invite_token_expires_at < now() and claimed_at is null) with status = 'expired'
    // See: https://vercel.com/docs/cron-jobs

    const resendApiKey = process.env.RESEND_API_KEY
    const resend = resendApiKey ? new Resend(resendApiKey) : null
    if (!resend) {
      console.error("[broadcast-rfp] RESEND_API_KEY not configured; broadcast rows created without notifications")
      return NextResponse.json({ ok: true, count: rows.length, emailsQueued: 0, emailConfigMissing: true })
    }

    // Batch existing partner notifications - one email per recipient listing all scope items
    const existingByEmail = new Map<string, typeof existingPartnerNotifications>()
    for (const n of existingPartnerNotifications) {
      const key = n.partnerEmail.trim().toLowerCase()
      if (!existingByEmail.has(key)) existingByEmail.set(key, [])
      existingByEmail.get(key)!.push(n)
    }
    for (const [, notifications] of existingByEmail) {
      try {
        const first = notifications[0]
        const anyNda = notifications.some(n => n.requiresNda)
        const ctaUrl = anyNda ? `${baseUrl}/partner/rfps?nda=required` : `${baseUrl}/partner/rfps`
        const subject = notifications.length === 1
          ? (anyNda ? `${agencyDisplay} requires an NDA to share this RFP with you` : `New RFP from ${agencyDisplay}: ${first.scopeName}`)
          : `${agencyDisplay} has sent you ${notifications.length} RFPs on Ligament`
        const scopeLines = notifications.map(n =>
          n.requiresNda ? `- ${n.scopeName} (NDA required)` : `- ${n.scopeName}`
        ).join("\n")
        const ndaNote = anyNda ? "\n\nOne or more RFPs require a signed NDA before access. Log in and complete the NDA to unlock access." : ""
        const body = notifications.length === 1
          ? (anyNda
              ? `${agencyDisplay} has a confidential RFP for ${first.scopeName} ready for you on Ligament, but requires a signed NDA first.\n\nLog in and complete the NDA to unlock access.`
              : `${agencyDisplay} has sent you an RFP for ${first.scopeName} on Ligament.\n\nReview the scope, timeline, and budget details, then submit your bid directly through the platform.`)
          : `${agencyDisplay} has sent you the following RFPs on Ligament:\n\n${scopeLines}${ndaNote}\n\nLog in to review each brief and submit your bids.`
        await resend.emails.send({
          from: "Ligament <notifications@withligament.com>",
          to: first.partnerEmail,
          subject,
          html: buildBrandedEmailHtml({
            title: anyNda ? "NDA required before access" : "New RFPs in your vendor inbox",
            recipientName: first.partnerName,
            body,
            ctaText: anyNda ? "Sign NDA & View RFPs" : "View RFPs",
            ctaUrl,
          }),
        })
      } catch (error) {
        console.error("[broadcast-rfp] failed existing partner batched notification", {
          email: notifications[0].partnerEmail,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    // Batch manual recipient notifications - one email per recipient listing all scope items
    const manualByEmail = new Map<string, typeof manualRecipientNotifications>()
    for (const n of manualRecipientNotifications) {
      const key = n.recipientEmail.trim().toLowerCase()
      if (!manualByEmail.has(key)) manualByEmail.set(key, [])
      manualByEmail.get(key)!.push(n)
    }
    for (const [, notifications] of manualByEmail) {
      try {
        const first = notifications[0]
        const anyNda = notifications.some(n => n.subject.includes("NDA") || n.heading.includes("NDA"))
        const subject = notifications.length === 1
          ? first.subject
          : `${agencyDisplay} has sent you ${notifications.length} RFPs on Ligament`
        const scopeLines = notifications.map(n => {
          const scopeMatch = n.paragraphs[0]?.match(/for (.+?) (?:ready|on Ligament|and invited)/)
          const scopeName = scopeMatch ? scopeMatch[1] : ""
          return scopeName ? (n.subject.includes("NDA") ? `- ${scopeName} (NDA required)` : `- ${scopeName}`) : null
        }).filter(Boolean).join("\n")
        const body = notifications.length === 1
          ? first.paragraphs.join("\n\n")
          : `${agencyDisplay} has sent you the following RFPs on Ligament:\n\n${scopeLines}${anyNda ? "\n\nOne or more RFPs require a signed NDA before access." : ""}\n\nLog in to review each brief and submit your bids.`
        const ctaUrl = anyNda ? first.ctaUrl : `${baseUrl}/partner/rfps`
        await resend.emails.send({
          from: "Ligament <notifications@withligament.com>",
          to: first.recipientEmail,
          subject,
          html: buildBrandedEmailHtml({
            title: notifications.length === 1 ? first.heading : (anyNda ? "NDA required before access" : "New RFPs in your vendor inbox"),
            recipientName: first.recipientName,
            body,
            ctaText: anyNda ? "Sign NDA & View RFPs" : "View RFPs",
            ctaUrl,
          }),
        })
      } catch (error) {
        console.error("[broadcast-rfp] failed manual recipient batched notification", {
          email: notifications[0].recipientEmail,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    return NextResponse.json({
      ok: true,
      count: rows.length,
      emailsQueued: existingPartnerNotifications.length + manualRecipientNotifications.length,
    })
  } catch (e) {
    console.error("broadcast-rfp:", e)
    return NextResponse.json({ error: "Broadcast failed" }, { status: 500 })
  }
}
