import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { ORG_CONTACT_SELECT_MEETING, resolveOrgContact, type OrgEmbed } from "@/lib/org-contact"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import { resolveCallerWriteOrgId, type OrgId } from "@/lib/entitlements"
import { resolveActingOrgId } from "@/lib/acting-org"
import { canActAs } from "@/lib/acting-role"
import { vendorOwnsPartnerRfpInboxRow } from "@/lib/partner-inbox-access"
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
async function sweepOutstandingMagicTokens(vendorEmail: string, partnerId: OrgId) {
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

    // WHICH SIDE, not which company. lib/acting-role.ts, term for term with the hand-rolled
    // `role !== "partner" && active_role !== "partner"` this replaces - canActAs() grants the
    // portal when EITHER column names it, which is what that disjunction said. The one
    // non-identity is that canActAs normalizes case and surrounding whitespace, so a stored
    // " Partner" now resolves instead of 403-ing. Same substitution already made at
    // app/api/partner/rfp-bid/upload/route.ts:46-50.
    if (!canActAs(profile, "partner")) {
      console.warn(
        `[partner/rfps] GET: wrong role — userId=${user.id} email=${user.email ?? profile?.email ?? "n/a"} profileRole=${profile?.role ?? "null"}`
      )
      return NextResponse.json({ error: "Vendors only" }, { status: 403, headers: noStoreHeaders })
    }

    const vendorEmail = (profile?.email || user.email || "").trim().toLowerCase()

    // WHICH ORGANIZATION IS THIS CALLER ACTING FOR? The sanctioned answer, from
    // lib/acting-org.ts, which derives the set from `org_members` on every call and fails
    // closed on ambiguity. Deliberately NOT an org id resolved from a user id: that
    // substitution is only ever correct for the sixteen accounts 079 backfilled, whose
    // organization id equals their founder's.
    //
    // WHY A SINGLE ID RATHER THAN THE MEMBERSHIP SET. `resolveCallerOrgIds()` answers "every
    // company this person belongs to", which is the right question for an AUTHORIZATION check
    // - the detail route asks it that way and should. This is not an authorization check. It
    // is "which company's vendor portal am I looking at", and that has one answer.
    // resolveActingOrgId() is the module whose entire purpose is giving it, and it refuses
    // rather than guessing when a caller belongs to more than one organization with no
    // preference set.
    //
    // ON A REFUSAL THE VENDOR LIST IS EMPTY, NOT UNSCOPED. `orgIds` stays empty, the email arm
    // still applies, and the list narrows to invitations addressed to the caller personally.
    // That is the fail-closed direction and it is the direction acting-org.ts exists to take.
    // UNREACHABLE TODAY: every live account has exactly one org_members row, so every caller
    // takes the "sole-membership" branch. See OPEN-RS-4 in the session report for the
    // divergence this would create against the detail route on the day that changes.
    const actingOrg = await resolveActingOrgId(user.id, supabase)
    const actingOrgIds = actingOrg.orgId ? [actingOrg.orgId] : []
    if (!actingOrg.orgId) {
      console.error("[partner/rfps] no acting organization, vendor list falls back to the email arm only", {
        userId: user.id,
        reason: actingOrg.reason,
        memberOrgCount: actingOrg.memberOrgIds.length,
      })
    }

    // 079 PARAMETER CLASS: both calls below WRITE this value into vendor_org_id, which
    // REFERENCES organizations(id). `user.id` is a user id: accidentally correct for the
    // sixteen backfilled accounts whose organization id equals their founder's, and a 23503
    // foreign key violation for every account created since. resolveCallerWriteOrgId() rather
    // than agencyEntitlementId(), because that one falls back to returning the user id
    // unchanged - the right failure for a quota row and precisely the wrong one for a foreign
    // key. Null means "no organization", and the linkage work is skipped rather than guessed;
    // the list below still renders from the caller's memberships.
    const vendorWriteOrgId = await resolveCallerWriteOrgId(user.id, supabase)
    if (vendorWriteOrgId) {
      await sweepOutstandingMagicTokens(vendorEmail, vendorWriteOrgId)
    } else {
      console.error("[partner/rfps] skipping magic-token sweep: caller belongs to no organization", {
        userId: user.id,
      })
    }
    // H3 retroactive fix: an award made before this account existed/was linked (H2's pure-
    // guest branch) leaves its partnerships row vendor_org_id-null forever otherwise - nothing
    // else claims it automatically. Service-role, same reasoning as the sweep above (RLS on
    // project_assignments would otherwise need to already know about a not-yet-linked row).
    const service = getServiceSupabase()
    if (service && vendorWriteOrgId) {
      // 079: the ghost row is claimed BY THE ORGANISATION, so pass its id.
      await claimAwardedGhostPartnershipsByEmail(service, {
        partnerId: vendorWriteOrgId,
        vendorEmail,
      })
    }

    // RLS DOES apply here - this is the anon client, not the service client. The comment
    // this replaces claimed RLS applied on a query that was in fact on the service client,
    // which docs/079-rename-plan.md section 6 route 16 flagged as a lie the next reader
    // would trust. It is now true and worth keeping true.
    //
    // RLS IS THE WALL. IT WAS NEVER THE SCOPE, AND THIS ROUTE USED TO TREAT IT AS BOTH.
    //
    // `partner_rfp_inbox` carries five policies: an agency SELECT on `lead_org_id`, a vendor
    // SELECT on `vendor_org_id`, and a vendor SELECT on `recipient_email`. Permissive
    // policies of the same command OR together, so this select returns THE UNION OF EVERY
    // ARM THE CALLER SATISFIES. The agency arm knows nothing about which portal the caller
    // is looking at. For a lead agency browsing their own vendor portal that union is their
    // entire OUTBOUND broadcast history, rendered as inbound bid opportunities: measured live
    // on 2026-08-21 as 96 rows, of which visible_as_lead_agency = 96, visible_as_vendor_org
    // = 0, visible_by_recipient_email = 0.
    //
    // The comment that stood here said "no application-side org filter is needed because
    // there is no application-side filter here at all: the select is unqualified and RLS is
    // the whole scoping". That is an accurate description of the defect.
    //
    // THE FILTER IS ADDED, THE RLS RELIANCE IS KEPT. Belt and braces: the policy still
    // decides whether the caller may see a row, and this decides whether the VENDOR PORTAL is
    // where it belongs. Removing either would be wrong - a filter alone is not an
    // authorization boundary, and a policy alone cannot tell the two portals apart.
    //
    // The comparison is `vendorOwnsPartnerRfpInboxRow()`, the same function
    // /api/partner/rfps/[id] reaches through `partnerCanAccessPartnerRfpInbox()`. That route
    // is the reference implementation because it is the one that behaved correctly: it
    // returned "Not found" for a row this list had just rendered. Two surfaces disagreeing
    // about what a vendor row is are how the Aug 14 pool bug shipped, so they share one
    // definition rather than two that agree today.
    //
    // NDA-GATED ROWS STAY IN THE LIST. The ownership half is asked deliberately, not the
    // whole access check: a vendor has to SEE an NDA-gated RFP to know there is an NDA to
    // sign. The detail route still refuses its contents. That difference is the reason the
    // ownership test is a separate exported function.
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

    const unscopedRows = data || []
    const rows = unscopedRows.filter((row) =>
      vendorOwnsPartnerRfpInboxRow(
        {
          vendor_org_id: (row.vendor_org_id as string | null) ?? null,
          recipient_email: (row.recipient_email as string | null) ?? null,
        },
        actingOrgIds,
        vendorEmail
      )
    )
    if (unscopedRows.length !== rows.length) {
      // Not an error. This is the measurement of the defect this filter exists to close, and
      // it is logged so the number can be watched rather than assumed to be zero.
      console.log("[partner/rfps] acting-role filter dropped rows the caller sees as the lead agency", {
        userId: user.id,
        returnedByRls: unscopedRows.length,
        keptForVendorPortal: rows.length,
        actingOrgResolution: actingOrg.reason,
      })
    }
    // PHASE 3, previously deferred. This read `meeting_url` out of `profiles` keyed by a
    // lead ORGANIZATION id, which resolves only while an organization's id equals its
    // founder's user id. For every agency created since 079 it matched nothing and the
    // "Book a call" button silently stopped rendering - a missing button, no error.
    //
    // The deferral's own reasoning is what fixes it: a meeting link is a PERSON'S calendar,
    // so it is reached through the organization's designated primary contact - one hop
    // further, not one table across. No new column and no new policy: the organization is
    // readable through current_user_counterparty_org_ids() and the contact's profile
    // through current_user_visible_profile_ids(), which share their counterparty definition
    // by construction. An agency with no partnership to this vendor resolves to null and
    // the button does not render, which is correct rather than merely unchanged.
    const agencyIds = Array.from(new Set(rows.map((r) => r.lead_org_id).filter(Boolean)))
    let agencyMeetingUrlById: Record<string, string | null> = {}
    if (agencyIds.length > 0) {
      const { data: agencyOrgs, error: agencyOrgsErr } = await supabase
        .from("organizations")
        .select(ORG_CONTACT_SELECT_MEETING)
        .in("id", agencyIds)
      if (agencyOrgsErr) {
        console.error("[partner/rfps] lead agency organizations batch load failed", {
          agencyIdCount: agencyIds.length,
          message: agencyOrgsErr.message,
          code: agencyOrgsErr.code,
        })
      }
      for (const org of (agencyOrgs || []) as unknown[]) {
        const contact = resolveOrgContact(org as OrgEmbed, null)
        if (contact.orgId) agencyMeetingUrlById[contact.orgId] = contact.contactMeetingUrl
      }
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
