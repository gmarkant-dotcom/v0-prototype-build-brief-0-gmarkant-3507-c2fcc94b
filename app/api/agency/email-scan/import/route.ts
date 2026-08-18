import { NextResponse, type NextRequest } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createClient as createServiceClient, type SupabaseClient } from "@supabase/supabase-js"
import { evaluateImportGuard, resolveAgencyOwnDomains } from "@/lib/server/partner-import-guard"

export const dynamic = "force-dynamic"

function getServiceSupabase() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null
  return createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
}

async function requireAgency() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false as const, status: 401, error: "Unauthorized" }
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, active_role")
    .eq("id", user.id)
    .maybeSingle()
  if (profile?.role !== "agency" && profile?.active_role !== "agency") {
    return { ok: false as const, status: 403, error: "Agency only" }
  }
  return { ok: true as const, userId: user.id, userEmail: user.email }
}

type ImportOutcome = "added" | "skipped" | "self"

/**
 * Adds one contact to the agency's pool as a Discovered row - check by vendor_org_id then
 * partner_email before inserting, enrich an existing-but-unclaimed row instead of
 * duplicating it.
 *
 * CONSENT RULE: an exact profiles email match never activates a partnership on its own -
 * it only links the matched profile id into partnership_notes (pool_flag
 * "already_on_ligament") so /agency/pool can badge it. Activation happens only through the
 * existing invite -> accept flow. If the matched profile is the agency's own account, the
 * contact is skipped entirely (self-partnership must be impossible) - see
 * lib/server/partner-import-guard.ts, shared with the spreadsheet/manual import path.
 *
 * Deliberately does NOT trust the client's has_ligament_account/profile_id - those are
 * re-derived here from a fresh profiles lookup by email. A client could otherwise pass an
 * arbitrary profile_id to bind someone else's account to this agency without their
 * involvement.
 */
async function importContact(
  service: SupabaseClient,
  agencyId: string,
  agencyOwnDomains: string[],
  email: string,
  name: string | null
): Promise<ImportOutcome> {
  const { data: matchedProfile } = await service.from("profiles").select("id").ilike("email", email).maybeSingle()
  const matchedProfileId = (matchedProfile?.id as string | undefined) || null

  const guard = evaluateImportGuard({ agencyId, agencyOwnDomains, matchedProfileId, contactEmail: email })
  if (guard === "self_account") return "self"
  const poolFlag = guard === "same_domain_flag" ? "domain_match_flagged" : matchedProfileId ? "already_on_ligament" : null

  const byId = matchedProfileId
    ? await service
        .from("partnerships")
        .select("id, vendor_org_id, status, partnership_notes")
        .eq("lead_org_id", agencyId)
        .eq("vendor_org_id", matchedProfileId)
        .limit(1)
        .maybeSingle()
    : { data: null }
  let existing = byId.data as
    | { id: string; vendor_org_id: string | null; status: string | null; partnership_notes: Record<string, unknown> | null }
    | null

  if (!existing) {
    const byEmail = await service
      .from("partnerships")
      .select("id, vendor_org_id, status, partnership_notes")
      .eq("lead_org_id", agencyId)
      .ilike("partner_email", email)
      .limit(1)
      .maybeSingle()
    existing = byEmail.data as typeof existing
  }

  const mergedNotes = (): Record<string, unknown> | null => {
    const base: Record<string, unknown> = { ...(existing?.partnership_notes || {}) }
    if (matchedProfileId) base.matched_profile_id = matchedProfileId
    if (poolFlag) base.pool_flag = poolFlag
    return Object.keys(base).length > 0 ? base : null
  }

  if (existing) {
    if (existing.status === "active") return "skipped"
    // Existing Discovered/pending ghost row - link the matched profile id (if any) and
    // flag, but never touch status/profile_status/vendor_org_id here.
    if (matchedProfileId || poolFlag) {
      const { error } = await service
        .from("partnerships")
        .update({ partnership_notes: mergedNotes(), updated_at: new Date().toISOString() })
        .eq("id", existing.id)
      if (error) throw error
    }
    return "added"
  }

  const { error } = await service.from("partnerships").insert({
    lead_org_id: agencyId,
    vendor_org_id: null,
    partner_email: email,
    profile_status: "unclaimed",
    status: "pending",
    contact_name: name,
    partnership_notes: mergedNotes(),
  })
  if (error) throw error
  return "added"
}

export async function POST(request: NextRequest) {
  const route = "/api/agency/email-scan/import"
  const auth = await requireAgency()
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const service = getServiceSupabase()
  if (!service) {
    return NextResponse.json({ error: "Missing Supabase service configuration" }, { status: 500 })
  }

  const body = await request.json().catch(() => ({}))
  const rawContacts = Array.isArray(body.contacts) ? body.contacts : []
  const nameByEmail = new Map<string, string | null>()
  for (const c of rawContacts as { email?: unknown; name?: unknown }[]) {
    const email = String(c?.email || "").trim().toLowerCase()
    if (!email || nameByEmail.has(email)) continue
    const name = typeof c?.name === "string" ? c.name.trim() : ""
    nameByEmail.set(email, name || null)
  }
  const emails = Array.from(
    new Set(
      rawContacts
        .map((c: { email?: unknown }) => String(c?.email || "").trim().toLowerCase())
        .filter((email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    )
  ) as string[]

  if (emails.length === 0) {
    return NextResponse.json({ error: "No valid contacts provided" }, { status: 400 })
  }

  const agencyOwnDomains = await resolveAgencyOwnDomains(service, auth.userId, auth.userEmail)

  let added = 0
  let skipped = 0
  let self = 0
  let errors = 0

  for (const email of emails) {
    try {
      const result = await importContact(service, auth.userId, agencyOwnDomains, email, nameByEmail.get(email) ?? null)
      if (result === "added") added += 1
      else if (result === "self") self += 1
      else skipped += 1
    } catch (err) {
      errors += 1
      console.error("[api] failure", {
        route,
        method: "POST",
        email,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  console.log("[api] success", { route, method: "POST", userId: auth.userId, added, skipped, self, errors })
  return NextResponse.json({ added, skipped, self, errors })
}
