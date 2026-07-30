import { NextResponse, type NextRequest } from "next/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import { requireAgencyRole } from "@/lib/api-auth"
import { importPartnerRows } from "@/lib/server/partner-pool-import"

export const dynamic = "force-dynamic"

function getServiceSupabase() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null
  return createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
}

/**
 * Manual "Add Partner" - single-contact version of the spreadsheet importer's write path
 * (same table, same ghost-row shape), replacing the old client-only version that never
 * persisted anything (see LIGAMENT_CONTEXT.md / session notes on the pool page rebuild).
 */
export async function POST(request: NextRequest) {
  const auth = await requireAgencyRole()
  if (!auth.authorized) return auth.response

  const service = getServiceSupabase()
  if (!service) {
    return NextResponse.json({ error: "Missing Supabase service configuration" }, { status: 500 })
  }

  const body = await request.json().catch(() => ({}))
  const results = await importPartnerRows(service, auth.user.id, [body], "manual")
  const result = results[0]

  if (!result || result.outcome === "invalid") {
    return NextResponse.json({ error: result?.reason || "Invalid contact" }, { status: 400 })
  }
  if (result.outcome === "error") {
    return NextResponse.json({ error: result.reason || "Failed to add partner" }, { status: 500 })
  }
  if (result.outcome === "duplicate") {
    return NextResponse.json({ error: "This email is already in your pool" }, { status: 409 })
  }

  return NextResponse.json({ added: true })
}
