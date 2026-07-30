import { NextResponse, type NextRequest } from "next/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import { requireAgencyRole } from "@/lib/api-auth"
import { importPartnerRows } from "@/lib/server/partner-pool-import"

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
  if (rawRows.length === 0) {
    return NextResponse.json({ error: "No rows provided" }, { status: 400 })
  }
  if (rawRows.length > MAX_ROWS) {
    return NextResponse.json({ error: `Too many rows - maximum is ${MAX_ROWS} per import` }, { status: 400 })
  }

  const results = await importPartnerRows(service, auth.user.id, rawRows, "spreadsheet", MAX_ROWS)

  const added = results.filter((r) => r.outcome === "added").length
  const duplicates = results.filter((r) => r.outcome === "duplicate").length
  const invalid = results.filter((r) => r.outcome === "invalid").length
  const errors = results.filter((r) => r.outcome === "error")

  return NextResponse.json({
    added,
    duplicates,
    invalid,
    errors: errors.map((e) => ({ email: e.email, reason: e.reason })),
  })
}
