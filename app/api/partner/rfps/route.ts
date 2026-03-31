import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

/** Never cache this handler — avoids empty JSON stuck behind 304 on Vercel/CDN. */
export const dynamic = "force-dynamic"
export const revalidate = 0

const noStoreHeaders = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
} as const

export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      console.warn("[partner/rfps] GET: no session user")
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStoreHeaders })
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, email")
      .eq("id", user.id)
      .single()

    if (profile?.role !== "partner") {
      console.warn(
        `[partner/rfps] GET: wrong role — userId=${user.id} email=${user.email ?? profile?.email ?? "n/a"} profileRole=${profile?.role ?? "null"}`
      )
      return NextResponse.json({ error: "Partners only" }, { status: 403, headers: noStoreHeaders })
    }

    // RLS applies: partner sees rows where partner_id = auth.uid() OR recipient_email matches profile email
    const { data, error } = await supabase
      .from("partner_rfp_inbox")
      .select("*")
      .order("created_at", { ascending: false })

    if (error) {
      console.error("[partner/rfps] partner_rfp_inbox select error:", user.id, error.message)
      return NextResponse.json(
        { error: "Failed to load RFPs", detail: error.message },
        { status: 500, headers: noStoreHeaders }
      )
    }

    const rows = data || []
    const agencyIds = Array.from(new Set(rows.map((r) => r.agency_id).filter(Boolean)))
    let agencyMeetingUrlById: Record<string, string | null> = {}
    if (agencyIds.length > 0) {
      const { data: agencies } = await supabase.from("profiles").select("id, meeting_url").in("id", agencyIds)
      agencyMeetingUrlById = Object.fromEntries(
        (agencies || []).map((a) => [a.id as string, (a.meeting_url as string | null) || null])
      )
    }
    const inboxIds = rows.map((r) => r.id).filter(Boolean)
    let responseByInboxId: Record<string, { status?: string; agency_feedback?: string | null; feedback_updated_at?: string | null }> = {}
    if (inboxIds.length > 0) {
      const { data: responses } = await supabase
        .from("partner_rfp_responses")
        .select("inbox_item_id, status, agency_feedback, feedback_updated_at, updated_at")
        .in("inbox_item_id", inboxIds)
      // In case of multiple rows per inbox (legacy data), keep the latest.
      for (const resp of responses || []) {
        const key = resp.inbox_item_id as string
        const prev = responseByInboxId[key] as ({ updated_at?: string } & { status?: string; agency_feedback?: string | null; feedback_updated_at?: string | null }) | undefined
        if (!prev || (resp.updated_at && (!prev.updated_at || resp.updated_at > prev.updated_at))) {
          responseByInboxId[key] = resp as { status?: string; agency_feedback?: string | null; feedback_updated_at?: string | null }
        }
      }
    }
    const mergedRows = rows.map((row) => {
      const resp = responseByInboxId[row.id as string]
      const effectiveStatus = (resp?.status || row.status || "new") as string
      return {
        ...row,
        response_status: resp?.status || null,
        effective_status: effectiveStatus,
        agency_feedback: resp?.agency_feedback || null,
        feedback_updated_at: resp?.feedback_updated_at || null,
        agency_meeting_url: agencyMeetingUrlById[row.agency_id as string] || null,
      }
    })
    const samplePartnerId = rows[0]?.partner_id ?? null
    const sampleRecipientEmail = rows[0]?.recipient_email ?? null

    // Diagnostic: rows explicitly keyed to this user (should match RLS for partner_id–scoped rows)
    const { count: countByPartnerId } = await supabase
      .from("partner_rfp_inbox")
      .select("*", { count: "exact", head: true })
      .eq("partner_id", user.id)

    console.log(
      `[partner/rfps] GET ok userId=${user.id} profileEmail=${profile?.email ?? "n/a"} rowsReturned=${mergedRows.length} countWherePartnerIdEqUser=${countByPartnerId ?? "?"}` +
        (mergedRows.length > 0
          ? ` sampleRowPartnerId=${samplePartnerId} sampleRecipientEmail=${sampleRecipientEmail}`
          : "")
    )
    console.log("[partner/rfps] status merge diagnostics", {
      userId: user.id,
      rowsWithResponseStatus: mergedRows.filter((r) => !!r.response_status).length,
      rowsWithoutResponseStatus: mergedRows.filter((r) => !r.response_status).length,
    })

    return NextResponse.json({ rfps: mergedRows }, { headers: noStoreHeaders })
  } catch (e) {
    console.error("[partner/rfps] GET exception:", e)
    return NextResponse.json({ error: "Failed to load RFPs" }, { status: 500, headers: noStoreHeaders })
  }
}
