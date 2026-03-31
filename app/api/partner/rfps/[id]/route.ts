import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

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

    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single()

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
        console.warn("[partner/rfps/[id]] response select:", respQ.error.message)
      }
    } else {
      response = respQ.data
    }

    console.log("[api] partner response row context", {
      route: "/api/partner/rfps/[id]",
      method: "GET",
      userId: user.id,
      inboxId: id,
      hasResponse: !!response,
      responseId: (response as { id?: string } | null)?.id ?? null,
      responsePartnerId: (response as { partner_id?: string } | null)?.partner_id ?? null,
    })

    let versions: unknown[] = []
    if (response && (response as { id?: string }).id) {
      const responseId = (response as { id: string }).id
      const { data: versionRows, error: versionErr } = await supabase
        .from("partner_rfp_response_versions")
        .select("id, response_id, version_number, proposal_text, budget_proposal, timeline_proposal, attachments, status_at_submission, submitted_at")
        .eq("response_id", responseId)
        .order("version_number", { ascending: false })

      if (!versionErr) {
        versions = versionRows || []
      } else {
        console.warn("[api] partner version fetch failed", {
          route: "/api/partner/rfps/[id]",
          method: "GET",
          userId: user.id,
          responseId,
          code: versionErr.code,
          message: versionErr.message,
        })
      }
      console.log("[api] partner version fetch", {
        route: "/api/partner/rfps/[id]",
        method: "GET",
        userId: user.id,
        responseId,
        versionCount: versions.length,
      })
    } else {
      console.warn("[api] partner version fetch skipped (no response row)", {
        route: "/api/partner/rfps/[id]",
        method: "GET",
        userId: user.id,
        inboxId: id,
      })
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
