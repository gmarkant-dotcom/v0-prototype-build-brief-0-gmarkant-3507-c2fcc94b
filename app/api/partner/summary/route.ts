import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

const noStoreHeaders = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate",
} as const

const revalidateHeaders = {
  "Cache-Control": "private, max-age=0, stale-while-revalidate=30",
} as const

const ROUTE = "/api/partner/summary"

export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStoreHeaders })
    }

    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single()
    if (profile?.role !== "partner") {
      return NextResponse.json({ error: "Partner only" }, { status: 403, headers: noStoreHeaders })
    }

    const { count: agencyRelationships, error: pErr } = await supabase
      .from("partnerships")
      .select("*", { count: "exact", head: true })
      .eq("partner_id", user.id)
      .eq("status", "active")

    if (pErr) {
      console.error("[partner/summary] partnerships", pErr)
      return NextResponse.json({ error: "Failed to load summary" }, { status: 500, headers: noStoreHeaders })
    }

    const { count: bidsSubmitted, error: bErr } = await supabase
      .from("partner_rfp_responses")
      .select("*", { count: "exact", head: true })
      .eq("partner_id", user.id)
      .neq("status", "draft")

    if (bErr) {
      console.error("[partner/summary] responses", bErr)
      return NextResponse.json({ error: "Failed to load summary" }, { status: 500, headers: noStoreHeaders })
    }

    const { data: pships, error: idsErr } = await supabase.from("partnerships").select("id").eq("partner_id", user.id)

    if (idsErr) {
      console.error("[partner/summary] partnership ids", idsErr)
      return NextResponse.json({ error: "Failed to load summary" }, { status: 500, headers: noStoreHeaders })
    }

    const partnershipIds = (pships || []).map((r) => r.id as string)
    let activeEngagements = 0
    if (partnershipIds.length > 0) {
      const { count: ae, error: aeErr } = await supabase
        .from("project_assignments")
        .select("*", { count: "exact", head: true })
        .in("partnership_id", partnershipIds)
        .eq("status", "awarded")

      if (aeErr) {
        console.error("[partner/summary] assignments", aeErr)
        return NextResponse.json({ error: "Failed to load summary" }, { status: 500, headers: noStoreHeaders })
      }
      activeEngagements = ae ?? 0
    }

    const payload = {
      agency_relationships: agencyRelationships ?? 0,
      bids_submitted: bidsSubmitted ?? 0,
      active_engagements: activeEngagements,
    }

    console.log("[api] success", { route: ROUTE, method: "GET", userId: user.id, ...payload })
    return NextResponse.json(payload, { headers: revalidateHeaders })
  } catch (e) {
    console.error("[partner/summary] unhandled", e)
    return NextResponse.json({ error: "Failed" }, { status: 500, headers: noStoreHeaders })
  }
}
