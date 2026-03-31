import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single()

    if (profile?.role !== "agency") {
      return NextResponse.json({ error: "Agency only" }, { status: 403 })
    }

    // RLS: policy "Agencies select RFP responses they own" — USING (agency_id = auth.uid())
    const { data: responses, error } = await supabase
      .from("partner_rfp_responses")
      .select("*")
      .eq("agency_id", user.id)
      .order("updated_at", { ascending: false })

    if (error) {
      console.error("[agency/rfp-responses] partner_rfp_responses select error", {
        userId: user.id,
        message: error.message,
        code: error.code,
      })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const list = responses || []
    console.log("[agency/rfp-responses] GET ok", {
      authUserId: user.id,
      query: "partner_rfp_responses WHERE agency_id = auth.uid()",
      rowCount: list.length,
    })

    const inboxIds = [...new Set(list.map((r) => r.inbox_item_id))]

    let inboxById: Record<string, Record<string, unknown>> = {}
    if (inboxIds.length > 0) {
      const { data: inboxes } = await supabase
        .from("partner_rfp_inbox")
        .select("id, scope_item_name, scope_item_description, created_at, master_rfp_json, status")
        .in("id", inboxIds)
        .eq("agency_id", user.id)

      inboxById = Object.fromEntries((inboxes || []).map((i) => [i.id as string, i as Record<string, unknown>]))
    }

    const merged = list.map((r) => ({
      ...r,
      inbox: inboxById[r.inbox_item_id as string] ?? null,
    }))

    return NextResponse.json(
      { responses: merged },
      {
        headers: {
          "Cache-Control": "private, no-store, no-cache, must-revalidate",
        },
      }
    )
  } catch (e) {
    console.error("[agency/rfp-responses] GET:", e)
    return NextResponse.json({ error: "Failed to load responses" }, { status: 500 })
  }
}
