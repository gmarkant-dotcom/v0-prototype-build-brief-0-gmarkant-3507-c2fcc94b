import { resolveCallerOrgIds } from "@/lib/entitlements"
import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { isActivePartnership } from "@/lib/partnership-state"
import { canActAs } from "@/lib/acting-role"
import { buildEngagementHistory, unwrapInbox } from "@/lib/engagement-history"

// The reciprocal of app/api/agency/pool/[partnerId]/route.ts. That route tiers what a lead
// agency may see of a vendor; this one tiers what a vendor may see of a lead agency. It is a
// mirror of that file on purpose - same tier names, same "null, do not omit" masking, same
// server-side decision - rather than a second, differently-shaped visibility mechanism.
//
// Before this route existed the vendor's view of a lead agency was the six columns
// GET /api/partnerships attaches to each partnership row (id, email, full_name, company_name,
// company_logo_url, capabilities), identical whether the partnership was active or pending.

export const dynamic = "force-dynamic"

const noStore = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
} as const

const revalidateHeaders = {
  "Cache-Control": "private, max-age=0, stale-while-revalidate=30",
} as const

export async function GET(_req: Request, { params }: { params: Promise<{ agencyId: string }> }) {
  try {
    const { agencyId } = await params
    if (!agencyId) {
      return NextResponse.json({ error: "Missing agency id" }, { status: 400, headers: noStore })
    }

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStore })
    }

    // 079: an organization column is not a user id. Reads scope to the caller's memberships.
    const callerOrgIds = await resolveCallerOrgIds(user.id, supabase)

    const { data: me, error: meErr } = await supabase
      .from("profiles")
      .select("role, active_role")
      .eq("id", user.id)
      .single()
    if (meErr || !canActAs(me, "partner")) {
      return NextResponse.json({ error: "Vendor only" }, { status: 403, headers: noStore })
    }

    // ------------------------------------------------------------------------------
    // PHASE 3: WHICH ID IS THIS?
    //
    // This route is opened from two places and they pass two different kinds of id:
    //
    //   * the My Agencies / Invitations tabs pass partnership.lead_org.id, an
    //     ORGANIZATIONS id (GET /api/partnerships resolves it from `organizations`);
    //   * the Discover tab passes a row from /api/marketplace/discoverable, which is a
    //     PROFILES id.
    //
    // Everything below used the incoming value as both at once - `.eq("lead_org_id", id)`
    // against partnerships, which wants the organization, and `.eq("id", id)` against
    // profiles, which wants the person. For the sixteen accounts 079 backfilled those are
    // the same uuid, so both worked. For an agency created since, exactly one of them works
    // per entry point: a vendor with an ACTIVE partnership opening a lead agency from My
    // Agencies got "This agency's profile is private", because the profiles lookup by an
    // organization id matched nothing and the empty-select refusal fired.
    //
    // Resolved once, here, into the pair the rest of the handler needs. Step 2 is a REVERSE
    // lookup and grants nothing: `organizations` returns a row only where a SELECT policy
    // already admits it, which post-079 means the caller's own organizations or a
    // counterparty of one. It can only find an organization this vendor could already read.
    const byOrgId = await supabase
      .from("organizations")
      .select("id, primary_contact_user_id")
      .eq("id", agencyId)
      .maybeSingle()

    let leadOrgId: string | null = (byOrgId.data?.id as string | null) ?? null
    let agencyProfileId: string | null = (byOrgId.data?.primary_contact_user_id as string | null) ?? null

    if (!leadOrgId) {
      const byContact = await supabase
        .from("organizations")
        .select("id, primary_contact_user_id")
        .eq("primary_contact_user_id", agencyId)
        .maybeSingle()
      leadOrgId = (byContact.data?.id as string | null) ?? null
      agencyProfileId = (byContact.data?.primary_contact_user_id as string | null) ?? null
    }

    // Neither lookup resolved: no readable organization. The id is then taken at face value
    // as a profiles id, which is the marketplace path - a discoverable agency the vendor has
    // no relationship with. That profile is readable through the untouched "Authenticated
    // users can read discoverable profiles" policy and nothing else, so the public tier is
    // both what they get and all they can get.
    if (!agencyProfileId) agencyProfileId = agencyId

    // Fetched at ANY status, with the state test applied once by the shared predicate - see
    // lib/partnership-state.ts. Keyed to vendor_org_id = the caller, so this can only ever be the
    // vendor's own side of the relationship.
    //
    // An unclaimed row (vendor_org_id IS NULL, matched only by partner_email) deliberately does
    // not count. Row level security agrees: "Partners read lead agency profiles for their
    // partnerships" requires p.vendor_org_id = auth.uid(), so an unclaimed row grants no read
    // either. GET /api/partnerships auto-claims those on the vendor's next load.
    const { data: partnership, error: pErr } = await supabase
      .from("partnerships")
      .select("id, status, nda_confirmed_at, msa_confirmed_at, accepted_at, invitation_sent_at, created_at")
      .in("vendor_org_id", callerOrgIds)
      // The ORGANIZATION, not whatever the caller passed. Falls back to the raw value so a
      // legacy id keeps resolving exactly as it did.
      .eq("lead_org_id", leadOrgId ?? agencyId)
      .maybeSingle()

    if (pErr) {
      console.error("[api/partner/network/agency] partnership load", pErr)
      return NextResponse.json({ error: "Failed to verify partnership" }, { status: 500, headers: noStore })
    }

    const hasActivePartnership = isActivePartnership(partnership)
    const partnershipId = (partnership?.id as string | undefined) ?? null

    // Public identity. company_website rather than website: the agency profile editor
    // (app/agency/settings/profile/page.tsx) writes company_website, and
    // /api/marketplace/discoverable already returns it to any authenticated caller.
    const PUBLIC_COLUMNS =
      "id, full_name, company_name, display_name, bio, location, company_website, company_linkedin_url, agency_type, avatar_url, company_logo_url, business_criteria, capabilities, work_examples, reel_url, is_discoverable"
    // Contact information and the commercial terms of the relationship.
    const PARTNERSHIP_COLUMNS = "email, meeting_url, payment_terms, payment_terms_custom"

    // The PERSON, not the company. Every column in both tiers - bio, location,
    // company_website, business_criteria, capabilities, work_examples, payment_terms - lives
    // on profiles; 079 gives organizations a name and a designated contact and nothing else.
    // So the organization is the identity and the contact's profile is where the content is,
    // which is the same two-hop shape lib/org-contact.ts uses at every other org-to-org read.
    const prof = await supabase
      .from("profiles")
      .select(`${PUBLIC_COLUMNS}, ${PARTNERSHIP_COLUMNS}`)
      .eq("id", agencyProfileId)
      .maybeSingle()

    // The refusal sits on the EMPTY-SELECT path, not after the tier decision, for the same
    // reason it does in the agency-to-vendor route: with no claimed partnership row and
    // is_discoverable false, none of the five profiles SELECT policies matches, the select
    // comes back empty, and the route never gets to read is_discoverable at all. Putting the
    // refusal after the tier decision leaves this cell falling through to a bare 404.
    if (prof.error || !prof.data) {
      if (!hasActivePartnership) {
        return NextResponse.json(
          {
            error: "This agency's profile is private",
            reason: partnership
              ? `They have not listed themselves in the marketplace, and your partnership is ${partnership.status}.`
              : "They have not listed themselves in the marketplace, and you have no partnership with them.",
            unlock: partnership
              ? "Their profile opens when the partnership becomes active."
              : "Request collaboration access. Once the partnership is active, their full profile opens to you.",
          },
          { status: 403, headers: noStore }
        )
      }
      console.error("[api/partner/network/agency] profile load", prof.error)
      return NextResponse.json({ error: "Agency profile not found" }, { status: 404, headers: noStore })
    }

    const row = prof.data as unknown as {
      id: string
      full_name: string | null
      company_name: string | null
      display_name: string | null
      email: string | null
      bio: string | null
      location: string | null
      company_website: string | null
      company_linkedin_url: string | null
      agency_type: string | null
      avatar_url: string | null
      company_logo_url: string | null
      business_criteria: unknown
      capabilities: unknown
      work_examples: unknown
      reel_url: string | null
      meeting_url: string | null
      payment_terms: string | null
      payment_terms_custom: string | null
      is_discoverable: boolean | null
    }

    // Only two tiers, where the agency-to-vendor route has three. There is no "none" tier here
    // because it would have nothing to show: the agency-side "none" tier falls back to the
    // agency's OWN typed record of the contact (partnerships.contact_name / company_name /
    // partner_email), and those columns describe the vendor, not the agency. A vendor never
    // types anything about a lead agency, so below the public tier there is no honest
    // fallback and the refusal above is the whole answer.
    const tier: "partnership" | "public" = hasActivePartnership ? "partnership" : "public"

    const access =
      tier === "partnership"
        ? {
            tier,
            reason: "You have an active partnership with this agency.",
            unlock: null as string | null,
          }
        : {
            tier,
            reason: partnership
              ? `This agency's public profile. Your partnership is ${partnership.status}, so contact details, payment terms, compliance status and your shared work stay closed.`
              : "This agency's public profile. You have no partnership with them, so contact details, payment terms, compliance status and your shared work stay closed.",
            unlock: partnership
              ? "They open when the partnership becomes active."
              : "Request collaboration access. They open once the partnership is active.",
          }

    // Shared work, half one: awarded bids. Keyed to vendor_org_id = the caller AND
    // lead_org_id = this agency, so no other vendor's bid and no other agency's award can
    // appear. Not fetched at all below the partnership tier.
    const { data: respRows, error: respErr } = hasActivePartnership
      ? await supabase
          .from("partner_rfp_responses")
          .select("id, status, budget_proposal, partner_rfp_inbox(scope_item_name, project_id, master_rfp_json)")
          .in("vendor_org_id", callerOrgIds)
          .eq("lead_org_id", leadOrgId ?? agencyId)
          .eq("status", "awarded")
          .order("updated_at", { ascending: false })
      : { data: [] as unknown[], error: null }

    if (respErr) {
      console.error("[api/partner/network/agency] engagement responses", respErr)
      return NextResponse.json({ error: "Failed to load engagement history" }, { status: 500, headers: noStore })
    }

    const projectIds = new Set<string>()
    for (const r of respRows || []) {
      const inbox = unwrapInbox((r as { partner_rfp_inbox?: unknown }).partner_rfp_inbox)
      if (inbox?.project_id) projectIds.add(inbox.project_id)
    }

    // Shared work, half two: projects of this agency the vendor is actually assigned to. The
    // projects_partner_select_assigned policy already restricts this to assignments the caller
    // holds; .eq("lead_org_id", agencyId) narrows it to this one agency. The agency's other
    // projects are unreachable both ways.
    const shared_projects: { id: string; name: string; status: string | null; updated_at: string | null }[] = []
    const projectMeta = new Map<string, { name: string | null }>()
    if (hasActivePartnership) {
      const projs = await supabase
        .from("projects")
        .select("id, name, status, updated_at")
        .eq("org_id", leadOrgId ?? agencyId)
        .order("updated_at", { ascending: false })

      if (projs.error) {
        console.error("[api/partner/network/agency] projects batch", projs.error)
      } else {
        for (const p of projs.data || []) {
          const pr = p as { id: string; name?: string | null; status?: string | null; updated_at?: string | null }
          projectMeta.set(String(pr.id), { name: pr.name ?? null })
          shared_projects.push({
            id: String(pr.id),
            name: (pr.name || "").trim() || "Untitled project",
            status: pr.status ?? null,
            updated_at: pr.updated_at ?? null,
          })
        }
      }
    }

    const engagement_history = buildEngagementHistory(respRows as unknown[] | null, projectMeta)

    // Tiering happens HERE, server-side, for the same reason as the mirrored route: row level
    // security hands this route the whole profile row, so this is the only place the decision
    // can be enforced. Fields are nulled rather than omitted, so the shape of the response
    // never itself signals what is being withheld.
    const isPublicOnly = tier !== "partnership"

    return NextResponse.json(
      {
        access,
        // The vendor's own partnership row, and only theirs - the query is keyed to
        // vendor_org_id = the caller. This is the compliance state of THIS relationship. NDA and
        // MSA confirmations are documents, so they are held back until the partnership is
        // active, matching the agency-to-vendor route exactly.
        partnership: partnership
          ? {
              id: partnershipId,
              status: partnership.status as string,
              nda_confirmed_at: hasActivePartnership ? ((partnership.nda_confirmed_at as string | null) ?? null) : null,
              msa_confirmed_at: hasActivePartnership ? ((partnership.msa_confirmed_at as string | null) ?? null) : null,
              accepted_at: (partnership.accepted_at as string | null) ?? null,
              invitation_sent_at: (partnership.invitation_sent_at as string | null) ?? null,
            }
          : null,
        agency: {
          id: row.id,
          // Public tier: identity. Same reasoning as the mirrored route's public tier, and
          // the same fields /api/marketplace/discoverable already hands to any authenticated
          // caller for a discoverable profile.
          full_name: row.full_name,
          company_name: row.company_name,
          display_name: row.display_name,
          bio: row.bio,
          location: row.location,
          company_website: row.company_website,
          company_linkedin_url: row.company_linkedin_url,
          agency_type: row.agency_type,
          avatar_url: row.avatar_url,
          company_logo_url: row.company_logo_url,
          business_criteria: row.business_criteria ?? null,
          capabilities: row.capabilities ?? null,
          work_examples: row.work_examples ?? null,
          reel_url: row.reel_url,
          // Partnership tier: contact information and the commercial terms this agency
          // operates on. Nulled, not omitted.
          email: isPublicOnly ? null : row.email,
          meeting_url: isPublicOnly ? null : row.meeting_url,
          payment_terms: isPublicOnly ? null : row.payment_terms,
          payment_terms_custom: isPublicOnly ? null : row.payment_terms_custom,
        },
        // Both halves of "our shared work". Empty below the partnership tier.
        shared_projects,
        engagement_history,
      },
      { headers: revalidateHeaders }
    )
  } catch (e) {
    console.error("[api/partner/network/agency] unexpected", e)
    return NextResponse.json({ error: "Internal error" }, { status: 500, headers: noStore })
  }
}
