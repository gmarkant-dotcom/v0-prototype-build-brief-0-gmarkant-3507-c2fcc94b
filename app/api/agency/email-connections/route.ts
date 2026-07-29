import { NextResponse, type NextRequest } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import { revokeGoogleToken } from "@/lib/google-email"
import { revokeMicrosoftToken } from "@/lib/microsoft-email"
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

// GET - list the user's connections. Token columns are selected only to verify they can
// still be decrypted (e.g. after a TOKEN_ENCRYPTION_KEY rotation); they are never included
// in the response - that stays behind GET /api/agency/email-scan.
export async function GET() {
  const route = "/api/agency/email-connections"
  const auth = await requireAgency()
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const supabase = await createClient()
  const { data: connections, error } = await supabase
    .from("email_connections")
    .select("id, provider, status, connected_at, last_scan_at, scan_status, access_token_encrypted")
    .eq("user_id", auth.userId)
  if (error) {
    console.error("[api] failure", { route, method: "GET", message: error.message })
    return NextResponse.json({ error: "Failed to load connections" }, { status: 500 })
  }

  const service = getServiceSupabase()
  const result = []
  for (const connection of connections || []) {
    let status = connection.status

    // A connection can have a token that no longer decrypts if TOKEN_ENCRYPTION_KEY was
    // rotated after it was stored. Detect that here rather than letting a later scan
    // crash, and flip the connection to 'expired' so the UI can prompt a reconnect.
    if (status === "active" && connection.access_token_encrypted) {
      try {
        decrypt(connection.access_token_encrypted)
      } catch {
        status = "expired"
        if (service) {
          const { error: expireErr } = await service
            .from("email_connections")
            .update({
              status: "expired",
              access_token_encrypted: null,
              refresh_token_encrypted: null,
            })
            .eq("id", connection.id)
          if (expireErr) {
            console.error("[api] failed to mark connection expired", {
              route,
              connectionId: connection.id,
              message: expireErr.message,
            })
          }
        }
      }
    }

    result.push({
      provider: connection.provider,
      status,
      connected_at: connection.connected_at,
      last_scan_at: connection.last_scan_at,
      scan_status: connection.scan_status,
    })
  }

  return NextResponse.json({ connections: result })
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
  // state, so a revoke failure never blocks the local cleanup below.
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
  } else if (provider === "microsoft") {
    // No remote revoke call exists for Microsoft - see revokeMicrosoftToken's comment.
    // Local token cleanup below is all that happens here.
    await revokeMicrosoftToken()
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
