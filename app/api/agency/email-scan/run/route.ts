import { NextResponse, type NextRequest } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createClient as createServiceClient, type SupabaseClient } from "@supabase/supabase-js"
import {
  createContactAccumulator,
  listGmailMessageIds,
  fetchGmailMessageBatch,
  accumulateContactsFromMessages,
  contactsFromAccumulator,
  refreshGoogleToken,
  extractDomainFromUrl,
  MAX_MESSAGES,
  type RawGmailContact,
} from "@/lib/google-email"
import { encrypt, decrypt } from "@/lib/token-encryption"
import { scoreAndFilterContacts, type ScoredVendorContact } from "@/lib/vendor-signal-scoring"

type EnrichedContact = ScoredVendorContact<RawGmailContact> & {
  has_ligament_account: boolean
  profile_id: string | null
  already_in_pool: boolean
}

/** Cross-references scored contacts against profiles (has_ligament_account, profile_id)
 *  and this agency's partnerships (already_in_pool). Mirrors the partner_id-then-
 *  partner_email lookup pattern in classifyGuestVendorForPool
 *  (app/api/rfp/guest/[token]/route.ts). Only called on the final "complete" write, not
 *  every checkpoint - it costs 2 extra round-trips and isn't needed until a human is
 *  actually reviewing finished results; a scan that times out before completing simply
 *  shows scored contacts without these three fields. */
async function enrichWithLigamentData(
  contacts: ScoredVendorContact<RawGmailContact>[],
  agencyId: string,
  service: SupabaseClient
): Promise<EnrichedContact[]> {
  if (contacts.length === 0) return []

  const profileByEmail = new Map<string, string>()
  const profileFilter = contacts.map((c) => `email.ilike.${c.email}`).join(",")
  const { data: profiles } = await service.from("profiles").select("id, email").or(profileFilter)
  for (const p of profiles || []) {
    if (p.email) profileByEmail.set(String(p.email).toLowerCase(), p.id as string)
  }

  const profileIds = Array.from(new Set(Array.from(profileByEmail.values())))
  const partnershipFilterParts = contacts.map((c) => `partner_email.ilike.${c.email}`)
  if (profileIds.length > 0) {
    partnershipFilterParts.push(`partner_id.in.(${profileIds.join(",")})`)
  }
  const partnerIdSet = new Set<string>()
  const partnerEmailSet = new Set<string>()
  const { data: partnerships } = await service
    .from("partnerships")
    .select("partner_id, partner_email")
    .eq("agency_id", agencyId)
    .or(partnershipFilterParts.join(","))
  for (const row of partnerships || []) {
    if (row.partner_id) partnerIdSet.add(row.partner_id as string)
    if (row.partner_email) partnerEmailSet.add(String(row.partner_email).toLowerCase())
  }

  return contacts.map((contact) => {
    const profileId = profileByEmail.get(contact.email) || null
    const alreadyInPool = (profileId != null && partnerIdSet.has(profileId)) || partnerEmailSet.has(contact.email)
    return {
      ...contact,
      has_ligament_account: Boolean(profileId),
      profile_id: profileId,
      already_in_pool: alreadyInPool,
    }
  })
}

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
    .select("role, active_role, email, company_website")
    .eq("id", user.id)
    .maybeSingle()
  if (profile?.role !== "agency" && profile?.active_role !== "agency") {
    return { ok: false as const, status: 403, error: "Agency only" }
  }
  // Exclude the agency's own business domain from results, not just the login email's
  // domain - the two can differ (e.g. a personal-looking login address with a distinct
  // registered company_website).
  const companyDomain = extractDomainFromUrl(profile?.company_website)
  return {
    ok: true as const,
    userId: user.id,
    userEmail: profile?.email || "",
    excludedDomains: companyDomain ? [companyDomain] : [],
  }
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
        accumulateContactsFromMessages(messages, auth.userEmail, accumulator, auth.excludedDomains)
        processedCount += chunk.length
        failedTotal += failedIds.length

        // Checkpoint - awaited synchronously before continuing, not fire-and-forget, so a
        // function killed mid-loop has already landed its last write. Scored/filtered/
        // sorted (cheap, pure) but not yet cross-referenced against profiles/partnerships
        // (that's 2 extra DB round-trips, deferred to the final write - see
        // enrichWithLigamentData's comment).
        const { error: checkpointErr } = await service
          .from("email_connections")
          .update({
            scan_results: {
              contacts: scoreAndFilterContacts(contactsFromAccumulator(accumulator)),
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

    const scoredContacts = scoreAndFilterContacts(contactsFromAccumulator(accumulator))
    const finalContacts = await enrichWithLigamentData(scoredContacts, auth.userId, service)
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
