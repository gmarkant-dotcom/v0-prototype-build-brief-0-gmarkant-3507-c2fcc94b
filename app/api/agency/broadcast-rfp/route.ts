import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

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
    const items = (Array.isArray(body.items) ? body.items : []) as BroadcastItem[]

    if (!masterRfp || typeof masterRfp !== "object") {
      return NextResponse.json({ error: "masterRfp is required" }, { status: 400 })
    }

    if (items.length === 0) {
      return NextResponse.json({ error: "No broadcast items" }, { status: 400 })
    }

    const agencyDisplay =
      profile.company_name?.trim() || profile.full_name?.trim() || "Lead agency"

    const rows: Record<string, unknown>[] = []

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
          .select("id")
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
          master_rfp_json: masterRfp,
          agency_company_name: agencyDisplay,
          status: "new",
        })
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
          master_rfp_json: masterRfp,
          agency_company_name: agencyDisplay,
          status: "new",
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

    return NextResponse.json({ ok: true, count: rows.length })
  } catch (e) {
    console.error("broadcast-rfp:", e)
    return NextResponse.json({ error: "Broadcast failed" }, { status: 500 })
  }
}
