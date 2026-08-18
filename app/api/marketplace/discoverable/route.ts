import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { isActivePartnership } from "@/lib/partnership-state"
import { fetchVouchCounts } from "@/lib/vouch-counts"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  try {
    const role = req.nextUrl.searchParams.get("role")
    if (role !== "agency" && role !== "partner") {
      return NextResponse.json({ error: "Invalid role filter" }, { status: 400 })
    }

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    console.log("[api/marketplace/discoverable] start", { roleFilter: role, userId: user.id })

    // Dual-role accounts keep their original `role` forever - a partner-primary user granted
    // agency access never becomes role="agency", only active_role="agency" while they're using
    // that portal. Discoverability must include both, or dual-role agencies/partners who are
    // is_discoverable never surface to the other side at all.
    let discoverableQuery = supabase
      .from("profiles")
      .select(
        "id, role, active_role, company_name, full_name, bio, location, company_website, avatar_url, company_logo_url, company_linkedin_url, agency_type, email, reel_url, capabilities, work_examples, business_criteria"
      )
      .eq("is_discoverable", true)
      .order("company_name", { ascending: true })
    discoverableQuery = discoverableQuery.or(`role.eq.${role},active_role.eq.${role}`)

    const { data, error } = await discoverableQuery

    if (error) {
      console.error("[marketplace/discoverable] query failed", {
        roleFilter: role,
        code: error.code,
        message: error.message,
      })
      return NextResponse.json({ error: "Failed to load discoverable profiles" }, { status: 500 })
    }

    console.log("[api/marketplace/discoverable] success", {
      roleFilter: role,
      discoverableCount: data?.length ?? 0,
    })

    // Check partnerships — bidirectional: viewer may be agency or partner. Only fetch
    // partner_id/agency_id/status, never expose full list to either party.
    const { data: allPartnerships } = await supabase
      .from("partnerships")
      .select("agency_id, partner_id, status")
      .or(`agency_id.eq.${user.id},partner_id.eq.${user.id}`)

    // "My Network" (any partnership status) vs email-unmask eligibility (active only).
    const partnerIdsWithPartnership = new Set<string>()
    const activePartnerIds = new Set<string>()
    for (const p of allPartnerships ?? []) {
      const otherId = (p.agency_id === user.id ? p.partner_id : p.agency_id) as string | null
      if (!otherId) continue
      partnerIdsWithPartnership.add(otherId)
      if (isActivePartnership(p)) activePartnerIds.add(otherId)
    }

    // Unmask email for self + anyone with an active partnership (bidirectional)
    const maskedProfiles = (data ?? []).map((row) => {
      const isOwn = row.id === user.id
      const hasPartnership = activePartnerIds.has(row.id as string)
      return isOwn || hasPartnership
        ? { ...row, has_partnership: partnerIdsWithPartnership.has(row.id as string) }
        : { ...row, email: null as string | null, has_partnership: partnerIdsWithPartnership.has(row.id as string) }
    })

    // Fetch vouch counts (aggregate only — never expose individual voucher identities).
    // Routed through lib/vouch-counts.ts so the number arrives as a projection rather
    // than as a table scan. See migration 082: the `USING (true)` policy on
    // partner_vouches publishes the whole vouch graph, and this is the read side of
    // closing it.
    const profileIds = maskedProfiles.map((p) => p.id as string)
    const vouchCountByPartnerId = await fetchVouchCounts(supabase, profileIds)

    const profiles = maskedProfiles.map((p) => ({
      ...p,
      vouch_count: vouchCountByPartnerId.get(p.id as string) ?? 0,
    }))

    return NextResponse.json(
      { profiles },
      { headers: { "Cache-Control": "private, no-store, no-cache, must-revalidate" } }
    )
  } catch (error) {
    console.error("[api/marketplace/discoverable] failure", {
      message: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
