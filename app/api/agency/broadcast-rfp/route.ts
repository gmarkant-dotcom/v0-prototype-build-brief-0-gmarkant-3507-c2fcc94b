import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { Resend } from "resend"

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

    const rows: Record<string, unknown>[] = []
    const nonNdaExistingPartnerNotifications: {
      partnerEmail: string
      partnerName: string
      scopeName: string
    }[] = []

    for (const item of items) {
      const si = item.scopeItem
      if (!si?.id) continue

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

        rows.push({
          agency_id: user.id,
          partner_id: partnerId,
          recipient_email: null,
          partnership_id: partnership.id,
          project_id: projectId,
          scope_item_id: si.id,
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
        if (!ndaRequired && partnerEmail) {
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
                    <a href="https://withligament.com" style="color:#0C3535">withligament.com</a>
                  </p>
                `,
              })
            }
          }
        }
      }

      for (const nr of item.newRecipients || []) {
        const email = (nr?.email || "").trim().toLowerCase()
        if (!email) continue
        rows.push({
          agency_id: user.id,
          partner_id: null,
          recipient_email: email,
          partnership_id: null,
          project_id: projectId,
          scope_item_id: si.id,
          scope_item_name: scopeItemName,
          scope_item_description: scopeItemDescription || null,
          estimated_budget: estimatedBudget || null,
          timeline: timeline || null,
          response_deadline: responseDeadline,
          master_rfp_json: masterRfp,
          agency_company_name: agencyDisplay,
          status: "new",
        })

        if (ndaRequired && nr?.requireNda) {
          const resendApiKey = process.env.RESEND_API_KEY
          if (resendApiKey) {
            const resend = new Resend(resendApiKey)
            await resend.emails.send({
              from: "Ligament <notifications@withligament.com>",
              to: email,
              subject: `${agencyDisplay} shared a confidential RFP with you on Ligament`,
              html: `
                <p style="font-family:system-ui,sans-serif">Hi ${nr?.name || "there"},</p>
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
                  <a href="https://withligament.com" style="color:#0C3535">withligament.com</a>
                </p>
              `,
            })
          }
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
            html: `
              <p style="font-family:system-ui,sans-serif">Hi ${notification.partnerName},</p>
              <p style="font-family:system-ui,sans-serif">
                ${agencyDisplay} has sent you an RFP for ${notification.scopeName} on Ligament.
              </p>
              <p style="font-family:system-ui,sans-serif">
                Review the scope, timeline, and budget details, then submit your bid directly through the platform.
              </p>
              <p style="font-family:system-ui,sans-serif">
                <a href="https://withligament.com/partner/rfps" style="font-weight:700;color:#0C3535">View RFP</a>
              </p>
              <p style="font-family:system-ui,sans-serif">
                The Ligament Team<br />
                <a href="https://withligament.com" style="color:#0C3535">withligament.com</a>
              </p>
            `,
          })
        }
      }
    }

    return NextResponse.json({ ok: true, count: rows.length })
  } catch (e) {
    console.error("broadcast-rfp:", e)
    return NextResponse.json({ error: "Broadcast failed" }, { status: 500 })
  }
}
