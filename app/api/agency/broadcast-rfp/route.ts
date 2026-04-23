import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { Resend } from "resend"
import { buildBrandedEmailHtml, siteBaseUrl } from "@/lib/email"

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
  partner?:
    | {
        email?: string | null
        full_name?: string | null
        company_name?: string | null
      }
    | Array<{
        email?: string | null
        full_name?: string | null
        company_name?: string | null
      }>
    | null
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

function normalizePartnerProfile(raw: PartnershipRow["partner"]) {
  if (!raw) return null
  if (Array.isArray(raw)) return raw[0] || null
  return raw
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

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, company_name, full_name")
      .eq("id", user.id)
      .single()

    if (profile?.role !== "agency") {
      return NextResponse.json({ error: "Only lead agencies can broadcast RFPs" }, { status: 403 })
    }

    const body = await request.json()
    const projectId =
      typeof body.projectId === "string" && body.projectId.length > 0 ? body.projectId : null
    const masterRfp = body.masterRfp
    const ndaRequired = body.ndaRequired === true
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

    if (items.length === 0) {
      return NextResponse.json({ error: "No broadcast items" }, { status: 400 })
    }

    const agencyDisplay =
      profile.company_name?.trim() || profile.full_name?.trim() || "Lead agency"
    const baseUrl = siteBaseUrl()

    const rows: Record<string, unknown>[] = []
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
          .from("partnerships")
          .select(
            "id, nda_confirmed_at, partner_email, partner:profiles!partnerships_partner_id_fkey(email, full_name, company_name)"
          )
          .eq("agency_id", user.id)
          .eq("partner_id", partnerId)
          .eq("status", "active")
          .maybeSingle()

        if (pErr) {
          console.error("partnership lookup:", pErr)
          return NextResponse.json({ error: "Could not verify partnership" }, { status: 500 })
        }

        if (!partnership) {
          return NextResponse.json(
            {
              error: "One or more selected partners are not active partners of your agency.",
              partnerId,
            },
            { status: 400 }
          )
        }

        const partnerScopeKey = `partner:${scopeItemId}:${partnerId}`
        if (seenRecipientKeys.has(partnerScopeKey)) continue
        seenRecipientKeys.add(partnerScopeKey)

        const row = {
          agency_id: user.id,
          partner_id: partnerId,
          recipient_email: null,
          partnership_id: partnership.id,
          project_id: projectId,
          scope_item_id: scopeItemId,
          scope_item_name: scopeItemName,
          scope_item_description: scopeItemDescription || null,
          estimated_budget: estimatedBudget || null,
          timeline: timeline || null,
          response_deadline: responseDeadline,
          master_rfp_json: { ...(masterRfp as Record<string, unknown>), nda_link: ndaLink || null },
          agency_company_name: agencyDisplay,
          status: "new",
        }
        rows.push(row)

        const normalizedPartner = normalizePartnerProfile((partnership as PartnershipRow).partner)
        const partnerEmail = (
          normalizedPartner?.email ||
          (partnership as PartnershipRow).partner_email ||
          ""
        )
          .trim()
          .toLowerCase()
        const partnerName =
          normalizedPartner?.company_name ||
          normalizedPartner?.full_name ||
          partnerEmail ||
          "Partner"
        if (!partnerEmail.trim()) {
          console.warn("[broadcast-rfp] active partner has no email; skipping notification", {
            partnerId,
            scopeItemId,
          })
        } else {
          seenRecipientKeys.add(`email:${scopeItemId}:${partnerEmail.trim().toLowerCase()}`)
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

        const isExistingUser = Boolean(existingProfile?.id)
        let partnershipForManual: PartnershipRow | null = null
        if (isExistingUser) {
          const { data: existingPartnership } = await supabase
            .from("partnerships")
            .select(
              "id, nda_confirmed_at, partner_email, partner:profiles!partnerships_partner_id_fkey(email, full_name, company_name)"
            )
            .eq("agency_id", user.id)
            .eq("partner_id", existingProfile!.id)
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
          agency_id: user.id,
          partner_id: isExistingUser ? existingProfile!.id : null,
          recipient_email: email,
          partnership_id: partnershipForManual?.id || null,
          project_id: projectId,
          scope_item_id: scopeItemId,
          scope_item_name: scopeItemName,
          scope_item_description: scopeItemDescription || null,
          estimated_budget: estimatedBudget || null,
          timeline: timeline || null,
          response_deadline: responseDeadline,
          master_rfp_json: { ...(masterRfp as Record<string, unknown>), nda_link: ndaLink || null },
          agency_company_name: agencyDisplay,
          invite_token: inviteToken,
          invite_token_expires_at: expiresAt,
          claimed_at: claimedAt,
          nda_gate_enforced: ndaGateEnforced,
          nda_confirmed_at: ndaAlreadySigned ? new Date().toISOString() : null,
          status: "new",
        })

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
          heading: "New RFP in your partner inbox",
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

    const { error: insertError } = await supabase.from("partner_rfp_inbox").insert(rows)

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

    // TODO: Add scheduled Vercel cron job to mark expired unclaimed invite rows
    // (invite_token_expires_at < now() and claimed_at is null) with status = 'expired'
    // See: https://vercel.com/docs/cron-jobs

    const resendApiKey = process.env.RESEND_API_KEY
    const resend = resendApiKey ? new Resend(resendApiKey) : null
    if (!resend) {
      console.error("[broadcast-rfp] RESEND_API_KEY not configured; broadcast rows created without notifications")
      return NextResponse.json({ ok: true, count: rows.length, emailsQueued: 0, emailConfigMissing: true })
    }

    for (const notification of existingPartnerNotifications) {
      try {
        const subject = notification.requiresNda
          ? `${agencyDisplay} requires an NDA to share this RFP with you`
          : `New RFP from ${agencyDisplay}: ${notification.scopeName}`
        const ctaUrl = notification.requiresNda
          ? `${baseUrl}/partner/rfps?nda=required`
          : `${baseUrl}/partner/rfps`
        const body = notification.requiresNda
          ? `${agencyDisplay} has a confidential RFP for ${notification.scopeName} ready for you on Ligament, but requires a signed NDA first.\n\nLog in and complete the NDA to unlock access.`
          : `${agencyDisplay} has sent you an RFP for ${notification.scopeName} on Ligament.\n\nReview the scope, timeline, and budget details, then submit your bid directly through the platform.`
        await resend.emails.send({
          from: "Ligament <notifications@withligament.com>",
          to: notification.partnerEmail,
          subject,
          html: buildBrandedEmailHtml({
            title: notification.requiresNda ? "NDA required before access" : "New RFP in your partner inbox",
            recipientName: notification.partnerName,
            body,
            ctaText: notification.requiresNda ? "Sign NDA & View RFP" : "View RFP",
            ctaUrl,
          }),
        })
      } catch (error) {
        console.error("[broadcast-rfp] failed existing partner notification send", {
          email: notification.partnerEmail,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    for (const notification of manualRecipientNotifications) {
      try {
        await resend.emails.send({
          from: "Ligament <notifications@withligament.com>",
          to: notification.recipientEmail,
          subject: notification.subject,
          html: buildBrandedEmailHtml({
            title: notification.heading,
            recipientName: notification.recipientName,
            body: notification.paragraphs.join("\n\n"),
            ctaText: notification.ctaLabel,
            ctaUrl: notification.ctaUrl,
          }),
        })
      } catch (error) {
        console.error("[broadcast-rfp] failed manual recipient notification send", {
          email: notification.recipientEmail,
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
