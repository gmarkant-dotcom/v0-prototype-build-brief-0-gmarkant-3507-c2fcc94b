import { resolveCallerOrgIds } from "@/lib/entitlements"
import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { isActivePartnership } from "@/lib/partnership-state"
import { canActAs } from "@/lib/acting-role"
import {
  isMissingRateInfoColumnError,
  resolveRateInfoForPartnership,
} from "@/lib/partner-rate-info-read"
import { buildEngagementHistory, unwrapInbox } from "@/lib/engagement-history"

export const dynamic = "force-dynamic"

const noStore = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
} as const

const revalidateHeaders = {
  "Cache-Control": "private, max-age=0, stale-while-revalidate=30",
} as const

export async function GET(_req: Request, { params }: { params: Promise<{ partnerId: string }> }) {
  try {
    const { partnerId } = await params
    if (!partnerId) {
      return NextResponse.json({ error: "Missing partner id" }, { status: 400, headers: noStore })
    }

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStore })
    }

    const { data: me, error: meErr } = await supabase.from("profiles").select("role, active_role").eq("id", user.id).single()
    if (meErr || !canActAs(me, "agency")) {
      return NextResponse.json({ error: "Agency only" }, { status: 403, headers: noStore })
    }

    // 079: an organization column is not a user id. Reads scope to the caller's memberships.
    const callerOrgIds = await resolveCallerOrgIds(user.id, supabase)

    // The row is fetched at ANY status and the state test is applied in one place, by the
    // shared predicate - see lib/partnership-state.ts. Filtering status in the query made
    // this route a third, private definition of "active" that disagreed with the pool list.
    const { data: partnership, error: pErr } = await supabase
      .from("partnerships")
      .select("id, status, nda_confirmed_at, msa_confirmed_at, contact_name, company_name, partner_email, invitation_sent_at")
      .in("lead_org_id", callerOrgIds)
      .eq("vendor_org_id", partnerId)
      .maybeSingle()

    if (pErr) {
      console.error("[api/agency/pool/partner] partnership load", pErr)
      return NextResponse.json({ error: "Failed to verify partnership" }, { status: 500, headers: noStore })
    }
    // An ACTIVE partnership is what unlocks the partnership tier. A pending, suspended or
    // terminated row is a relationship the vendor has not (or no longer has) agreed to, so it
    // unlocks nothing beyond the public tier - but it is still the calling agency's own row,
    // so it is returned either way and it is what the refusal copy explains.
    const hasActivePartnership = isActivePartnership(partnership)
    const partnershipId = (partnership?.id as string | undefined) ?? null

    const PUBLIC_COLUMNS =
      "id, full_name, company_name, display_name, bio, location, website, agency_type, avatar_url, company_logo_url, business_criteria, is_discoverable"
    const PARTNERSHIP_COLUMNS = "email, meeting_url, rate_info"

    let prof = await supabase
      .from("profiles")
      .select(`${PUBLIC_COLUMNS}, ${PARTNERSHIP_COLUMNS}`)
      .eq("id", partnerId)
      .maybeSingle()

    if (prof.error && isMissingRateInfoColumnError(prof.error)) {
      prof = await supabase
        .from("profiles")
        .select(`${PUBLIC_COLUMNS}, email, meeting_url`)
        .eq("id", partnerId)
        .maybeSingle()
    }

    // The one refusal that is still correct, and the one cell of the matrix where Postgres
    // refuses too. It lands HERE rather than after the tier decision because that is where the
    // database actually enforces it: with no partnership row and is_discoverable false, none of
    // the five profiles policies matches, so the select comes back empty and the route never
    // gets to read is_discoverable at all. Never a blank wall - it says what it is and what
    // would open it.
    if (prof.error || !prof.data) {
      if (!hasActivePartnership) {
        return NextResponse.json(
          {
            error: "This vendor's profile is private",
            reason: partnership
              ? `They have not listed themselves in the marketplace, and your partnership is ${partnership.status}.`
              : "They have not listed themselves in the marketplace, and you have no partnership with them.",
            unlock: partnership
              ? "Their profile opens when they accept your invitation."
              : "Invite them to your vendor network. Once they accept, their full profile opens to you.",
          },
          { status: 403, headers: noStore }
        )
      }
      console.error("[api/agency/pool/partner] profile load", prof.error)
      return NextResponse.json({ error: "Vendor profile not found" }, { status: 404, headers: noStore })
    }

    const row = prof.data as {
      id: string
      full_name: string | null
      company_name: string | null
      display_name: string | null
      email: string | null
      bio: string | null
      location: string | null
      website: string | null
      agency_type: string | null
      avatar_url: string | null
      company_logo_url?: string | null
      meeting_url: string | null
      rate_info?: unknown
      business_criteria?: unknown
      is_discoverable: boolean | null
    }

    const tier: "partnership" | "public" | "none" = hasActivePartnership
      ? "partnership"
      : row.is_discoverable
        ? "public"
        : "none"

    const access =
      tier === "partnership"
        ? { tier, reason: "You have an active partnership with this vendor.", unlock: null as string | null }
        : tier === "public"
          ? {
              tier,
              reason: partnership
                ? `This vendor's public marketplace profile. Your partnership is ${partnership.status}, so contact details, rates, documents and delivery history stay closed.`
                : "This vendor's public marketplace profile. You have no partnership with them, so contact details, rates, documents and delivery history stay closed.",
              unlock: partnership
                ? "They open when the vendor accepts your invitation."
                : "Invite them to your vendor network. They open when the vendor accepts.",
            }
          : {
              tier,
              reason: `This vendor has not listed themselves in the marketplace, and your partnership is ${partnership?.status ?? "not active"}, so only your own record of them is shown.`,
              unlock: "Their profile opens when they accept your invitation.",
            }

    // Rate info can be embedded in the bio, so the bio is always parsed - but the parsed rate
    // card is only returned at the partnership tier. A partnership-scoped rate is meaningless
    // without a partnership, and the legacy (unscoped) fallback is exactly the cross-agency
    // leak resolveRateInfoForPartnership exists to prevent.
    const parsedProfile = resolveRateInfoForPartnership({ bio: row.bio, rate_info: row.rate_info }, partnershipId ?? "")
    const bio_display = parsedProfile.bio_display
    const rate_info = hasActivePartnership ? parsedProfile.rate_info : null

    // Delivery history is a partnership-tier field, so below that tier it is not fetched at
    // all rather than fetched and discarded.
    const { data: respRows, error: respErr } = hasActivePartnership
      ? await supabase
          .from("partner_rfp_responses")
          .select("id, status, budget_proposal, partner_rfp_inbox(scope_item_name, project_id, master_rfp_json)")
          .in("lead_org_id", callerOrgIds)
          .eq("vendor_org_id", partnerId)
          .eq("status", "awarded")
          .order("updated_at", { ascending: false })
      : { data: [] as unknown[], error: null }

    if (respErr) {
      console.error("[api/agency/pool/partner] engagement responses", respErr)
      return NextResponse.json({ error: "Failed to load engagement history" }, { status: 500, headers: noStore })
    }

    const projectIds = new Set<string>()
    for (const r of respRows || []) {
      const inbox = unwrapInbox((r as { partner_rfp_inbox?: unknown }).partner_rfp_inbox)
      if (inbox?.project_id) projectIds.add(inbox.project_id)
    }

    // `projects` has `name` and no `title`. Selecting `title` returned 42703 for the whole
    // query, and the old fallback could not fire because it required "name" to appear in an
    // error message that reads "column projects.title does not exist" - so projectMeta was
    // always empty and every engagement silently fell back to the RFP payload's projectName.
    const projectMeta = new Map<string, { name: string | null }>()
    if (projectIds.size > 0) {
      const projs = await supabase
        .from("projects")
        .select("id, name")
        .in("org_id", callerOrgIds)
        .in("id", [...projectIds])

      if (projs.error) {
        console.error("[api/agency/pool/partner] projects batch", projs.error)
      } else {
        for (const p of projs.data || []) {
          const row = p as { id: string; name?: string | null }
          projectMeta.set(String(row.id), { name: row.name ?? null })
        }
      }
    }

    const engagement_history = buildEngagementHistory(respRows as unknown[] | null, projectMeta)

    // Tiering happens HERE, server-side. A field the caller is not entitled to is never put
    // on the wire for a component to hide - row level security hands this route the whole
    // profile row (see docs/invitation-diagnosis.md 0.9), so this is the only place the
    // decision can be enforced.
    const isPublicOnly = tier !== "partnership"
    const showsProfile = tier !== "none"

    return NextResponse.json(
      {
        access,
        // The agency's own partnership row. Never another agency's - this query is keyed to
        // lead_org_id = the caller. NDA and MSA confirmations are documents, so they are held
        // back until the partnership is active.
        partnership: partnership
          ? {
              id: partnershipId,
              status: partnership.status as string,
              nda_confirmed_at: hasActivePartnership ? ((partnership.nda_confirmed_at as string | null) ?? null) : null,
              msa_confirmed_at: hasActivePartnership ? ((partnership.msa_confirmed_at as string | null) ?? null) : null,
              invitation_sent_at: (partnership.invitation_sent_at as string | null) ?? null,
            }
          : null,
        partner: {
          id: row.id,
          // Public tier: name, location, disciplines, bio, designations. Website is public
          // here because /api/marketplace/discoverable already returns it to any
          // authenticated caller for the same discoverable profile.
          // At the "none" tier nothing from the vendor's profile is sent, but the agency's
          // own record of the contact is theirs already - it is what they typed into the pool
          // or imported - so the page has a name to show instead of a blank wall.
          full_name: showsProfile ? row.full_name : ((partnership?.contact_name as string | null) ?? null),
          company_name: showsProfile ? row.company_name : ((partnership?.company_name as string | null) ?? null),
          display_name: showsProfile ? row.display_name : null,
          bio: showsProfile ? bio_display : "",
          location: showsProfile ? row.location : null,
          website: showsProfile ? row.website : null,
          agency_type: showsProfile ? row.agency_type : null,
          avatar_url: showsProfile ? row.avatar_url : null,
          company_logo_url: showsProfile ? (row.company_logo_url ?? null) : null,
          business_criteria: showsProfile ? (row.business_criteria ?? null) : null,
          tags: [] as string[],
          // Partnership tier: contact information and rates. Masked exactly the way
          // /api/marketplace/discoverable masks email - nulled on the server, not omitted,
          // so the shape of the response never itself signals what is being withheld.
          email: hasActivePartnership
            ? row.email
            : // Not the vendor's profile email - the address this agency itself recorded when
              // they added or invited the contact. Already shown to them in the pool list.
              ((partnership?.partner_email as string | null) ?? null),
          meeting_url: isPublicOnly ? null : row.meeting_url,
          rate_info,
        },
        // Delivery history with THIS agency only - the query is .in("lead_org_id", callerOrgIds),
        // so another agency's awards can never appear here. Empty below the partnership tier.
        engagement_history,
      },
      { headers: revalidateHeaders }
    )
  } catch (e) {
    console.error("[api/agency/pool/partner] unexpected", e)
    return NextResponse.json({ error: "Internal error" }, { status: 500, headers: noStore })
  }
}
