import { resolveCallerOrgIds, callerOwnsOrg } from "@/lib/entitlements"
import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { isActivePartnership } from "@/lib/partnership-state"
import { fetchVouchCounts } from "@/lib/vouch-counts"
import { readDiscoverableProfiles } from "@/lib/server/discoverable-profiles"

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

    // 079: an organization column is not a user id. Reads scope to the caller's memberships.
    const callerOrgIds = await resolveCallerOrgIds(user.id, supabase)
    console.log("[api/marketplace/discoverable] start", { roleFilter: role, userId: user.id })

    // Dual-role accounts keep their original `role` forever - a partner-primary user granted
    // agency access never becomes role="agency", only active_role="agency" while they're using
    // that portal. Discoverability must include both, or dual-role agencies/partners who are
    // is_discoverable never surface to the other side at all. The role match happens inside
    // the discovery path; role and active_role are not returned.
    //
    // 115: PUBLIC DISCOVERY FIELDS ONLY, through public.discoverable_profiles(). No email, legal,
    // billing, rate, terms or authority field of a stranger is read here any more (see
    // lib/server/discoverable-profiles.ts).
    const { data, error } = await readDiscoverableProfiles(supabase, { role })

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
    // vendor_org_id/lead_org_id/status, never expose full list to either party.
    // 079: both columns are ORGANIZATION ids. The PostgREST `.in.()` list form cannot be
    // built from an empty array - `lead_org_id.in.()` is a syntax error, not an empty
    // match - so the empty case skips the query entirely and leaves both sets empty. That
    // is the same result an empty match would have given, reached without the 400.
    const partnershipRows =
      callerOrgIds.length === 0
        ? []
        : (
            await supabase
              .from("partnerships")
              .select("lead_org_id, vendor_org_id, status")
              .or(
                `lead_org_id.in.(${callerOrgIds.join(",")}),vendor_org_id.in.(${callerOrgIds.join(",")})`
              )
          ).data ?? []

    // "My Network" (any partnership status) vs email-unmask eligibility (active only).
    const partnerIdsWithPartnership = new Set<string>()
    const activePartnerIds = new Set<string>()
    for (const p of partnershipRows) {
      const otherId = (callerOwnsOrg(callerOrgIds, p.lead_org_id) ? p.vendor_org_id : p.lead_org_id) as string | null
      if (!otherId) continue
      partnerIdsWithPartnership.add(otherId)
      if (isActivePartnership(p)) activePartnerIds.add(otherId)
    }

    // Unmask email for self + anyone with an active partnership (bidirectional). The email is
    // read with the session client, so it arrives only where the partnership-members policy
    // already admits the row; the discovery path never carries it.
    const unmaskIds = (data ?? []).map((row) => row.id).filter((id) => id === user.id || activePartnerIds.has(id))
    const emailById = new Map<string, string | null>()
    if (unmaskIds.length > 0) {
      const { data: emailRows, error: emailErr } = await supabase.from("profiles").select("id, email").in("id", unmaskIds)
      if (emailErr) {
        console.error("[marketplace/discoverable] email read failed", { code: emailErr.code, message: emailErr.message })
      }
      for (const r of emailRows || []) emailById.set(String(r.id), (r.email as string | null) ?? null)
    }
    const maskedProfiles = (data ?? []).map((row) => ({
      ...row,
      email: emailById.get(row.id) ?? (null as string | null),
      has_partnership: partnerIdsWithPartnership.has(row.id),
    }))

    // Fetch vouch counts (aggregate only — never expose individual voucher identities).
    // Routed through lib/vouch-counts.ts so the number arrives as a projection rather
    // than as a table scan. See migration 082: the `USING (true)` policy on
    // partner_vouches publishes the whole vouch graph, and this is the read side of
    // closing it.
    const profileIds = maskedProfiles.map((p) => p.id as string)
    // 079 PARAMETER CLASS, NOT CLOSED HERE - see docs/vendor-visibility-report.md.
    // `profileIds` are profiles ids and partner_vouches.vendor_org_id is an ORGANIZATION
    // column, so every count here is right only for the sixteen backfilled accounts and
    // silently zero for the rest. Same blocker as the pool detail page: org_members SELECT is
    // self-row-only, this route uses the session client, and adding the service role to it is
    // out of bounds. Needs a SECURITY DEFINER mapping in a migration. Undercount, not
    // disclosure.
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
