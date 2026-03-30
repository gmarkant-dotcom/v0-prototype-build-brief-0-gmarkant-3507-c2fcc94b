import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

type Body = {
  proposal_text?: string
  budget_proposal?: string
  timeline_proposal?: string
  work_example_urls?: string[]
  proposal_document_url?: string | null
  proposal_deck_link?: string | null
  status?: "draft" | "submitted"
}

function normalizeUrls(urls: unknown): string[] {
  if (!Array.isArray(urls)) return []
  const out = urls.map((u) => String(u).trim()).filter(Boolean)
  return out.slice(0, 3)
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: inboxId } = await params
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, company_name, full_name, email")
      .eq("id", user.id)
      .single()

    if (profile?.role !== "partner") {
      return NextResponse.json({ error: "Partners only" }, { status: 403 })
    }

    const { data: inbox, error: inboxErr } = await supabase
      .from("partner_rfp_inbox")
      .select("id, agency_id, partner_id, recipient_email")
      .eq("id", inboxId)
      .maybeSingle()

    if (inboxErr || !inbox) {
      return NextResponse.json({ error: "RFP not found or access denied" }, { status: 404 })
    }

    const body = (await req.json().catch(() => ({}))) as Body
    const status = body.status === "submitted" ? "submitted" : "draft"
    const proposal_text = (body.proposal_text ?? "").toString()
    const budget_proposal = (body.budget_proposal ?? "").toString()
    const timeline_proposal = (body.timeline_proposal ?? "").toString()
    const work_example_urls = normalizeUrls(body.work_example_urls)
    const proposal_document_url =
      body.proposal_document_url === null || body.proposal_document_url === undefined
        ? null
        : String(body.proposal_document_url).trim() || null
    const proposal_deck_link =
      body.proposal_deck_link === null || body.proposal_deck_link === undefined
        ? null
        : String(body.proposal_deck_link).trim() || null

    if (status === "submitted") {
      if (!proposal_text.trim()) {
        return NextResponse.json({ error: "Proposal text is required to submit" }, { status: 400 })
      }
      if (!budget_proposal.trim()) {
        return NextResponse.json({ error: "Budget proposal is required to submit" }, { status: 400 })
      }
      if (!timeline_proposal.trim()) {
        return NextResponse.json({ error: "Timeline proposal is required to submit" }, { status: 400 })
      }
    }

    const partner_display_name =
      profile.company_name?.trim() ||
      profile.full_name?.trim() ||
      profile.email?.trim() ||
      "Partner"

    const row = {
      proposal_text,
      budget_proposal,
      timeline_proposal,
      work_example_urls,
      proposal_document_url,
      proposal_deck_link,
      partner_display_name,
      status,
      updated_at: new Date().toISOString(),
    }

    const insertRow = {
      inbox_item_id: inboxId,
      partner_id: user.id,
      agency_id: inbox.agency_id,
      ...row,
    }

    const { data: existing } = await supabase
      .from("partner_rfp_responses")
      .select("id")
      .eq("inbox_item_id", inboxId)
      .eq("partner_id", user.id)
      .maybeSingle()

    let saved
    if (existing?.id) {
      const { data, error } = await supabase
        .from("partner_rfp_responses")
        .update(row)
        .eq("id", existing.id)
        .select()
        .single()
      if (error) {
        console.error("[partner/rfps/response] update:", error)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      saved = data
    } else {
      const { data, error } = await supabase.from("partner_rfp_responses").insert(insertRow).select().single()
      if (error) {
        console.error("[partner/rfps/response] insert:", error)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      saved = data
    }

    if (status === "submitted") {
      await supabase
        .from("partner_rfp_inbox")
        .update({ status: "bid_submitted", updated_at: new Date().toISOString() })
        .eq("id", inboxId)
    }

    return NextResponse.json({ response: saved })
  } catch (e) {
    console.error("[partner/rfps] response POST:", e)
    return NextResponse.json({ error: "Failed to save response" }, { status: 500 })
  }
}
