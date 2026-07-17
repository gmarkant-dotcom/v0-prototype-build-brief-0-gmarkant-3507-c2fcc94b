import { NextResponse, type NextRequest } from "next/server"
import { randomUUID } from "crypto"
import { createClient } from "@/lib/supabase/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import { refreshGoogleToken } from "@/lib/google-email"
import { encrypt, decrypt } from "@/lib/token-encryption"

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

export async function POST(request: NextRequest) {
  const route = "/api/agency/email-scan"
  try {
    const auth = await requireAgency()
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const body = await request.json().catch(() => ({}))
    const provider = String(body.provider || "")
    if (provider !== "google") {
      return NextResponse.json({ error: "Unsupported provider" }, { status: 400 })
    }

    const service = getServiceSupabase()
    if (!service) {
      return NextResponse.json({ error: "Missing Supabase service configuration" }, { status: 500 })
    }

    const { data: connection, error: connErr } = await service
      .from("email_connections")
      .select("*")
      .eq("user_id", auth.userId)
      .eq("provider", "google")
      .maybeSingle()
    if (connErr) {
      console.error("[api] failure", { route, method: "POST", message: connErr.message })
      return NextResponse.json({ error: "Failed to load email connection" }, { status: 500 })
    }
    if (!connection) {
      return NextResponse.json(
        { error: "No email connection found. Connect your Gmail account first." },
        { status: 404 }
      )
    }
    if (connection.status !== "active") {
      return NextResponse.json(
        { error: "This connection is not active. Reconnect your Gmail account." },
        { status: 400 }
      )
    }

    let accessTokenExpiresAt = connection.token_expires_at ? new Date(connection.token_expires_at).getTime() : 0
    if (Number.isNaN(accessTokenExpiresAt)) accessTokenExpiresAt = 0

    if (accessTokenExpiresAt <= Date.now()) {
      if (!connection.refresh_token_encrypted) {
        await service.from("email_connections").update({ status: "expired" }).eq("id", connection.id)
        return NextResponse.json(
          { error: "Your Gmail connection has expired. Please reconnect." },
          { status: 401 }
        )
      }
      try {
        const refreshToken = decrypt(connection.refresh_token_encrypted)
        const refreshed = await refreshGoogleToken(refreshToken)
        const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString()
        const { error: updateErr } = await service
          .from("email_connections")
          .update({ access_token_encrypted: encrypt(refreshed.access_token), token_expires_at: newExpiresAt })
          .eq("id", connection.id)
        if (updateErr) throw updateErr
      } catch (refreshErr) {
        console.error("[api] failure", {
          route,
          method: "POST",
          message: "token refresh failed",
          detail: refreshErr instanceof Error ? refreshErr.message : String(refreshErr),
        })
        await service.from("email_connections").update({ status: "expired" }).eq("id", connection.id)
        return NextResponse.json(
          { error: "Your Gmail connection has expired. Please reconnect." },
          { status: 401 }
        )
      }
    }

    const scanRunToken = randomUUID()
    const { error: scanUpdateErr } = await service
      .from("email_connections")
      .update({ scan_status: "scanning", scan_run_token: scanRunToken })
      .eq("id", connection.id)
    if (scanUpdateErr) {
      console.error("[api] failure", { route, method: "POST", message: scanUpdateErr.message })
      return NextResponse.json({ error: "Failed to start scan" }, { status: 500 })
    }

    console.log("[api] success", { route, method: "POST", userId: auth.userId, connectionId: connection.id })
    return NextResponse.json({ scan_id: connection.id, scan_run_token: scanRunToken, status: "scanning" })
  } catch (error) {
    console.error("[api] failure", {
      route,
      method: "POST",
      message: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: "Failed to start scan" }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  const route = "/api/agency/email-scan"
  try {
    const auth = await requireAgency()
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const provider = request.nextUrl.searchParams.get("provider") || "google"

    const supabase = await createClient()
    const { data: connection, error } = await supabase
      .from("email_connections")
      .select("scan_status, scan_results, last_scan_at")
      .eq("user_id", auth.userId)
      .eq("provider", provider)
      .maybeSingle()
    if (error) {
      console.error("[api] failure", { route, method: "GET", message: error.message })
      return NextResponse.json({ error: "Failed to load scan status" }, { status: 500 })
    }
    if (!connection) {
      return NextResponse.json({ error: "No email connection found" }, { status: 404 })
    }

    return NextResponse.json({
      scan_status: connection.scan_status,
      scan_results: connection.scan_results,
      last_scan_at: connection.last_scan_at,
    })
  } catch (error) {
    console.error("[api] failure", {
      route,
      method: "GET",
      message: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: "Failed to load scan status" }, { status: 500 })
  }
}
