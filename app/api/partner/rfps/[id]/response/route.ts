import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

type Body = {
  proposal_text?: string
  budget_proposal?: string
  timeline_proposal?: string
  attachments?: unknown
  status?: "draft" | "submitted"
}

const ALLOWED_TYPES = new Set([
  "work_example",
  "capabilities_overview",
  "proposal",
  "timeline",
  "budget",
  "other",
])

export type SavedAttachment = {
  type: string
  label: string
  url: string
}

function normalizeAttachments(raw: unknown): SavedAttachment[] {
  if (!Array.isArray(raw)) return []
  const out: SavedAttachment[] = []
  for (const item of raw.slice(0, 6)) {
    if (!item || typeof item !== "object") continue
    const o = item as Record<string, unknown>
    const type = String(o.type ?? "").trim()
    const url = String(o.url ?? "").trim()
    let label = String(o.label ?? "").trim()
    if (!ALLOWED_TYPES.has(type) || !url) continue
    if (type === "other") {
      if (!label) continue
    } else if (!label) {
      label = defaultLabelForType(type)
    }
    out.push({ type, label, url })
  }
  return out
}

function defaultLabelForType(type: string): string {
  switch (type) {
    case "work_example":
      return "Work Example"
    case "capabilities_overview":
      return "Capabilities Overview"
    case "proposal":
      return "Proposal"
    case "timeline":
      return "Timeline"
    case "budget":
      return "Budget"
    default:
      return type
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: inboxId } = await params
    console.log("[partner/rfps/response] POST start", { inboxId })

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
    console.log("[partner/rfps/response] body keys", {
      status: body.status,
      hasAttachments: Array.isArray(body.attachments),
      attachmentCount: Array.isArray(body.attachments) ? body.attachments.length : 0,
    })

    const status = body.status === "submitted" ? "submitted" : "draft"
    const proposal_text = (body.proposal_text ?? "").toString()
    const budget_proposal = (body.budget_proposal ?? "").toString()
    const timeline_proposal = (body.timeline_proposal ?? "").toString()
    const attachments = normalizeAttachments(body.attachments)
    console.log("[partner/rfps/response] normalized attachments", attachments.length)

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
      attachments,
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
        return NextResponse.json(
          { error: error.message, detail: error.code ? `code=${error.code}` : undefined },
          { status: 500 }
        )
      }
      saved = data
    } else {
      const { data, error } = await supabase.from("partner_rfp_responses").insert(insertRow).select().single()
      if (error) {
        console.error("[partner/rfps/response] insert:", error)
        return NextResponse.json(
          { error: error.message, detail: error.code ? `code=${error.code}` : undefined },
          { status: 500 }
        )
      }
      saved = data
    }

    if (status === "submitted") {
      await supabase
        .from("partner_rfp_inbox")
        .update({ status: "bid_submitted", updated_at: new Date().toISOString() })
        .eq("id", inboxId)
    }

    console.log("[partner/rfps/response] POST ok", { responseId: saved?.id, status: saved?.status })
    return NextResponse.json({ response: saved })
  } catch (e) {
    console.error("[partner/rfps] response POST:", e)
    return NextResponse.json({ error: "Failed to save response" }, { status: 500 })
  }
}
