import { NextResponse, type NextRequest } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import { revokeGoogleToken } from "@/lib/google-email"
import { decrypt } from "@/lib/token-encryption"

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
  return { ok: true as const, userId: user.id }
}

// GET - list the user's connections. Never selects token columns or scan_results (that
// stays behind GET /api/agency/email-scan, keeping payload size/concerns separate).
export async function GET() {
  const route = "/api/agency/email-connections"
  const auth = await requireAgency()
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const supabase = await createClient()
  const { data: connections, error } = await supabase
    .from("email_connections")
    .select("provider, status, connected_at, last_scan_at, scan_status")
    .eq("user_id", auth.userId)
  if (error) {
    console.error("[api] failure", { route, method: "GET", message: error.message })
    return NextResponse.json({ error: "Failed to load connections" }, { status: 500 })
  }

  return NextResponse.json({ connections: connections || [] })
}

// DELETE { provider } - revokes (best-effort) and clears tokens/scan_results locally.
export async function DELETE(request: NextRequest) {
  const route = "/api/agency/email-connections"
  const auth = await requireAgency()
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await request.json().catch(() => ({}))
  const provider = String(body.provider || "")
  if (!provider) {
    return NextResponse.json({ error: "provider is required" }, { status: 400 })
  }

  const service = getServiceSupabase()
  if (!service) {
    return NextResponse.json({ error: "Missing Supabase service configuration" }, { status: 500 })
  }

  const { data: connection, error: loadErr } = await service
    .from("email_connections")
    .select("id, access_token_encrypted")
    .eq("user_id", auth.userId)
    .eq("provider", provider)
    .maybeSingle()
  if (loadErr) {
    console.error("[api] failure", { route, method: "DELETE", message: loadErr.message })
    return NextResponse.json({ error: "Failed to load connection" }, { status: 500 })
  }
  if (!connection) {
    return NextResponse.json({ error: "No connection found for this provider" }, { status: 404 })
  }

  // Revoke is provider-specific and best-effort - a locally-revoked connection with a
  // still-technically-valid remote token is far less bad than a stuck "can't disconnect"
  // state, so a revoke failure never blocks the local cleanup below. Providers with no
  // revoke function yet (e.g. a future 'microsoft' row, Phase 2) simply skip this step -
  // the schema already accommodates them via the provider CHECK constraint.
  if (provider === "google" && connection.access_token_encrypted) {
    try {
      const accessToken = decrypt(connection.access_token_encrypted)
      const revoked = await revokeGoogleToken(accessToken)
      if (!revoked) {
        console.error("[api] google token revoke returned false", { route, connectionId: connection.id })
      }
    } catch (revokeErr) {
      console.error("[api] google token revoke failed", {
        route,
        connectionId: connection.id,
        message: revokeErr instanceof Error ? revokeErr.message : String(revokeErr),
      })
    }
  }

  const { error: updateErr } = await service
    .from("email_connections")
    .update({
      status: "revoked",
      access_token_encrypted: null,
      refresh_token_encrypted: null,
      scan_results: null,
      scan_status: "idle",
      scan_run_token: null,
    })
    .eq("id", connection.id)
  if (updateErr) {
    console.error("[api] failure", { route, method: "DELETE", message: updateErr.message })
    return NextResponse.json({ error: "Failed to revoke connection" }, { status: 500 })
  }

  console.log("[api] success", { route, method: "DELETE", userId: auth.userId, provider })
  return NextResponse.json({ status: "revoked" })
}
