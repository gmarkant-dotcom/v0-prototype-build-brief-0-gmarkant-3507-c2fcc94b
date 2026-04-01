import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { partnerCanAccessPartnerRfpInbox } from "@/lib/partner-inbox-access"

export const dynamic = "force-dynamic"

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { data: profile } = await supabase.from("profiles").select("role, email").eq("id", user.id).single()

    if (profile?.role !== "partner") {
      return NextResponse.json({ error: "Partners only" }, { status: 403 })
    }

    const { data: inbox, error: inboxError } = await supabase
      .from("partner_rfp_inbox")
      .select("*")
      .eq("id", id)
      .maybeSingle()

    if (inboxError) {
      console.error("[partner/rfps/[id]] inbox:", inboxError)
      return NextResponse.json({ error: "Failed to load RFP" }, { status: 500 })
    }

    if (!inbox) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    if (
      !partnerCanAccessPartnerRfpInbox(
        {
          partner_id: (inbox.partner_id as string | null) ?? null,
          recipient_email: (inbox.recipient_email as string | null) ?? null,
        },
        user.id,
        profile?.email
      )
    ) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    let agencyMeetingUrl: string | null = null
    if (inbox.agency_id) {
      const { data: agencyProfile, error: agencyErr } = await supabase
        .from("profiles")
        .select("meeting_url")
        .eq("id", inbox.agency_id)
        .maybeSingle()
      if (!agencyErr) {
        agencyMeetingUrl = (agencyProfile?.meeting_url as string | null) || null
      }
    }

    let response: unknown = null
    const respQ = await supabase
      .from("partner_rfp_responses")
      .select("*")
      .eq("inbox_item_id", id)
      .eq("partner_id", user.id)
      .maybeSingle()

    if (respQ.error) {
      if (respQ.error.code !== "42P01" && !/does not exist/i.test(respQ.error.message || "")) {
        console.error("[partner/rfps/[id]] response select failed", { message: respQ.error.message, code: respQ.error.code })
      }
    } else {
      response = respQ.data
    }

    let versions: unknown[] = []
    if (response && (response as { id?: string }).id) {
      const responseId = (response as { id: string }).id
      const { data: versionRows, error: versionErr } = await supabase
        .from("partner_rfp_response_versions")
        .select(
          "id, response_id, version_number, proposal_text, budget_proposal, timeline_proposal, attachments, status_at_submission, submitted_at, change_notes"
        )
        .eq("response_id", responseId)
        .order("version_number", { ascending: false })

      if (!versionErr) {
        versions = versionRows || []
      } else {
        console.error("[api] partner version fetch failed", {
          route: "/api/partner/rfps/[id]",
          method: "GET",
          userId: user.id,
          responseId,
          code: versionErr.code,
          message: versionErr.message,
        })
      }
    }

    return NextResponse.json(
      { inbox: { ...inbox, agency_meeting_url: agencyMeetingUrl }, response: response ?? null, versions },
      {
        headers: {
          "Cache-Control": "private, no-store, no-cache, must-revalidate",
        },
      }
    )
  } catch (e) {
    console.error("[partner/rfps/[id]] GET:", e)
    return NextResponse.json({ error: "Failed to load RFP" }, { status: 500 })
  }
}
