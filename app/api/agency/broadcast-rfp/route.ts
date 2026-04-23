import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { Resend } from "resend"
import { siteBaseUrl } from "@/lib/email"

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

function buildBrandedRfpNotificationHtml(params: {
  recipientName: string
  agencyDisplay: string
  scopeName: string
  baseUrl: string
}): string {
  const safeRecipientName = params.recipientName || "there"
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="margin:0;padding:0;background-color:#081F1F;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
      <div style="max-width:600px;margin:0 auto;padding:40px 20px;">
        <div style="background:#0C3535;border-radius:16px;padding:32px;border:1px solid rgba(255,255,255,0.12);">
          <div style="font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#C8F53C;margin:0 0 16px 0;">
            Ligament
          </div>
          <p style="color:#E8E8E8;font-size:16px;line-height:1.6;margin:0 0 16px 0;">Hi ${safeRecipientName},</p>
          <p style="color:#9BB8B8;font-size:16px;line-height:1.7;margin:0 0 12px 0;">
            <strong style="color:#FFFFFF;">${params.agencyDisplay}</strong> has sent you an RFP for <strong style="color:#FFFFFF;">${params.scopeName}</strong> on Ligament.
          </p>
          <p style="color:#9BB8B8;font-size:16px;line-height:1.7;margin:0 0 24px 0;">
            Review the scope, timeline, and budget details, then submit your bid directly through the platform.
          </p>
          <a
            href="${params.baseUrl}/partner/rfps"
            style="display:inline-block;background:#C8F53C;color:#0C3535;text-decoration:none;padding:14px 24px;border-radius:10px;font-weight:700;font-size:14px;text-transform:uppercase;letter-spacing:0.05em;"
          >
            View RFP
          </a>
          <p style="color:#9BB8B8;font-size:13px;margin:24px 0 0 0;">
            The Ligament Team<br />
            <a href="${params.baseUrl}" style="color:#C8F53C;text-decoration:none;">withligament.com</a>
          </p>
        </div>
      </div>
    </body>
    </html>
  `
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
        : "https://www.docusign.com/"
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
    const nonNdaExistingPartnerNotifications: {
      partnerEmail: string
      partnerName: string
      scopeName: string
    }[] = []
    const nonNdaNewRecipientNotifications: {
      recipientEmail: string
      recipientName: string
      scopeName: string
    }[] = []
    const ndaRequiredNewRecipientNotifications: {
      recipientEmail: string
      recipientName: string
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
          .select("id, nda_confirmed_at, partner:profiles!partnerships_partner_id_fkey(email, full_name, company_name)")
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

        rows.push({
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
          master_rfp_json: masterRfp,
          agency_company_name: agencyDisplay,
          status: "new",
        })

        const partnerEmail = partnership?.partner?.email || ""
        const partnerName =
          partnership?.partner?.company_name || partnership?.partner?.full_name || partnerEmail || "Partner"
        if (!partnerEmail.trim()) {
          console.warn("[broadcast-rfp] active partner has no email; skipping notification", {
            partnerId,
            scopeItemId,
          })
        } else {
          seenRecipientKeys.add(`email:${scopeItemId}:${partnerEmail.trim().toLowerCase()}`)
        }
        if (!ndaRequired && partnerEmail.trim()) {
          nonNdaExistingPartnerNotifications.push({
            partnerEmail,
            partnerName,
            scopeName: scopeItemName,
          })
        }

        if (ndaRequired) {
          const needsNda = !partnership?.nda_confirmed_at
          if (needsNda && partnerEmail) {
            const resendApiKey = process.env.RESEND_API_KEY
            if (resendApiKey) {
              const resend = new Resend(resendApiKey)
              await resend.emails.send({
                from: "Ligament <notifications@withligament.com>",
                to: partnerEmail,
                subject: `${agencyDisplay} shared a confidential RFP with you on Ligament`,
                html: `
                  <p style="font-family:system-ui,sans-serif">Hi ${partnerName},</p>
                  <p style="font-family:system-ui,sans-serif">
                    <strong>${agencyDisplay}</strong> has shared an RFP that requires a signed NDA before you can
                    view the full details.
                  </p>
                  <p style="font-family:system-ui,sans-serif">
                    Please log in to your Ligament partner portal to review the NDA and confirm your agreement to
                    proceed.
                  </p>
                  <p style="font-family:system-ui,sans-serif">
                    <a href="${ndaLink}" style="font-weight:700;color:#0C3535">View RFP</a>
                  </p>
                  <p style="font-family:system-ui,sans-serif">
                    The Ligament Team<br />
                    <a href="${baseUrl}" style="color:#0C3535">withligament.com</a>
                  </p>
                `,
              })
            }
          }
        }
      }

      const normalizedItemNewRecipients = normalizeManualRecipients(
        Array.isArray(item.newRecipients) && item.newRecipients.length > 0
          ? item.newRecipients
          : topLevelNewRecipientsByScope[scopeItemId]
      )
      for (const nr of normalizedItemNewRecipients) {
        const email = (nr?.email || "").trim().toLowerCase()
        if (!email) continue
        const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
        if (!isValidEmail) {
          return NextResponse.json({ error: `Invalid recipient email: ${email}` }, { status: 400 })
        }
        const manualScopeKey = `email:${scopeItemId}:${email}`
        if (seenRecipientKeys.has(manualScopeKey)) continue
        seenRecipientKeys.add(manualScopeKey)

        rows.push({
          agency_id: user.id,
          partner_id: null,
          recipient_email: email,
          partnership_id: null,
          project_id: projectId,
          scope_item_id: scopeItemId,
          scope_item_name: scopeItemName,
          scope_item_description: scopeItemDescription || null,
          estimated_budget: estimatedBudget || null,
          timeline: timeline || null,
          response_deadline: responseDeadline,
          master_rfp_json: masterRfp,
          agency_company_name: agencyDisplay,
          status: "new",
        })

        const recipientName = nr?.name?.trim?.() || email
        if (!ndaRequired || !nr?.requireNda) {
          nonNdaNewRecipientNotifications.push({
            recipientEmail: email,
            recipientName,
            scopeName: scopeItemName,
          })
        }

        if (ndaRequired && nr?.requireNda) {
          ndaRequiredNewRecipientNotifications.push({
            recipientEmail: email,
            recipientName: nr?.name?.trim?.() || "there",
          })
        }
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

    if (!ndaRequired && nonNdaExistingPartnerNotifications.length > 0) {
      const resendApiKey = process.env.RESEND_API_KEY
      if (resendApiKey) {
        const resend = new Resend(resendApiKey)
        for (const notification of nonNdaExistingPartnerNotifications) {
          await resend.emails.send({
            from: "Ligament <notifications@withligament.com>",
            to: notification.partnerEmail,
            subject: `New RFP from ${agencyDisplay}: ${notification.scopeName}`,
            html: buildBrandedRfpNotificationHtml({
              recipientName: notification.partnerName,
              agencyDisplay,
              scopeName: notification.scopeName,
              baseUrl,
            }),
          })
        }
      }
    }

    if (nonNdaNewRecipientNotifications.length > 0) {
      const resendApiKey = process.env.RESEND_API_KEY
      if (!resendApiKey) {
        return NextResponse.json(
          { error: "RESEND_API_KEY is required to send manual recipient notifications." },
          { status: 500 }
        )
      }
      const resend = new Resend(resendApiKey)
      for (const notification of nonNdaNewRecipientNotifications) {
        await resend.emails.send({
          from: "Ligament <notifications@withligament.com>",
          to: notification.recipientEmail,
          subject: `New RFP from ${agencyDisplay}: ${notification.scopeName}`,
          html: buildBrandedRfpNotificationHtml({
            recipientName: notification.recipientName,
            agencyDisplay,
            scopeName: notification.scopeName,
            baseUrl,
          }),
        })
      }
    }

    if (ndaRequiredNewRecipientNotifications.length > 0) {
      const resendApiKey = process.env.RESEND_API_KEY
      if (!resendApiKey) {
        return NextResponse.json(
          { error: "RESEND_API_KEY is required to send NDA-required manual recipient notifications." },
          { status: 500 }
        )
      }
      const resend = new Resend(resendApiKey)
      for (const notification of ndaRequiredNewRecipientNotifications) {
        await resend.emails.send({
          from: "Ligament <notifications@withligament.com>",
          to: notification.recipientEmail,
          subject: `${agencyDisplay} shared a confidential RFP with you on Ligament`,
          html: `
            <p style="font-family:system-ui,sans-serif">Hi ${notification.recipientName},</p>
            <p style="font-family:system-ui,sans-serif">
              <strong>${agencyDisplay}</strong> has shared an RFP that requires a signed NDA before you can
              view the full details.
            </p>
            <p style="font-family:system-ui,sans-serif">
              Please log in to your Ligament partner portal to review the NDA and confirm your agreement to
              proceed.
            </p>
            <p style="font-family:system-ui,sans-serif">
              <a href="${ndaLink}" style="font-weight:700;color:#0C3535">View RFP</a>
            </p>
            <p style="font-family:system-ui,sans-serif">
              The Ligament Team<br />
              <a href="${baseUrl}" style="color:#0C3535">withligament.com</a>
            </p>
          `,
        })
      }
    }

    return NextResponse.json({ ok: true, count: rows.length })
  } catch (e) {
    console.error("broadcast-rfp:", e)
    return NextResponse.json({ error: "Broadcast failed" }, { status: 500 })
  }
}
