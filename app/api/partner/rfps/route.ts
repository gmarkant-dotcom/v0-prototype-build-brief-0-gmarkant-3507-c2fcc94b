import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import {
  attachMagicTokenToPartnerInbox,
  MAGIC_TOKEN_ATTACH_COLUMNS,
  MAGIC_TOKEN_ATTACH_COLUMNS_NO_DEADLINE,
  type MagicTokenForAttach,
} from "@/lib/magic-token-attach"
import { claimAwardedGhostPartnershipsByEmail } from "@/lib/partnership-award-claim"

function getServiceSupabase() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null
  }
  // Service role required for the on-login sweep below - rfp_magic_tokens has no
  // partner-facing RLS policy letting a vendor read invitations addressed to their own
  // email, since that table was built purely for the anonymous guest-link flow.
  return createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
}

// H3: an invite you already answered still belongs in your portal - the 72-hour expiry only
// bounds how long a NEW invitation stays open to a response, it's irrelevant once a response
// exists (and by award time, an invite is essentially always past that window anyway, which
// was silently excluding every submitted/awarded guest bid from ever being swept).
// H4: evaluated per request, not once at module load - a warm serverless instance would
// otherwise keep comparing against the timestamp of its own cold start indefinitely.
const unexpiredOrRespondedFilter = () => `expires_at.gt.${new Date().toISOString()},response_id.not.is.null`

/**
 * G1/H3 on-login sweep: attach any outstanding magic-link invitations sent to this vendor's
 * email that haven't reached their portal inbox yet - unexpired ones (open invitations) and
 * expired-but-already-responded ones alike - retroactively surfaces invitations sent (and
 * bids submitted/awarded) before this feature existed. Attach itself is idempotent (see
 * lib/magic-token-attach.ts), so calling this on every list load is safe; a failure here
 * must never break the RFP list itself, only be logged.
 */
async function sweepOutstandingMagicTokens(vendorEmail: string, partnerId: string) {
  const service = getServiceSupabase()
  if (!service || !vendorEmail) return
  try {
    const tokenFilter = unexpiredOrRespondedFilter()
    let outstandingTokens: MagicTokenForAttach[] | null = null
    let tokensErr: { message: string; code?: string } | null = null
    const first = await service
      .from("rfp_magic_tokens")
      .select(MAGIC_TOKEN_ATTACH_COLUMNS)
      .ilike("vendor_email", vendorEmail)
      .or(tokenFilter)
    outstandingTokens = first.data as unknown as MagicTokenForAttach[] | null
    tokensErr = first.error
    // Pre-migration safety: migration 074 (response_deadline) may not be applied yet.
    if (tokensErr?.code === "42703") {
      const retry = await service
        .from("rfp_magic_tokens")
        .select(MAGIC_TOKEN_ATTACH_COLUMNS_NO_DEADLINE)
        .ilike("vendor_email", vendorEmail)
        .or(tokenFilter)
      outstandingTokens = retry.data as unknown as MagicTokenForAttach[] | null
      tokensErr = retry.error
    }
    if (tokensErr) {
      console.error("[partner/rfps] on-login sweep: token lookup failed", { partnerId, message: tokensErr.message })
      return
    }
    for (const tokenRow of outstandingTokens || []) {
      const result = await attachMagicTokenToPartnerInbox(service, { tokenRow, partnerId })
      if (!result.attached) {
        console.error("[partner/rfps] on-login sweep: attach failed", {
          partnerId,
          token: tokenRow.token,
          reason: result.reason,
        })
      }
    }
  } catch (sweepErr) {
    console.error("[partner/rfps] on-login sweep failed", {
      partnerId,
      message: sweepErr instanceof Error ? sweepErr.message : String(sweepErr),
    })
  }
}

/** Never cache this handler — avoids empty JSON stuck behind 304 on Vercel/CDN. */
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

export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      console.warn("[partner/rfps] GET: no session user")
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStoreHeaders })
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, active_role, email")
      .eq("id", user.id)
      .single()

    if (profile?.role !== "partner" && profile?.active_role !== "partner") {
      console.warn(
        `[partner/rfps] GET: wrong role — userId=${user.id} email=${user.email ?? profile?.email ?? "n/a"} profileRole=${profile?.role ?? "null"}`
      )
      return NextResponse.json({ error: "Vendors only" }, { status: 403, headers: noStoreHeaders })
    }

    const vendorEmail = (profile?.email || user.email || "").trim().toLowerCase()
    await sweepOutstandingMagicTokens(vendorEmail, user.id)
    // H3 retroactive fix: an award made before this account existed/was linked (H2's pure-
    // guest branch) leaves its partnerships row vendor_org_id-null forever otherwise - nothing
    // else claims it automatically. Service-role, same reasoning as the sweep above (RLS on
    // project_assignments would otherwise need to already know about a not-yet-linked row).
    const service = getServiceSupabase()
    if (service) {
      await claimAwardedGhostPartnershipsByEmail(service, { partnerId: user.id, vendorEmail })
    }

    // RLS applies: partner sees rows where vendor_org_id = auth.uid() OR recipient_email matches profile email
    const { data, error } = await supabase
      .from("partner_rfp_inbox")
      .select("*")
      .order("created_at", { ascending: false })

    if (error) {
      console.error("[partner/rfps] partner_rfp_inbox select error:", user.id, error.message)
      return NextResponse.json(
        { error: "Failed to load RFPs", detail: error.message },
        { status: 500, headers: noStoreHeaders }
      )
    }

    const rows = data || []
    const agencyIds = Array.from(new Set(rows.map((r) => r.lead_org_id).filter(Boolean)))
    let agencyMeetingUrlById: Record<string, string | null> = {}
    if (agencyIds.length > 0) {
      const { data: agencies } = await supabase.from("profiles").select("id, meeting_url").in("id", agencyIds)
      agencyMeetingUrlById = Object.fromEntries(
        (agencies || []).map((a) => [a.id as string, (a.meeting_url as string | null) || null])
      )
    }
    // LEFT JOIN: get client_name from projects (rows without project_id stay in list with null)
    const projectIds = [...new Set(rows.map((r) => r.project_id as string | null).filter((id): id is string => typeof id === "string" && id.length > 0))]
    let clientNameByProjectId: Record<string, string | null> = {}
    if (projectIds.length > 0) {
      const { data: projectRows } = await supabase
        .from("projects")
        .select("id, client_name")
        .in("id", projectIds)
      clientNameByProjectId = Object.fromEntries(
        (projectRows || []).map((p) => [p.id as string, (p.client_name as string | null) ?? null])
      )
    }

    const inboxIds = rows.map((r) => r.id).filter(Boolean)
    let responseByInboxId: Record<string, { status?: string; agency_feedback?: string | null; feedback_updated_at?: string | null }> = {}
    if (inboxIds.length > 0) {
      const { data: responses } = await supabase
        .from("partner_rfp_responses")
        .select("inbox_item_id, status, agency_feedback, feedback_updated_at, updated_at")
        .in("inbox_item_id", inboxIds)
      // In case of multiple rows per inbox (legacy data), keep the latest.
      for (const resp of responses || []) {
        const key = resp.inbox_item_id as string
        const prev = responseByInboxId[key] as ({ updated_at?: string } & { status?: string; agency_feedback?: string | null; feedback_updated_at?: string | null }) | undefined
        if (!prev || (resp.updated_at && (!prev.updated_at || resp.updated_at > prev.updated_at))) {
          responseByInboxId[key] = resp as { status?: string; agency_feedback?: string | null; feedback_updated_at?: string | null }
        }
      }
    }
    const mergedRows = rows.map((row) => {
      const master = (row.master_rfp_json || {}) as Record<string, unknown>
      const responseDeadline =
        (typeof row.response_deadline === "string" && row.response_deadline) ||
        (typeof master.response_deadline === "string" && master.response_deadline) ||
        null
      const resp = responseByInboxId[row.id as string]
      const effectiveStatus = (resp?.status || row.status || "new") as string
      return {
        ...row,
        created_at: (row.created_at as string | null) ?? null,
        viewed_at: (row.viewed_at as string | null) ?? null,
        response_deadline: responseDeadline,
        response_status: resp?.status || null,
        effective_status: effectiveStatus,
        agency_feedback: resp?.agency_feedback || null,
        feedback_updated_at: resp?.feedback_updated_at || null,
        agency_meeting_url: agencyMeetingUrlById[row.lead_org_id as string] || null,
        client_name: clientNameByProjectId[(row.project_id as string | null) ?? ""] ?? null,
      }
    })
    return NextResponse.json({ rfps: mergedRows }, { headers: revalidateHeaders })
  } catch (e) {
    console.error("[partner/rfps] GET exception:", e)
    return NextResponse.json({ error: "Failed to load RFPs" }, { status: 500, headers: noStoreHeaders })
  }
}
