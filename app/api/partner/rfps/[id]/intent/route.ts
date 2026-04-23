import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { partnerCanAccessPartnerRfpInbox } from "@/lib/partner-inbox-access"

const ALLOWED_INTENTS = new Set(["will_respond", "has_questions", "requesting_call"])

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role, email")
      .eq("id", user.id)
      .single()

    if (profileError || profile?.role !== "partner") {
      return NextResponse.json({ error: "Partners only" }, { status: 403 })
    }

    const body = await req.json().catch(() => ({}))
    const partnerIntent =
      typeof body.partner_intent === "string" ? body.partner_intent.trim() : ""

    if (!ALLOWED_INTENTS.has(partnerIntent)) {
      return NextResponse.json({ error: "Invalid partner_intent value" }, { status: 400 })
    }

    const { data: inbox, error: inboxError } = await supabase
      .from("partner_rfp_inbox")
      .select("id, partner_id, recipient_email, status, nda_gate_enforced, nda_confirmed_at")
      .eq("id", id)
      .maybeSingle()

    if (inboxError) {
      console.error("[partner/rfps/[id]/intent] inbox lookup failed:", inboxError)
      return NextResponse.json({ error: "Failed to load RFP" }, { status: 500 })
    }
    if (!inbox) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const access = partnerCanAccessPartnerRfpInbox(
      {
        partner_id: (inbox.partner_id as string | null) ?? null,
        recipient_email: (inbox.recipient_email as string | null) ?? null,
        nda_gate_enforced: (inbox.nda_gate_enforced as boolean | null) ?? false,
        nda_confirmed_at: (inbox.nda_confirmed_at as string | null) ?? null,
      },
      user.id,
      profile.email
    )

    if (!access.allowed) {
      if (access.reason === "nda_required") {
        return NextResponse.json({ error: "nda_required", inboxItemId: id }, { status: 403 })
      }
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    let effectiveStatus = (inbox.status || "").toString()
    const { data: existingResponse } = await supabase
      .from("partner_rfp_responses")
      .select("status")
      .eq("inbox_item_id", id)
      .eq("partner_id", user.id)
      .maybeSingle()
    if (existingResponse?.status) {
      effectiveStatus = String(existingResponse.status)
    }

    const blockedStatuses = new Set(["bid_submitted", "submitted", "awarded", "declined"])
    if (blockedStatuses.has(effectiveStatus)) {
      return NextResponse.json({ error: "Intent can no longer be updated for this RFP" }, { status: 409 })
    }

    const now = new Date().toISOString()
    const { data: updated, error: updateError } = await supabase
      .from("partner_rfp_inbox")
      .update({
        partner_intent: partnerIntent,
        intent_set_at: now,
      })
      .eq("id", id)
      .select("id, partner_intent, intent_set_at, status")
      .single()

    if (updateError) {
      console.error("[partner/rfps/[id]/intent] update failed:", updateError)
      return NextResponse.json({ error: "Failed to update intent" }, { status: 500 })
    }

    return NextResponse.json({ inbox: updated })
  } catch (e) {
    console.error("[partner/rfps/[id]/intent] PATCH:", e)
    return NextResponse.json({ error: "Failed to update intent" }, { status: 500 })
  }
}
