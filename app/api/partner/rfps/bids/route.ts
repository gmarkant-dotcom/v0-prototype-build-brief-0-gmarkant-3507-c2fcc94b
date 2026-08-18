import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import { resolveCallerOrgIds } from "@/lib/entitlements"
import {
  attachMagicTokenToPartnerInbox,
  MAGIC_TOKEN_ATTACH_COLUMNS,
  MAGIC_TOKEN_ATTACH_COLUMNS_NO_DEADLINE,
  type MagicTokenForAttach,
} from "@/lib/magic-token-attach"
import { claimAwardedGhostPartnershipsByEmail } from "@/lib/partnership-award-claim"
import { ORG_CONTACT_SELECT, resolveOrgContact, type OrgEmbed } from "@/lib/org-contact"

function getServiceSupabase() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null
  }
  return createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
}

/** H3: this route's own filter (partner_rfp_responses.vendor_org_id = auth.uid()) never sees a
 *  response whose vendor_org_id is still null - independent of GET /api/partner/rfps's own
 *  sweep, since the two routes are fetched in parallel from app/partner/rfps/page.tsx with no
 *  ordering between them. Backfilling here too makes this route self-sufficient rather than
 *  racing the other one. */
async function backfillGuestResponseLinkage(vendorEmail: string, partnerId: string) {
  const service = getServiceSupabase()
  if (!service || !vendorEmail) return
  try {
    // H4: was selecting a hand-copied column list without response_deadline, so whether a
    // synthesized inbox row carried a deadline depended on which of the two routes won the
    // race to create it (both are fetched in parallel from app/partner/rfps/page.tsx, and the
    // row is only created once). Shared constants + the same 42703 fallback as the sweep.
    let tokens: MagicTokenForAttach[] | null = null
    const first = await service
      .from("rfp_magic_tokens")
      .select(MAGIC_TOKEN_ATTACH_COLUMNS)
      .ilike("vendor_email", vendorEmail)
      .not("response_id", "is", null)
    tokens = first.data as unknown as MagicTokenForAttach[] | null
    let tokensErr: { message: string; code?: string } | null = first.error
    if (tokensErr?.code === "42703") {
      const retry = await service
        .from("rfp_magic_tokens")
        .select(MAGIC_TOKEN_ATTACH_COLUMNS_NO_DEADLINE)
        .ilike("vendor_email", vendorEmail)
        .not("response_id", "is", null)
      tokens = retry.data as unknown as MagicTokenForAttach[] | null
      tokensErr = retry.error
    }
    if (tokensErr) {
      console.error("[partner/rfps/bids] linkage backfill: token lookup failed", { partnerId, message: tokensErr.message })
      return
    }
    for (const tokenRow of tokens || []) {
      const result = await attachMagicTokenToPartnerInbox(service, { tokenRow, partnerId })
      if (!result.attached) {
        console.error("[partner/rfps/bids] linkage backfill: attach failed", {
          partnerId,
          token: tokenRow.token,
          reason: result.reason,
        })
      }
    }
    await claimAwardedGhostPartnershipsByEmail(service, { partnerId, vendorEmail })
  } catch (err) {
    console.error("[partner/rfps/bids] linkage backfill failed", {
      partnerId,
      message: err instanceof Error ? err.message : String(err),
    })
  }
}

/** Never cache this handler - avoids empty JSON stuck behind 304 on Vercel/CDN. */
export const dynamic = "force-dynamic"
export const revalidate = 0

const noStoreHeaders = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
} as const

const revalidateHeaders = {
  "Cache-Control": "private, max-age=0, stale-while-revalidate=30",
} as const

// GET /api/partner/rfps/bids - this partner's submitted bids (My Bids / History tabs on
// app/partner/rfps/page.tsx). Response-centric (partner_rfp_responses), unlike
// GET /api/partner/rfps which is inbox-centric - this always reflects every bid the
// partner has actually submitted, including ones tied to a guest/magic-link inbox row
// that may since have been claimed onto this account.
export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStoreHeaders })
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, active_role, email")
      .eq("id", user.id)
      .single()
    if (profile?.role !== "partner" && profile?.active_role !== "partner") {
      return NextResponse.json({ error: "Vendors only" }, { status: 403, headers: noStoreHeaders })
    }

    const vendorEmail = (profile?.email || user.email || "").trim().toLowerCase()
    await backfillGuestResponseLinkage(vendorEmail, user.id)

    // 079: `.eq("vendor_org_id", user.id)` compares an ORGANISATION column to a USER id.
    // Every organization 079 backfilled has an id equal to its founding user's, so this
    // would keep working for all sixteen live accounts and return NOTHING for the first
    // vendor organization created afterwards - a vendor whose whole portal is silently
    // empty, with no error. Scope by membership.
    const callerOrgIds = await resolveCallerOrgIds(user.id, supabase)
    if (callerOrgIds.length === 0) {
      console.error("[api] caller belongs to no organization", { userId: user.id })
      return NextResponse.json({ error: "No organization found for this account" }, { status: 403, headers: noStoreHeaders })
    }

    // RLS after 079: "Partners select own RFP responses" resolves membership through
    // current_user_org_ids() rather than comparing to auth.uid(). The filter below is the
    // application half of the same question and must be asked the same way.
    const { data: responses, error } = await supabase
      .from("partner_rfp_responses")
      .select("id, inbox_item_id, lead_org_id, status, budget_proposal, submitted_at, updated_at, created_at")
      .in("vendor_org_id", callerOrgIds)
      .order("submitted_at", { ascending: false, nullsFirst: false })

    if (error) {
      console.error("[partner/rfps/bids] partner_rfp_responses select error:", user.id, error.message)
      return NextResponse.json({ error: "Failed to load bids" }, { status: 500, headers: noStoreHeaders })
    }

    const rows = responses || []

    const inboxIds = [...new Set(rows.map((r) => r.inbox_item_id as string | null).filter((id): id is string => Boolean(id)))]
    let scopeByInboxId: Record<string, { scope_item_name: string | null; project_id: string | null }> = {}
    if (inboxIds.length > 0) {
      const { data: inboxRows } = await supabase
        .from("partner_rfp_inbox")
        .select("id, scope_item_name, project_id")
        .in("id", inboxIds)
      scopeByInboxId = Object.fromEntries(
        (inboxRows || []).map((r) => [
          r.id as string,
          { scope_item_name: (r.scope_item_name as string | null) ?? null, project_id: (r.project_id as string | null) ?? null },
        ])
      )
    }

    const projectIds = [...new Set(Object.values(scopeByInboxId).map((s) => s.project_id).filter((id): id is string => Boolean(id)))]
    let clientNameByProjectId: Record<string, string | null> = {}
    if (projectIds.length > 0) {
      const { data: projectRows } = await supabase.from("projects").select("id, client_name").in("id", projectIds)
      clientNameByProjectId = Object.fromEntries((projectRows || []).map((p) => [p.id as string, (p.client_name as string | null) ?? null]))
    }

    // 079-ORG-ID-READ. Was `.from("profiles").in("id", <lead org ids>)`. Neither guard
    // could see it - the column name is already post-079 and there is no embed hint - and
    // it works today only because every backfilled organization id equals its founding
    // user's id. After 079, a lead agency organization created by the PHASE 12 trigger
    // gets gen_random_uuid() and matches no profiles row, so every bid card in the vendor
    // portal loses the agency's name with no error anywhere.
    //
    // agency_company_name is now organizations.name. agency_full_name stays a PERSON's
    // name and comes from the organization's designated primary contact, because there is
    // no organization-level equivalent of a full name and inventing one would be a lie.
    const agencyIds = [...new Set(rows.map((r) => r.lead_org_id as string).filter(Boolean))]
    let agencyById: Record<string, { company_name: string | null; full_name: string | null }> = {}
    if (agencyIds.length > 0) {
      const { data: agencyRows } = await supabase
        .from("organizations")
        .select(ORG_CONTACT_SELECT)
        .in("id", agencyIds)
      agencyById = Object.fromEntries(
        ((agencyRows || []) as { id?: string | null }[]).map((a) => {
          const contact = resolveOrgContact(a as OrgEmbed, null)
          return [a.id as string, { company_name: contact.orgName, full_name: contact.contactFullName }]
        })
      )
    }

    const bids = rows.map((r) => {
      const scope = r.inbox_item_id ? scopeByInboxId[r.inbox_item_id as string] : undefined
      const agency = agencyById[r.lead_org_id as string]
      return {
        id: r.id as string,
        inbox_item_id: (r.inbox_item_id as string | null) ?? null,
        status: r.status as string,
        budget_proposal: (r.budget_proposal as string) || "",
        submitted_at: (r.submitted_at as string | null) ?? null,
        updated_at: (r.updated_at as string | null) ?? (r.created_at as string | null) ?? null,
        scope_item_name: scope?.scope_item_name ?? null,
        client_name: scope?.project_id ? clientNameByProjectId[scope.project_id] ?? null : null,
        agency_company_name: agency?.company_name ?? null,
        agency_full_name: agency?.full_name ?? null,
      }
    })

    return NextResponse.json({ bids }, { headers: revalidateHeaders })
  } catch (e) {
    console.error("[partner/rfps/bids] GET exception:", e)
    return NextResponse.json({ error: "Failed to load bids" }, { status: 500, headers: noStoreHeaders })
  }
}
