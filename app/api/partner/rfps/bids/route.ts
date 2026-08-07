import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import { attachMagicTokenToPartnerInbox, type MagicTokenForAttach } from "@/lib/magic-token-attach"
import { claimAwardedGhostPartnershipsByEmail } from "@/lib/partnership-award-claim"

function getServiceSupabase() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null
  }
  return createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
}

/** H3: this route's own filter (partner_rfp_responses.partner_id = auth.uid()) never sees a
 *  response whose partner_id is still null - independent of GET /api/partner/rfps's own
 *  sweep, since the two routes are fetched in parallel from app/partner/rfps/page.tsx with no
 *  ordering between them. Backfilling here too makes this route self-sufficient rather than
 *  racing the other one. */
async function backfillGuestResponseLinkage(vendorEmail: string, partnerId: string) {
  const service = getServiceSupabase()
  if (!service || !vendorEmail) return
  try {
    const { data: tokens, error: tokensErr } = await service
      .from("rfp_magic_tokens")
      .select(
        "token, agency_id, project_id, vendor_email, scope_item_id, scope_item_name, scope_item_description, business_criteria_required, require_terms_disclosure, expires_at, response_id"
      )
      .ilike("vendor_email", vendorEmail)
      .not("response_id", "is", null)
    if (tokensErr) {
      console.error("[partner/rfps/bids] linkage backfill: token lookup failed", { partnerId, message: tokensErr.message })
      return
    }
    for (const tokenRow of (tokens || []) as unknown as MagicTokenForAttach[]) {
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

    // RLS: "Partners select own RFP responses" - USING (partner_id = auth.uid())
    const { data: responses, error } = await supabase
      .from("partner_rfp_responses")
      .select("id, inbox_item_id, agency_id, status, budget_proposal, submitted_at, updated_at, created_at")
      .eq("partner_id", user.id)
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

    const agencyIds = [...new Set(rows.map((r) => r.agency_id as string).filter(Boolean))]
    let agencyById: Record<string, { company_name: string | null; full_name: string | null }> = {}
    if (agencyIds.length > 0) {
      const { data: agencyRows } = await supabase.from("profiles").select("id, company_name, full_name").in("id", agencyIds)
      agencyById = Object.fromEntries(
        (agencyRows || []).map((a) => [
          a.id as string,
          { company_name: (a.company_name as string | null) ?? null, full_name: (a.full_name as string | null) ?? null },
        ])
      )
    }

    const bids = rows.map((r) => {
      const scope = r.inbox_item_id ? scopeByInboxId[r.inbox_item_id as string] : undefined
      const agency = agencyById[r.agency_id as string]
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
