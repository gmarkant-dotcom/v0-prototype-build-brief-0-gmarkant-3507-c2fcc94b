import { NextResponse, type NextRequest } from "next/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import { requireAgencyRole } from "@/lib/api-auth"
import { importPartnerRows } from "@/lib/server/partner-pool-import"
import { resolveCallerWriteOrgId } from "@/lib/entitlements"

export const dynamic = "force-dynamic"
export const maxDuration = 60

const MAX_ROWS = 2000

function getServiceSupabase() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null
  return createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
}

/**
 * Batch partner import from a spreadsheet the browser already parsed and column-mapped -
 * the raw file itself never reaches the server, only the mapped row objects. No AI calls
 * here, so this must never count against ai_analyses usage limits (unlike the email scan).
 */
export async function POST(request: NextRequest) {
  const auth = await requireAgencyRole()
  if (!auth.authorized) return auth.response

  const service = getServiceSupabase()
  if (!service) {
    return NextResponse.json({ error: "Missing Supabase service configuration" }, { status: 500 })
  }

  const body = await request.json().catch(() => ({}))
  const rawRows = Array.isArray(body.rows) ? body.rows : []
  const dryRun = body.dryRun === true
  if (rawRows.length === 0) {
    return NextResponse.json({ error: "No rows provided" }, { status: 400 })
  }
  if (rawRows.length > MAX_ROWS) {
    return NextResponse.json({ error: `Too many rows - maximum is ${MAX_ROWS} per import` }, { status: 400 })
  }

  // 079: the pool belongs to the ORGANISATION, so resolve the caller's membership before
  // writing into it. The user id is still passed alongside, for the self-account and
  // same-domain guards, which are questions about a person.
  // 079 PARAMETER CLASS: importPartnerRows() writes this into partnerships.lead_org_id,
  // which REFERENCES organizations(id). agencyEntitlementId() was the wrong resolver - it
  // returns the user id unchanged when membership does not resolve, which is the correct
  // failure for a usage row and a 23503 for a foreign key. Fails closed instead.
  const agencyOrgId = await resolveCallerWriteOrgId(auth.user.id, service)
  if (!agencyOrgId) {
    return NextResponse.json({ error: "Your account is not linked to an organization yet" }, { status: 403 })
  }
  const results = await importPartnerRows(service, agencyOrgId, auth.user.id, rawRows, "spreadsheet", MAX_ROWS, {
    dryRun,
    agencyAuthEmail: auth.user.email,
  })

  const added = results.filter((r) => r.outcome === "added").length
  const duplicates = results.filter((r) => r.outcome === "duplicate").length
  const invalid = results.filter((r) => r.outcome === "invalid").length
  const self = results.filter((r) => r.outcome === "self").length
  const errors = results.filter((r) => r.outcome === "error")

  // Per-email flag map (already_on_ligament / domain_match_flagged / self) - the review UI
  // (dryRun) uses this to badge rows before import; the done screen (!dryRun) doesn't need
  // it today but it's harmless to include either way.
  const flags = Object.fromEntries(
    results.filter((r) => r.flag || r.outcome === "self").map((r) => [r.email, r.flag || "self"])
  )

  return NextResponse.json({
    added,
    duplicates,
    invalid,
    self,
    errors: errors.map((e) => ({ email: e.email, reason: e.reason })),
    flags,
  })
}
