import { NextResponse, type NextRequest } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import {
  createContactAccumulator,
  listGmailMessageIds,
  fetchGmailMessageBatch,
  accumulateContactsFromMessages,
  contactsFromAccumulator,
  refreshGoogleToken,
  MAX_MESSAGES,
} from "@/lib/google-email"
import { encrypt, decrypt } from "@/lib/token-encryption"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 120

// Checkpoint every ~20 messages (not per Gmail search page, which can be up to 100 ids) -
// a Vercel function killed at the maxDuration ceiling must still leave partial results
// behind, and checkpointing only at page boundaries would lose most of an in-progress page.
const CHECKPOINT_CHUNK_SIZE = 20

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
    .select("role, active_role, email")
    .eq("id", user.id)
    .maybeSingle()
  if (profile?.role !== "agency" && profile?.active_role !== "agency") {
    return { ok: false as const, status: 403, error: "Agency only" }
  }
  return { ok: true as const, userId: user.id, userEmail: profile?.email || "" }
}

export async function GET(request: NextRequest) {
  const route = "/api/agency/email-scan/run"
  const auth = await requireAgency()
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const service = getServiceSupabase()
  if (!service) {
    return NextResponse.json({ error: "Missing Supabase service configuration" }, { status: 500 })
  }

  const scanRunToken = request.nextUrl.searchParams.get("token") || ""

  const { data: connection, error: connErr } = await service
    .from("email_connections")
    .select("*")
    .eq("user_id", auth.userId)
    .eq("provider", "google")
    .maybeSingle()
  if (connErr) {
    console.error("[api] failure", { route, method: "GET", message: connErr.message })
    return NextResponse.json({ error: "Failed to load email connection" }, { status: 500 })
  }
  if (!connection || connection.status !== "active") {
    return NextResponse.json({ error: "No active email connection" }, { status: 400 })
  }
  if (
    !scanRunToken ||
    scanRunToken !== connection.scan_run_token ||
    connection.scan_status !== "scanning"
  ) {
    // Either a stale/duplicate call (another /run already claimed this scan) or the scan
    // was never started - either way, do not run a second scan concurrently.
    return NextResponse.json(
      { error: "Scan is not awaiting this run (already running, completed, or never started)" },
      { status: 409 }
    )
  }
  if (!connection.access_token_encrypted) {
    await service.from("email_connections").update({ scan_status: "error", status: "expired" }).eq("id", connection.id)
    return NextResponse.json({ error: "No access token on file. Reconnect your Gmail account." }, { status: 401 })
  }

  let accessToken: string
  try {
    accessToken = decrypt(connection.access_token_encrypted)
  } catch (decryptErr) {
    console.error("[api] failure", {
      route,
      method: "GET",
      message: "token decrypt failed",
      detail: decryptErr instanceof Error ? decryptErr.message : String(decryptErr),
    })
    await service.from("email_connections").update({ scan_status: "error" }).eq("id", connection.id)
    return NextResponse.json({ error: "Failed to decrypt stored token" }, { status: 500 })
  }

  // Defense in depth: POST /api/agency/email-scan already refreshes an expired token before
  // setting scan_status='scanning', but this route can run on a different instance/time, so
  // re-check rather than let a scan fail outright on a token that expired in the gap.
  const expiresAt = connection.token_expires_at ? new Date(connection.token_expires_at).getTime() : 0
  if ((Number.isNaN(expiresAt) ? 0 : expiresAt) <= Date.now()) {
    if (!connection.refresh_token_encrypted) {
      await service.from("email_connections").update({ scan_status: "error", status: "expired" }).eq("id", connection.id)
      return NextResponse.json({ error: "Your Gmail connection has expired. Please reconnect." }, { status: 401 })
    }
    try {
      const refreshed = await refreshGoogleToken(decrypt(connection.refresh_token_encrypted))
      accessToken = refreshed.access_token
      const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString()
      await service
        .from("email_connections")
        .update({ access_token_encrypted: encrypt(accessToken), token_expires_at: newExpiresAt })
        .eq("id", connection.id)
    } catch (refreshErr) {
      console.error("[api] failure", {
        route,
        method: "GET",
        message: "token refresh failed",
        detail: refreshErr instanceof Error ? refreshErr.message : String(refreshErr),
      })
      await service.from("email_connections").update({ scan_status: "error", status: "expired" }).eq("id", connection.id)
      return NextResponse.json({ error: "Your Gmail connection has expired. Please reconnect." }, { status: 401 })
    }
  }

  const accumulator = createContactAccumulator()
  let pageToken: string | null = null
  let processedCount = 0
  let failedTotal = 0

  try {
    do {
      const { ids, nextPageToken } = await listGmailMessageIds(accessToken, pageToken)
      if (ids.length === 0) break

      const remaining = MAX_MESSAGES - processedCount
      const idsToProcess = ids.slice(0, remaining)

      for (let i = 0; i < idsToProcess.length; i += CHECKPOINT_CHUNK_SIZE) {
        const chunk = idsToProcess.slice(i, i + CHECKPOINT_CHUNK_SIZE)
        const { messages, failedIds } = await fetchGmailMessageBatch(accessToken, chunk)
        accumulateContactsFromMessages(messages, auth.userEmail, accumulator)
        processedCount += chunk.length
        failedTotal += failedIds.length

        // Checkpoint - awaited synchronously before continuing, not fire-and-forget, so a
        // function killed mid-loop has already landed its last write.
        const { error: checkpointErr } = await service
          .from("email_connections")
          .update({
            scan_results: {
              contacts: contactsFromAccumulator(accumulator),
              processed_count: processedCount,
              failed_count: failedTotal,
              complete: false,
            },
          })
          .eq("id", connection.id)
        if (checkpointErr) {
          console.error("[api] partial-scan checkpoint failed", { route, message: checkpointErr.message })
        }

        if (processedCount >= MAX_MESSAGES) break
      }

      pageToken = processedCount < MAX_MESSAGES ? nextPageToken : null
    } while (pageToken)

    const finalContacts = contactsFromAccumulator(accumulator)
    const { error: finalErr } = await service
      .from("email_connections")
      .update({
        scan_status: "complete",
        last_scan_at: new Date().toISOString(),
        scan_run_token: null,
        scan_results: {
          contacts: finalContacts,
          processed_count: processedCount,
          failed_count: failedTotal,
          complete: true,
        },
      })
      .eq("id", connection.id)
    if (finalErr) {
      console.error("[api] failure", { route, method: "GET", message: finalErr.message })
    }

    console.log("[api] success", {
      route,
      method: "GET",
      userId: auth.userId,
      processedCount,
      failedTotal,
      contactCount: finalContacts.length,
    })
    return NextResponse.json({ scan_status: "complete", contact_count: finalContacts.length })
  } catch (scanErr) {
    console.error("[api] failure", {
      route,
      method: "GET",
      message: scanErr instanceof Error ? scanErr.message : String(scanErr),
    })
    // Best-effort - do NOT touch scan_results here, whatever was last checkpointed must
    // survive an error the same way it survives a timeout.
    await service.from("email_connections").update({ scan_status: "error" }).eq("id", connection.id)
    return NextResponse.json({ error: "Scan failed" }, { status: 500 })
  }
}
