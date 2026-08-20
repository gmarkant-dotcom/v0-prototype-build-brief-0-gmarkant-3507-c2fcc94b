import { resolveCallerOrgIds, orgIdFromColumn, resolveOrgIdForUser, type OrgId } from "@/lib/entitlements"
import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import { buildBrandedEmailHtml, resolveOrgNotificationRecipients, sendTransactionalEmail, siteBaseUrl } from "@/lib/email"
import { notifyProjectAwarded } from "@/lib/notifications"
import { resolvePartnershipForAward } from "@/lib/award-partnership-resolution"
import { mapResponseStatusToInboxStatus } from "@/lib/bid-status"
import { can, capabilityDeniedMessage } from "@/lib/capabilities"
import { recordMilestone } from "@/lib/milestone-events"

export const dynamic = "force-dynamic"

/** Service role, used for TWO counterparty identity reads inside the award path and nothing
 *  else - see the H3 block below. Both reads ask a question about the vendor that RLS is
 *  designed to refuse the agency: "which profile holds this email" and "which organization
 *  does that profile belong to". Both `profiles` and `org_members` are scoped to the caller's
 *  own side (`org_members` admits only `user_id = auth.uid()` or the caller's own orgs), so on
 *  the session client both return zero rows for every counterparty, always - which is the
 *  correct answer to a visibility question and the wrong answer to this one. The agency user
 *  is authenticated and role-checked at the top of this handler before either read runs, the
 *  email being resolved is one the agency itself sent the RFP to, and neither read returns
 *  anything to the client. Returns null when the key is absent (previews/local) - callers fall
 *  back to the session client rather than failing the award.
 *  Same pattern and same justification as app/api/agency/rfp/magic-link/route.ts:14-21. */
function getServiceSupabase() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null
  }
  return createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
}

/**
 * Scope title, partnership and RFP snapshot for a bid whose response carries no
 * `inbox_item_id`.
 *
 * Guest / magic-link bids (migration 057) never get a `partner_rfp_inbox` row, so every read
 * that goes through `partner_rfp_responses.inbox_item_id` returns nothing for them. That is
 * what wrote `{"scope_item_name": null}` onto `bid.decline`, and it is what put the unnamed
 * "Update on your recent bid submission" on the mail sent beside it: the title was never
 * missing, it was on the originating `rfp_magic_tokens` row the whole time.
 *
 * The award path already resolves both of this shape's sources - the G1-synthesized inbox
 * row found by the `master_rfp_json._magic_token` marker, then the token row itself - which
 * is why `bid.award` never had the gap. This is that same resolution, factored out for the
 * two emitters that had neither.
 *
 * Read-only and non-fatal by construction: every failure returns nulls, which is exactly
 * what the callers rendered before. A breadcrumb and a subject line are not worth failing a
 * decline over.
 */
type GuestBidContext = {
  scopeItemName: string | null
  partnershipId: string | null
  masterRfpJson: unknown
}

async function resolveGuestBidContext(
  supabase: Awaited<ReturnType<typeof createClient>>,
  { responseId, callerOrgIds, route }: { responseId: string; callerOrgIds: OrgId[]; route: string }
): Promise<GuestBidContext> {
  const empty: GuestBidContext = { scopeItemName: null, partnershipId: null, masterRfpJson: null }

  const { data: tokenRow, error: tokenErr } = await supabase
    .from("rfp_magic_tokens")
    .select("token, scope_item_name")
    .eq("response_id", responseId)
    .maybeSingle()
  if (tokenErr) {
    console.error("[api] guest bid context: magic token lookup failed (non-fatal)", {
      route,
      responseId,
      message: tokenErr.message,
      code: tokenErr.code,
    })
    return empty
  }
  if (!tokenRow?.token) return empty

  const tokenScopeItemName = (tokenRow.scope_item_name as string | null)?.trim() || null

  // A G1-synthesized inbox row is preferred over the token where one exists, because it is
  // the only source of `partnership_id` - and partnership_id is what makes a milestone
  // reachable by the vendor the milestone is about. Scoped to the caller's organizations,
  // matching the identical lookup on the award path.
  const { data: synthesized, error: synthErr } = await supabase
    .from("partner_rfp_inbox")
    .select("scope_item_name, master_rfp_json, partnership_id")
    .in("lead_org_id", callerOrgIds)
    .contains("master_rfp_json", { _magic_token: tokenRow.token })
    .maybeSingle()
  if (synthErr) {
    console.error("[api] guest bid context: G1-synthesized inbox lookup failed (falling back to the token)", {
      route,
      responseId,
      message: synthErr.message,
      code: synthErr.code,
    })
    return { ...empty, scopeItemName: tokenScopeItemName }
  }

  return {
    scopeItemName: ((synthesized?.scope_item_name as string | null) || "").trim() || tokenScopeItemName,
    partnershipId: (synthesized?.partnership_id as string | null) ?? null,
    masterRfpJson: synthesized?.master_rfp_json ?? null,
  }
}

/**
 * Scope title and partnership for a bid milestone that has no email beside it to have
 * resolved them already.
 *
 * `bid.feedback` and `bid.decline` get both as a by-product of composing their mail: the inbox
 * row where `inbox_item_id` is set, `resolveGuestBidContext()` where it is not. The shortlist
 * and meeting-request transitions send no mail, so they have nothing to ride on and make the
 * same two reads here.
 *
 * Non-fatal by construction, like the resolver it wraps. A failed lookup returns nulls and the
 * milestone records without a scope title, which is exactly what it would have written had the
 * row genuinely carried none. A breadcrumb never fails a status change.
 */
async function resolveBidMilestoneContext(
  supabase: Awaited<ReturnType<typeof createClient>>,
  {
    responseId,
    inboxItemId,
    callerOrgIds,
    route,
  }: { responseId: string; inboxItemId: string | null; callerOrgIds: OrgId[]; route: string }
): Promise<{ scopeItemName: string | null; partnershipId: string | null }> {
  // `.eq("id", null)` on a uuid column is a Postgres type error rather than an empty result,
  // so a guest bid has to skip this query entirely - the same guard the two mail-sending
  // paths put in front of their own inbox reads.
  if (inboxItemId) {
    const { data, error } = await supabase
      .from("partner_rfp_inbox")
      .select("scope_item_name, partnership_id")
      .eq("id", inboxItemId)
      .in("lead_org_id", callerOrgIds)
      .maybeSingle()
    if (error) {
      console.error("[api] bid milestone context: inbox select failed (non-fatal)", {
        route,
        responseId,
        inbox_item_id: inboxItemId,
        message: error.message,
        code: error.code,
      })
    }
    // A real inbox row is authoritative even where its own scope_item_name is blank, matching
    // the feedback path exactly: the guest fallback is consulted only when there is no row.
    if (data) {
      return {
        scopeItemName: ((data.scope_item_name as string | null) || "").trim() || null,
        partnershipId: (data.partnership_id as string | null) ?? null,
      }
    }
  }

  const guest = await resolveGuestBidContext(supabase, { responseId, callerOrgIds, route })
  return { scopeItemName: guest.scopeItemName, partnershipId: guest.partnershipId }
}

type PatchBody = {
  status?: "submitted" | "under_review" | "shortlisted" | "meeting_requested" | "awarded" | "declined"
  agency_feedback?: string
  decline_reason?: string
}

const ALLOWED_STATUS = new Set(["submitted", "under_review", "shortlisted", "meeting_requested", "awarded", "declined"])

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const route = "/api/agency/rfp-responses/[id]"
  try {
    const { id } = await params
    const body = (await req.json().catch(() => ({}))) as PatchBody
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    // 079: an organization column is not a user id. Reads scope to the caller's memberships.
    const callerOrgIds = await resolveCallerOrgIds(user.id, supabase)

    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("role, active_role, company_name, full_name, email, is_admin")
      .eq("id", user.id)
      .single()
    if (profileErr) {
      console.error("[api] PATCH agency profile load failed", {
        route,
        userId: user.id,
        message: profileErr.message,
        code: profileErr.code,
      })
      return NextResponse.json({ error: "Failed to load profile" }, { status: 500 })
    }
    if (profile?.role !== "agency" && profile?.active_role !== "agency")
      return NextResponse.json({ error: "Agency only" }, { status: 403 })
    console.log("[api] start", { route, method: "PATCH", userId: user.id, role: profile.role, responseId: id })

    const { data: existing, error: existingErr } = await supabase
      .from("partner_rfp_responses")
      .select("id, vendor_org_id, lead_org_id, inbox_item_id, status, agency_feedback")
      .eq("id", id)
      .in("lead_org_id", callerOrgIds)
      .maybeSingle()
    if (existingErr) {
      console.error("[api] PATCH partner_rfp_responses load failed", {
        route,
        responseId: id,
        userId: user.id,
        message: existingErr.message,
        code: existingErr.code,
      })
      return NextResponse.json({ error: "Failed to load bid response" }, { status: 500 })
    }
    if (!existing) return NextResponse.json({ error: "Response not found" }, { status: 404 })

    const incomingAgencyFeedback =
      typeof body.agency_feedback === "string" ? body.agency_feedback.trim() : ""
    const existingAgencyFeedback = (existing.agency_feedback || "").trim()
    const shouldSendAgencyFeedbackEmail =
      incomingAgencyFeedback.length > 0 && incomingAgencyFeedback !== existingAgencyFeedback
    const shouldAutoTransitionToUnderReview =
      incomingAgencyFeedback.length > 0 &&
      existing.status === "submitted" &&
      (body.status === undefined || body.status === "submitted")

    const nextStatus = shouldAutoTransitionToUnderReview
      ? "under_review"
      : body.status ?? existing.status
    if (!ALLOWED_STATUS.has(nextStatus)) {
      return NextResponse.json({ error: "Invalid status value" }, { status: 400 })
    }
    if (existing.status === "awarded" && nextStatus !== "awarded") {
      return NextResponse.json({ error: "Awarded bids cannot transition to another status" }, { status: 400 })
    }

    /**
     * Capability gates. Three transitions on this one route, three separate capabilities,
     * checked here because this is the last point before any write and the first point where
     * the intended transition is known.
     *
     * All three are irreversible in the sense docs/capabilities.md uses: each sends mail the
     * vendor has already read by the time anyone reconsiders. The route's only other gate is
     * `.in("lead_org_id", callerOrgIds)`, which is ownership - and 079 turns ownership into
     * membership, at which point every colleague passes it identically and this is the only
     * thing left that can distinguish an admin from a member. All three resolve true for
     * everyone today.
     */
    const isAwarding = existing.status !== "awarded" && nextStatus === "awarded"
    const isDeclining = existing.status !== "declined" && nextStatus === "declined"
    // Named here rather than inline at the timestamp stamping below, so the one expression
    // that decides "this is the transition" is also the one the milestone fires on. nextStatus
    // holds a single value, so these two are mutually exclusive and at most one can be true.
    const isShortlisting = existing.status !== "shortlisted" && nextStatus === "shortlisted"
    const isRequestingMeeting =
      existing.status !== "meeting_requested" && nextStatus === "meeting_requested"
    if (isAwarding && !can(profile, "bid.award")) {
      return NextResponse.json({ error: capabilityDeniedMessage("bid.award") }, { status: 403 })
    }
    if (isDeclining && !can(profile, "bid.decline")) {
      return NextResponse.json({ error: capabilityDeniedMessage("bid.decline") }, { status: 403 })
    }
    // Gated on the same condition that sends the feedback email, so the gate and the
    // irreversible act cannot drift apart: feedback that is not new does not send mail and is
    // not a capability event.
    if (shouldSendAgencyFeedbackEmail && !can(profile, "bid.feedback")) {
      return NextResponse.json({ error: capabilityDeniedMessage("bid.feedback") }, { status: 403 })
    }

    const agencyFeedback = typeof body.agency_feedback === "string" ? body.agency_feedback.trim() : existing.agency_feedback || null
    const declineReason = typeof body.decline_reason === "string" ? body.decline_reason.trim() : ""
    const composedFeedback =
      nextStatus === "declined" && declineReason
        ? [agencyFeedback, `Decline reason: ${declineReason}`].filter(Boolean).join("\n\n")
        : agencyFeedback

    const patch: Record<string, unknown> = {
      status: nextStatus,
      agency_feedback: composedFeedback || null,
      updated_at: new Date().toISOString(),
    }
    if (body.agency_feedback !== undefined || declineReason) patch.feedback_updated_at = new Date().toISOString()
    if (existing.status !== nextStatus) patch.feedback_updated_at = new Date().toISOString()

    // Bid action timestamps (migration 069) - only stamped on the transition into that
    // status, mirroring the awarded_at/decline-email guards below. No timestamp is ever
    // overwritten by a later transition away from and back to the same status.
    if (isShortlisting) {
      patch.shortlisted_at = patch.updated_at
    }
    if (isRequestingMeeting) {
      patch.meeting_requested_at = patch.updated_at
    }
    if (isDeclining) {
      patch.declined_at = patch.updated_at
    }

    /**
     * Award requires a project_assignment row keyed by (project_id, partnership_id). Portal-
     * origin bids get both from partner_rfp_inbox via inbox_item_id. Guest/magic-link bids
     * (migration 057 - inbox_item_id nullable) have no such row: `.eq("id", null)` on a uuid
     * column is a Postgres type error ("invalid input syntax for type uuid: null"), not an
     * empty result, which is exactly what surfaced as "Failed to load broadcast inbox for
     * award." Three cases handled below: a real inbox row (portal-origin, sync as before), no
     * inbox row anywhere (guest-origin, resolve project/partnership from the originating
     * rfp_magic_tokens row instead and skip inbox sync entirely), and a G1-synthesized inbox
     * row that already exists for this same invitation (found via the master_rfp_json.
     * _magic_token marker) - linked onto the response permanently so this and every future
     * PATCH takes the normal first path from then on.
     */
    type AwardContext = {
      inbox: {
        id: string | null
        scope_item_name: string | null
        master_rfp_json: unknown
      }
      projectId: string
      partnershipId: string
    }
    let awardContext: AwardContext | null = null
    // Tracks which inbox row (if any) status-sync below should target - starts as whatever
    // the response already had, and gains the id of a newly-linked G1-synthesized row.
    let resolvedInboxItemId: string | null = (existing.inbox_item_id as string | null) ?? null

    if (isAwarding) {
      type InboxForAward = {
        id: string | null
        project_id: string | null
        vendor_org_id: string | null
        partnership_id: string | null
        // The address the broadcast was sent TO. Selected because it is the only vendor email
        // the agency can read without RLS' permission - see the vendor identity block below.
        recipient_email: string | null
        scope_item_name: string | null
        master_rfp_json: unknown
      }
      let inboxRow: InboxForAward | null = null

      if (resolvedInboxItemId) {
        const { data, error: inboxFetchErr } = await supabase
          .from("partner_rfp_inbox")
          .select("id, project_id, vendor_org_id, partnership_id, recipient_email, scope_item_name, master_rfp_json")
          .eq("id", resolvedInboxItemId)
          .in("lead_org_id", callerOrgIds)
          .maybeSingle()
        if (inboxFetchErr) {
          console.error("[api] bid award: failed to load partner_rfp_inbox (join key: partner_rfp_responses.inbox_item_id)", {
            route,
            responseId: id,
            inbox_item_id: resolvedInboxItemId,
            message: inboxFetchErr.message,
            code: inboxFetchErr.code,
          })
          return NextResponse.json({ error: "Failed to load broadcast inbox for award." }, { status: 500 })
        }
        if (!data) {
          console.error("[api] bid award: partner_rfp_inbox row not found for inbox_item_id", {
            route,
            responseId: id,
            inbox_item_id: resolvedInboxItemId,
          })
          return NextResponse.json({ error: "Broadcast inbox row not found for this response." }, { status: 500 })
        }
        inboxRow = data as InboxForAward
      } else {
        // Guest/magic-link bid - find the originating token to check for a G1-synthesized
        // inbox row before falling back to a token-only context.
        const { data: tokenRow, error: tokenErr } = await supabase
          .from("rfp_magic_tokens")
          .select("token, project_id, scope_item_name")
          .eq("response_id", id)
          .maybeSingle()
        if (tokenErr) {
          console.error("[api] bid award: failed to load originating magic token", {
            route,
            responseId: id,
            message: tokenErr.message,
            code: tokenErr.code,
          })
          return NextResponse.json({ error: "Failed to load invitation for award." }, { status: 500 })
        }

        if (tokenRow?.token) {
          const { data: synthesized, error: synthErr } = await supabase
            .from("partner_rfp_inbox")
            .select("id, project_id, vendor_org_id, partnership_id, recipient_email, scope_item_name, master_rfp_json")
            .in("lead_org_id", callerOrgIds)
            .contains("master_rfp_json", { _magic_token: tokenRow.token })
            .maybeSingle()
          if (synthErr) {
            console.error("[api] bid award: G1-synthesized inbox lookup failed", {
              route,
              responseId: id,
              token: tokenRow.token,
              message: synthErr.message,
              code: synthErr.code,
            })
            return NextResponse.json({ error: "Failed to load broadcast inbox for award." }, { status: 500 })
          }
          if (synthesized) {
            inboxRow = synthesized as InboxForAward
            const { error: linkErr } = await supabase
              .from("partner_rfp_responses")
              .update({ inbox_item_id: synthesized.id })
              .eq("id", id)
              .in("lead_org_id", callerOrgIds)
            if (linkErr) {
              // Non-fatal - the award can still proceed against synthesized data this once,
              // it just won't self-heal into the normal path until a future attempt succeeds.
              console.error("[api] bid award: failed to link response to synthesized inbox row (non-fatal)", {
                route,
                responseId: id,
                inboxId: synthesized.id,
                message: linkErr.message,
                code: linkErr.code,
              })
            } else {
              resolvedInboxItemId = synthesized.id as string
            }
          }
        }

        if (!inboxRow) {
          const projectIdFromToken = (tokenRow?.project_id as string | null) ?? null
          if (!projectIdFromToken) {
            console.error("[api] bid award: guest bid has no resolvable project (no inbox row, no magic token project_id)", {
              route,
              responseId: id,
            })
            return NextResponse.json(
              { error: "Cannot award this bid: no project could be resolved for it." },
              { status: 500 }
            )
          }
          inboxRow = {
            id: null,
            project_id: projectIdFromToken,
            vendor_org_id: (existing.vendor_org_id as string | null) ?? null,
            partnership_id: null,
            // No inbox row exists on this path, so there is no recipient_email to carry. The
            // magic token is this shape's only email source, and it is read below.
            recipient_email: null,
            scope_item_name: (tokenRow?.scope_item_name as string | null) ?? null,
            master_rfp_json: null,
          }
        }
      }

      const projectId = inboxRow.project_id as string | null
      if (!projectId) {
        console.error("[api] bid award: partner_rfp_inbox.project_id is null — refusing award (project_assignments requires project_id)", {
          route,
          responseId: id,
          inbox_item_id: existing.inbox_item_id,
          inboxId: inboxRow.id,
        })
        return NextResponse.json(
          {
            error:
              "Cannot award this bid: the broadcast inbox is not linked to a project. Send this RFP from a project context so inbox.project_id is set.",
          },
          { status: 500 }
        )
      }

      // a. Partnership already linked to this broadcast/inbox row - today's behavior, unchanged.
      let partnershipId = inboxRow.partnership_id as string | null
      // 079 PARAMETER CLASS: both sources are `vendor_org_id`, an organization column
      // PostgREST hands back as `any` - and `any` is assignable to `OrgId`, so the brand on
      // resolvePartnershipForAward() proved nothing here until this local was typed. Crossed
      // in through the named boundary instead. `??` matches the old `||` exactly:
      // orgIdFromColumn() already returns null for the empty string.
      let partnerIdForResolution: OrgId | null =
        orgIdFromColumn(inboxRow.vendor_org_id) ?? orgIdFromColumn(existing.vendor_org_id)

      if (!partnershipId) {
        // H2: award is mutual consent - resolve (claim or create) the partnership rather
        // than refuse. Need the vendor's email/display name/contact name regardless of which
        // branch above produced inboxRow: a profile-linked bidder has them on profiles; a
        // pure guest only has them on the originating rfp_magic_tokens row.
        let vendorEmail: string | null = null
        let vendorDisplayName = "Vendor"
        let vendorContactName: string | null = null
        if (partnerIdForResolution) {
          // 079: a vendor ORGANISATION id, not a profile id. See lib/email.ts.
          const partnerProfile =
            (await resolveOrgNotificationRecipients(partnerIdForResolution, supabase))[0] ?? null
          vendorEmail = (partnerProfile?.email as string | null) || null
          vendorDisplayName =
            partnerProfile?.company_name?.trim() ||
            partnerProfile?.full_name?.trim() ||
            partnerProfile?.email?.trim() ||
            "Vendor"
          vendorContactName = (partnerProfile?.full_name as string | null) || null

          // THE PROFILE READ ABOVE IS ALLOWED TO RETURN NOTHING, AND USUALLY DOES.
          // resolveOrgNotificationRecipients() runs on the session client. Its org_members
          // read is scoped to the caller's own organizations and its profiles fallback needs
          // either an existing partnership - which is precisely what does not exist on this
          // branch - or is_discoverable = true on the vendor. So for a non-discoverable
          // vendor it correctly resolves nobody, vendorEmail comes back null, and migration
          // 087's INSERT policy then refuses the partnership the award depends on:
          // `vendor_org_id IS NULL OR org_has_member_with_email(vendor_org_id, partner_email)`
          // is false on both disjuncts when the email is null (087:499-513, 087:566-575).
          // The email is NOT actually unavailable - it is on the inbox row this handler has
          // already fetched, and on the magic token. Preferring the profile read keeps the
          // richer company/contact names where it succeeds; these two only fill the null.
          if (!vendorEmail) {
            // 1. partner_rfp_inbox.recipient_email. Every inbox shape that can reach this
            //    branch carries it: the pool-vendor broadcast row is the only writer that
            //    leaves it null, and that row always carries partnership_id, so branch a
            //    returns before here. On the manual-recipient and magic-token-attach rows the
            //    address and vendor_org_id were derived from each other at write time, which
            //    is the same pairing 087 checks.
            vendorEmail = (inboxRow.recipient_email as string | null)?.trim() || null

            // 2. rfp_magic_tokens.vendor_email, the source 087:394 nominated. Same query the
            //    sibling branch below runs; readable here because the token rows are the
            //    agency's own (079:1666-1668).
            if (!vendorEmail) {
              const { data: tokenForOrgVendor, error: tokenVendorErr } = await supabase
                .from("rfp_magic_tokens")
                .select("vendor_email, vendor_name")
                .eq("response_id", id)
                .maybeSingle()
              if (tokenVendorErr) {
                console.error("[api] bid award: magic token vendor_email fallback failed (non-fatal)", {
                  route,
                  responseId: id,
                  message: tokenVendorErr.message,
                  code: tokenVendorErr.code,
                })
              }
              vendorEmail = (tokenForOrgVendor?.vendor_email as string | null)?.trim() || null
              vendorContactName = vendorContactName || ((tokenForOrgVendor?.vendor_name as string | null) || null)
            }

            // The profile read produced no names either if it produced no email, so the
            // placeholder is only correct while there is nothing better. Now there is.
            if (vendorDisplayName === "Vendor") {
              vendorDisplayName = vendorContactName || vendorEmail || "Vendor"
            }

            console.error(
              vendorEmail
                ? "[api] bid award: vendor email resolved from the inbox/token fallback, not the profile read (RLS hid the vendor profile)"
                : "[api] bid award: no vendor email from profile, inbox recipient_email, or magic token - partnership will be created as a ghost",
              { route, responseId: id, partnerIdForResolution, inboxId: inboxRow.id, hasEmail: Boolean(vendorEmail) }
            )
          }
        } else {
          const { data: tokenForVendor } = await supabase
            .from("rfp_magic_tokens")
            .select("vendor_email, vendor_name")
            .eq("response_id", id)
            .maybeSingle()
          vendorEmail = (tokenForVendor?.vendor_email as string | null) || null
          vendorContactName = (tokenForVendor?.vendor_name as string | null) || null
          vendorDisplayName = vendorContactName || vendorEmail || "Vendor"

          // H3: vendor_org_id was captured once at guest-submission time from an email->profile
          // match at that moment (app/api/rfp/guest/[token]/route.ts) and is never re-checked
          // later - so a vendor who creates/links an account AFTER submitting still resolves
          // as a "pure guest" here otherwise, producing a vendor_org_id-null partnership that
          // never surfaces on My Bids or Delivery & Projects even after they have an account.
          // Re-check by email now, and backfill the response row so this is fixed going
          // forward too, not just for this one award.
          if (vendorEmail) {
            // BOTH READS IN THIS BLOCK RUN ON THE SERVICE CLIENT, AND THEY HAVE TO.
            // They are counterparty identity questions, not visibility questions, and every
            // policy on both tables answers them with zero rows for a session client:
            //   - profiles: `id = auth.uid() OR id IN (current_user_visible_profile_ids())`,
            //     and that set is derived from partnerships rows only (079:721-728, 766-777).
            //     No partnership exists yet - that is why this code is running - so a vendor
            //     resolves only when is_discoverable = true.
            //   - org_members: `user_id = auth.uid()` (079:1736-1738) or
            //     `org_id IN (current_user_org_ids())` (086:148-150). Neither ever admits a
            //     counterparty's roster.
            // On the session client resolveOrgIdForUser() therefore returned null for EVERY
            // vendor, so matchedVendorOrgId was always null, the vendor_org_id upgrade never
            // fired, the response backfill never ran, and this path logged "belongs to no
            // organization" for vendors that plainly do. Dead code with a misleading log line.
            // The caller is an authenticated, role-checked agency user and vendorEmail is an
            // address that agency itself invited; nothing read here reaches the response.
            const identityClient = getServiceSupabase()
            if (!identityClient) {
              console.error("[api] bid award: SUPABASE_SERVICE_ROLE_KEY absent - vendor org re-link falls back to the session client and will not resolve", {
                route,
                responseId: id,
              })
            }
            const vendorIdentityClient = identityClient ?? supabase
            const { data: matchedProfile, error: matchedProfileErr } = await vendorIdentityClient
              .from("profiles")
              .select("id")
              .ilike("email", vendorEmail)
              .maybeSingle()
            if (matchedProfileErr) {
              // Includes PGRST116 when two profiles share an address - visible now that the
              // read is not silently narrowed to one row by RLS. Non-fatal: the award falls
              // through to the guest shape rather than guessing which profile is the vendor.
              console.error("[api] bid award: vendor profile lookup by email failed (non-fatal, staying a guest)", {
                route,
                responseId: id,
                message: matchedProfileErr.message,
                code: matchedProfileErr.code,
              })
            }
            // 079 PARAMETER CLASS: `matchedProfile.id` is a profiles id, and BOTH columns it
            // reached are organization columns that REFERENCE organizations(id) -
            // partner_rfp_responses.vendor_org_id in the backfill below, and
            // partnerships.vendor_org_id through partnerIdForResolution. Correct by accident
            // for the accounts 079 backfilled, a 23503 for a vendor whose account postdates
            // it. Resolved through org_members, the same crossing
            // app/api/agency/rfp/magic-link/route.ts makes for the identical question.
            //
            // A matched profile that belongs to NO organization is left as a pure guest -
            // vendor_org_id stays null and the resolver's email branch claims the row later -
            // rather than writing a user id into a foreign key. That is the state the product
            // already understands; a bad key is not.
            const matchedVendorOrgId = matchedProfile?.id
              ? await resolveOrgIdForUser(matchedProfile.id as string, vendorIdentityClient)
              : null
            if (matchedProfile?.id && !matchedVendorOrgId) {
              console.error("[api] bid award: vendor matched by email belongs to no organization, staying a guest", {
                route,
                responseId: id,
                matchedProfileId: matchedProfile.id,
              })
            }
            if (matchedVendorOrgId) {
              partnerIdForResolution = matchedVendorOrgId
              const { error: backfillErr } = await supabase
                .from("partner_rfp_responses")
                .update({ vendor_org_id: matchedVendorOrgId })
                .eq("id", id)
                .in("lead_org_id", callerOrgIds)
                .is("vendor_org_id", null)
              if (backfillErr) {
                console.error("[api] bid award: response vendor_org_id backfill failed (non-fatal)", {
                  route,
                  responseId: id,
                  message: backfillErr.message,
                })
              }
            }
          }
        }

        // 079 PARAMETER CLASS: partnerships.lead_org_id REFERENCES organizations(id) and
        // this passed `user.id`, a profiles id. `existing.lead_org_id` was fetched under
        // `.in("lead_org_id", callerOrgIds)`, so it is provably one of the caller's own
        // organizations - the same crossing the three recordMilestone calls in this file
        // already make.
        const leadOrgId = orgIdFromColumn(existing.lead_org_id)
        if (!leadOrgId) {
          console.error("[api] bid award: response carries no lead_org_id - refusing award", {
            route,
            responseId: id,
            inbox_item_id: existing.inbox_item_id,
          })
          // Named for what it is. This refusal used to be reported with the vendor-side
          // message below, which sent agencies to look at the bidder's account for a
          // problem that was on their own side of the row.
          return NextResponse.json(
            {
              error:
                "Cannot award this bid: it is not linked to your agency's organization record, so the partnership cannot be created. Contact support with this bid's link.",
            },
            { status: 500 }
          )
        }

        const resolution = await resolvePartnershipForAward(supabase, {
          agencyId: leadOrgId,
          partnerIdForResolution,
          vendorEmail,
          vendorDisplayName,
          vendorContactName,
        })
        if ("error" in resolution) {
          console.error("[api] bid award: partnership resolution failed", {
            route,
            responseId: id,
            inbox_item_id: existing.inbox_item_id,
            inboxId: inboxRow.id,
            projectId,
            partnerIdForResolution,
            vendorEmail,
            message: resolution.error,
          })
          // The resolver refuses for two unrelated reasons and they are not the same news:
          // there is no vendor identity to form a relationship WITH, or forming it failed at
          // the database. Only the first is about the vendor's account, so only the first
          // says so.
          const noVendorIdentity = !partnerIdForResolution && !vendorEmail
          return NextResponse.json(
            {
              error: noVendorIdentity
                ? "Cannot award this bid: no vendor account or email is linked to it, so no relationship could be established."
                : "Cannot award this bid: the partnership record could not be saved. Try again, and contact support if it keeps happening.",
            },
            { status: 500 }
          )
        }
        partnershipId = resolution.partnershipId
      }

      awardContext = {
        inbox: {
          id: inboxRow.id,
          scope_item_name: inboxRow.scope_item_name,
          master_rfp_json: inboxRow.master_rfp_json,
        },
        projectId,
        partnershipId,
      }
    }

    const { data: updated, error: updateErr } = await supabase
      .from("partner_rfp_responses")
      .update(patch)
      .eq("id", id)
      .in("lead_org_id", callerOrgIds)
      .select("*")
      .single()
    if (updateErr) {
      console.error("[api] failure", { route, method: "PATCH", userId: user.id, role: profile.role, code: updateErr.code, message: updateErr.message })
      return NextResponse.json({ error: "Failed to update bid response" }, { status: 500 })
    }

    // Guest (Lightning RFP Magic Link) submissions have no partner_rfp_inbox row — inbox_item_id
    // is null by design (see app/api/rfp/guest/[token]/route.ts). Skip the sync silently rather
    // than attempting a query with a null id and treating the no-op as a failure.
    // resolvedInboxItemId (not existing.inbox_item_id) so a G1-synthesized row linked during
    // award resolution above gets its status synced too, on this same request.
    if (resolvedInboxItemId) {
      const { error: inboxStatusErr } = await supabase
        .from("partner_rfp_inbox")
        .update({ status: mapResponseStatusToInboxStatus(nextStatus), updated_at: new Date().toISOString() })
        .eq("id", resolvedInboxItemId)
        .in("lead_org_id", callerOrgIds)
      if (inboxStatusErr) {
        console.error("[api] PATCH partner_rfp_inbox status sync failed", {
          route,
          responseId: id,
          inbox_item_id: resolvedInboxItemId,
          userId: user.id,
          nextStatus,
          message: inboxStatusErr.message,
          code: inboxStatusErr.code,
        })
        return NextResponse.json({ error: "Bid updated but inbox status sync failed." }, { status: 500 })
      }
    }

    /**
     * Milestones: bid.shortlist and bid.meeting_request.
     *
     * The two transitions on this route that send no mail, and until now the two that recorded
     * nothing either - the vendor's own bid moved and the only trace was a timestamp column
     * nobody renders. Both are on 080's vendor-visible whitelist and both already have a
     * render string in lib/activity-feed.ts, so the row lands on the vendor's feed the moment
     * it is written.
     *
     * PAYLOAD: `{ scope_item_name }` and nothing else. Specifically NOT a shortlist size, a
     * position, or a "3 of 11". How many vendors made the shortlist is the size of the field
     * this vendor is competing against - the same disclosure class as the recipient count
     * closed on 2026-08-20 - and the agency tells them that nowhere else in the product.
     *
     * Fires on the transition only: `isShortlisting` / `isRequestingMeeting` are the same
     * booleans that stamp shortlisted_at / meeting_requested_at above, so a re-save of an
     * already-shortlisted bid stamps nothing and records nothing. They are mutually exclusive,
     * so this block emits at most one row per request.
     *
     * Placed after the update, like the other three: an emitter observes an action that has
     * already succeeded, and recordMilestone() is fire-and-forget, so nothing here can change
     * the result of the status change it describes.
     */
    if (isShortlisting || isRequestingMeeting) {
      const { scopeItemName, partnershipId } = await resolveBidMilestoneContext(supabase, {
        responseId: id,
        // Guest / magic-link bids carry null here and are the common shape on this table -
        // the resolver falls through to rfp_magic_tokens for them.
        inboxItemId: (existing.inbox_item_id as string | null) ?? null,
        callerOrgIds,
        route,
      })

      await recordMilestone(supabase, {
        eventType: isShortlisting ? "bid.shortlist" : "bid.meeting_request",
        // 079 PARAMETER CLASS: `existing.lead_org_id` was fetched under
        // `.in("lead_org_id", callerOrgIds)`, so it is provably one of the caller's own
        // organizations - it clears both 080's org_id foreign key and the SELECT policy's
        // `org_id IN (SELECT public.current_user_org_ids())`. Identical argument to the three
        // recordMilestone calls already in this file.
        orgId: orgIdFromColumn(existing.lead_org_id),
        actorId: user.id,
        vendorOrgId: orgIdFromColumn(existing.vendor_org_id),
        partnershipId,
        // The same row id bid.award, bid.decline and bid.feedback key on, so the derived
        // union collapses all four onto one bid.
        subjectType: "bid",
        subjectId: id,
        payload: { scope_item_name: scopeItemName },
      })
    }

    if (shouldSendAgencyFeedbackEmail) {
      // Same broad fix as the inbox-status-sync block above: `.eq("id", null)` on a uuid
      // column errors rather than returning no rows, so guest bids (inbox_item_id null) must
      // skip this query entirely rather than attempt it.
      // 079: existing.vendor_org_id is an organization id. resolveOrgNotificationRecipients()
      // never rejects, so partnerErr is retained as null for the shape of the destructure and
      // an empty result is logged inside the resolver rather than skipped silently here.
      const [partnerRecipients, { data: inboxRow, error: inboxErr }] =
        await Promise.all([
          resolveOrgNotificationRecipients(existing.vendor_org_id, supabase),
          existing.inbox_item_id
            ? supabase
                .from("partner_rfp_inbox")
                // partnership_id is selected for the bid.feedback milestone below: it is what
                // makes the event reachable by the vendor whose bid was reviewed.
                .select("scope_item_name, partnership_id")
                .eq("id", existing.inbox_item_id)
                .in("lead_org_id", callerOrgIds)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null }),
        ])

      const partner = partnerRecipients[0] ?? null
      if (partnerRecipients.length === 0) {
        console.error("[api] feedback email: no notification recipients for the vendor organization", {
          route,
          responseId: id,
          vendorOrgId: existing.vendor_org_id,
        })
      }
      if (inboxErr) {
        console.error("[api] feedback email: inbox select failed", {
          route,
          responseId: id,
          inbox_item_id: existing.inbox_item_id,
          message: inboxErr.message,
          code: inboxErr.code,
        })
      }

      // A guest / magic-link bid has no inbox row to have selected anything from, so the
      // scope title AND the partnership both come back null above. Both exist elsewhere -
      // see resolveGuestBidContext(). Only consulted when there is no inbox row at all: a
      // real one is authoritative even where its own scope_item_name is blank.
      const guest = inboxRow ? null : await resolveGuestBidContext(supabase, { responseId: id, callerOrgIds, route })

      const scopeName = (inboxRow?.scope_item_name ?? guest?.scopeItemName)?.trim?.() || ""
      const agencyName = profile.company_name || profile.full_name || "Lead agency"
      const feedbackSubject = scopeName
        ? `Feedback received on your bid for ${scopeName}`
        : "Feedback received on your recent bid submission"
      const baseUrl = siteBaseUrl()
      if (partner?.email) {
        try {
          const partnerRecipient =
            partner.company_name?.trim() || partner.full_name?.trim() || partner.email.trim()
          await sendTransactionalEmail({
            to: partner.email,
            cc: "hello@withligament.com",
            subject: feedbackSubject,
            html: buildBrandedEmailHtml({
              title: "Feedback on your bid",
              recipientName: partnerRecipient,
              body: `${agencyName} has reviewed your bid for ${scopeName || "this scope"} and left feedback for your consideration.\n\nLog in to your Ligament vendor portal to view the feedback and update your submission if needed.`,
              ctaText: "View Feedback",
              ctaUrl: `${baseUrl}/partner/rfps/${existing.inbox_item_id}`,
            }),
          })
        } catch (emailErr) {
          console.error("[api] feedback email: Resend send failed", {
            route,
            responseId: id,
            message: emailErr instanceof Error ? emailErr.message : String(emailErr),
          })
        }
      }

      // Milestone: bid.feedback. The single clearest case for attribution in the product -
      // the vendor is reading a human judgement that today is signed by nobody. Vendor
      // visible by whitelist, and the actor is NAMED to them; the actor's email address is
      // not in this row and must never be joined into a vendor-facing render.
      // 079: user.id is the acting company.
      await recordMilestone(supabase, {
        eventType: "bid.feedback",
        // 079 PARAMETER CLASS: milestone_events.org_id is an organization column, and as of
        // applied-080 it carries milestone_events_org_id_org_fkey REFERENCES
        // organizations(id). A user id written here therefore raises 23503; it is no longer
        // the silent defect this comment used to describe. Visibility is the second gate,
        // and the policy reads `org_id IN (SELECT public.current_user_org_ids())` - IN
        // (SELECT ...), not `= ANY (...)`, which raises 42809 on a SETOF-returning function.
        // `existing.lead_org_id` was fetched under `.in("lead_org_id", callerOrgIds)`, so it
        // is provably one of the caller's own organizations and clears both gates.
        orgId: orgIdFromColumn(existing.lead_org_id),
        actorId: user.id,
        vendorOrgId: orgIdFromColumn(existing.vendor_org_id),
        partnershipId: (inboxRow?.partnership_id as string | null) ?? guest?.partnershipId ?? null,
        subjectType: "bid",
        subjectId: id,
        payload: { scope_item_name: scopeName || null, status: nextStatus },
      })
    }

    if (awardContext) {
      const now = new Date().toISOString()
      // Select-then-insert-or-update rather than .upsert(..., {onConflict}) — an onConflict
      // upsert requires a real UNIQUE(project_id, partnership_id) constraint in the DB to
      // target, and this table predates the migration log (no CREATE TABLE on disk to confirm
      // one exists). This matches the pattern already used for project_assignments writes in
      // app/api/projects/[id]/assignments/route.ts and does not depend on that constraint.
      const { data: existingAssignment, error: paLookupErr } = await supabase
        .from("project_assignments")
        .select("id")
        .eq("project_id", awardContext.projectId)
        .eq("partnership_id", awardContext.partnershipId)
        .maybeSingle()

      const paErr = paLookupErr
        ? paLookupErr
        : existingAssignment
          ? (
              await supabase
                .from("project_assignments")
                .update({ status: "awarded", awarded_at: now, updated_at: now })
                .eq("id", existingAssignment.id)
            ).error
          : (
              await supabase.from("project_assignments").insert({
                project_id: awardContext.projectId,
                partnership_id: awardContext.partnershipId,
                status: "awarded",
                awarded_at: now,
                updated_at: now,
              })
            ).error

      if (paErr) {
        console.error("[api] bid award: project_assignments write failed", {
          route,
          responseId: id,
          projectId: awardContext.projectId,
          partnershipId: awardContext.partnershipId,
          message: paErr.message,
          code: paErr.code,
        })
        return NextResponse.json(
          {
            error:
              "Bid status was updated but recording the project assignment failed. Retry the award or fix the assignment row; check server logs.",
          },
          { status: 500 }
        )
      }

      // Move project out of pre-award states once work is awarded.
      // (CHECK on projects.status allows "active"; constraint does not allow "in_progress")
      const preAwardStatuses = new Set(["draft", "onboarding"])
      const { data: projRow, error: projLoadErr } = await supabase
        .from("projects")
        .select("status")
        .eq("id", awardContext.projectId)
        .in("org_id", callerOrgIds)
        .maybeSingle()
      if (projLoadErr) {
        console.error("[api] bid award: load project status failed (assignment recorded)", {
          route,
          projectId: awardContext.projectId,
          message: projLoadErr.message,
          code: projLoadErr.code,
        })
      } else if (projRow && preAwardStatuses.has(String(projRow.status || "").toLowerCase())) {
        const { error: projUpdErr } = await supabase
          .from("projects")
          .update({ status: "active", updated_at: now })
          .eq("id", awardContext.projectId)
          .in("org_id", callerOrgIds)
        if (projUpdErr) {
          console.error("[api] bid award: project status bump failed (assignment recorded)", {
            route,
            projectId: awardContext.projectId,
            message: projUpdErr.message,
            code: projUpdErr.code,
          })
        }
      }

      // 079: organization recipients, not a profile row of the same id.
      const awardRecipients = await resolveOrgNotificationRecipients(existing.vendor_org_id, supabase)
      const partner = awardRecipients[0] ?? null
      if (awardRecipients.length === 0) {
        console.error("[api] bid award: no notification recipients for the vendor organization", {
          route,
          responseId: id,
          vendorOrgId: existing.vendor_org_id,
        })
      }

      const rawProjectName =
        (awardContext.inbox.master_rfp_json as Record<string, unknown> | null)?.projectName?.toString?.() || ""
      const rawScopeItemName = awardContext.inbox.scope_item_name?.trim?.() || ""
      const projectName = rawProjectName || "Project"
      const scopeItemName = rawScopeItemName || "Scope item"
      const leadAgencyName = profile.company_name || profile.full_name || "Lead agency"
      const awardSubject =
        rawScopeItemName && rawProjectName
          ? `You've been awarded ${scopeItemName} - ${projectName}`
          : "You've been selected for this project"
      const baseUrl = siteBaseUrl()
      if (partner?.email) {
        try {
          const partnerRecipient =
            partner.company_name?.trim() || partner.full_name?.trim() || partner.email.trim()
          await sendTransactionalEmail({
            to: partner.email,
            cc: "hello@withligament.com",
            subject: awardSubject,
            html: buildBrandedEmailHtml({
              title: "You have been awarded",
              recipientName: partnerRecipient,
              body: `Congratulations, ${leadAgencyName} has selected your bid for ${scopeItemName}.\n\nYou are officially on board for ${projectName}. Expect onboarding materials from ${leadAgencyName} shortly with next steps, kickoff details, and project documents.`,
              ctaText: "View Project",
              ctaUrl: `${baseUrl}/partner/rfps`,
            }),
          })
        } catch (emailErr) {
          console.error("[api] bid award: Resend send failed (award already recorded)", {
            route,
            responseId: id,
            message: emailErr instanceof Error ? emailErr.message : String(emailErr),
          })
        }
      }

      if (existing.vendor_org_id) {
        try {
          await notifyProjectAwarded(supabase, existing.vendor_org_id, projectName, leadAgencyName, awardContext.projectId)
        } catch (notifyErr) {
          console.error("[api] bid award: in-app notification failed (award already recorded)", {
            route,
            responseId: id,
            message: notifyErr instanceof Error ? notifyErr.message : String(notifyErr),
          })
        }
      }

      // Milestone: bid.award. Emitted last, after the assignment row, the project status
      // bump, the mail and the in-app notification, so the breadcrumb cannot claim an award
      // that did not happen. Vendor visible by whitelist - the vendor already knows they were
      // awarded; what this adds is which person at the agency decided it.
      // 079: user.id is the acting company.
      await recordMilestone(supabase, {
        eventType: "bid.award",
        // 079 PARAMETER CLASS: milestone_events.org_id is an organization column, and as of
        // applied-080 it carries milestone_events_org_id_org_fkey REFERENCES
        // organizations(id). A user id written here therefore raises 23503; it is no longer
        // the silent defect this comment used to describe. Visibility is the second gate,
        // and the policy reads `org_id IN (SELECT public.current_user_org_ids())` - IN
        // (SELECT ...), not `= ANY (...)`, which raises 42809 on a SETOF-returning function.
        // `existing.lead_org_id` was fetched under `.in("lead_org_id", callerOrgIds)`, so it
        // is provably one of the caller's own organizations and clears both gates.
        orgId: orgIdFromColumn(existing.lead_org_id),
        actorId: user.id,
        vendorOrgId: orgIdFromColumn(existing.vendor_org_id),
        partnershipId: awardContext.partnershipId,
        subjectType: "bid",
        subjectId: id,
        payload: {
          project_id: awardContext.projectId,
          // `rawProjectName`, not `projectName`, for exactly the reason given below about
          // the scope title - `projectName` is the EMAIL's placeholder ("Project"). Nothing
          // renders this field today (lib/activity-feed.ts resolves the project name from
          // project_id and never from a payload, and payloadString reads only
          // scope_item_name), so this is not a visible defect. It is fixed anyway: the
          // payload of a whitelisted event type is counterparty-readable in full, so this
          // row currently tells a vendor their project is called "Project", and the next
          // reader of the field would inherit the same trap the scope title just sprang.
          project_name: rawProjectName || null,
          // `rawScopeItemName`, not `scopeItemName`. The two differ only when the name could
          // not be resolved, and that is exactly the case that matters: `scopeItemName` is
          // the EMAIL's placeholder ("Scope item"), and storing it here would hand the feed
          // a string that looks like a real title, so lib/activity-feed.ts renders
          // "awarded the bid on Scope item" instead of taking its own "a scope item"
          // fallback. Null is the honest value, and it is what bid.decline and bid.feedback
          // already write.
          scope_item_name: rawScopeItemName || null,
        },
      })
    }

    if (isDeclining) {
      // Same broad fix as above - guest bids (inbox_item_id null) must skip this query
      // entirely rather than send `.eq("id", null)`, which errors on a uuid column.
      // 079: organization recipients, not a profile row of the same id.
      const [declineRecipients, inboxRes] = await Promise.all([
        resolveOrgNotificationRecipients(existing.vendor_org_id, supabase),
        existing.inbox_item_id
          ? supabase
              .from("partner_rfp_inbox")
              // partnership_id is selected for the bid.decline milestone below.
              .select("scope_item_name, master_rfp_json, partnership_id")
              .eq("id", existing.inbox_item_id)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ])
      const partner = declineRecipients[0] ?? null
      const inbox = inboxRes.data
      if (declineRecipients.length === 0) {
        console.error("[api] decline email: no notification recipients for the vendor organization", {
          route,
          responseId: id,
          vendorOrgId: existing.vendor_org_id,
        })
      }
      if (inboxRes.error) {
        console.error("[api] decline email: partner_rfp_inbox select failed", {
          route,
          responseId: id,
          inbox_item_id: existing.inbox_item_id,
          message: inboxRes.error.message,
          code: inboxRes.error.code,
        })
      }
      // THE BUG THIS FIXES. `existing.inbox_item_id` is null on every guest / magic-link bid,
      // so the query above was skipped entirely and `inbox` was null - which is how the
      // milestone came out as {"scope_item_name": null} and the mail went out titled
      // "Update on your recent bid submission" for a scope that has a perfectly good name on
      // its rfp_magic_tokens row. Same resolution the award path has always used.
      const guest = inbox ? null : await resolveGuestBidContext(supabase, { responseId: id, callerOrgIds, route })

      const rawProjectName =
        ((inbox?.master_rfp_json ?? guest?.masterRfpJson) as Record<string, unknown> | null)?.projectName?.toString?.() || ""
      const rawScopeItemName = (inbox?.scope_item_name ?? guest?.scopeItemName)?.trim?.() || ""
      const projectName = rawProjectName || "Project"
      const scopeItemName = rawScopeItemName || "Scope item"
      const partnerName = partner?.company_name || partner?.full_name || partner?.email || "Vendor"
      const leadAgencyName = profile.company_name || profile.full_name || "Lead agency"
      const declineSubject = rawScopeItemName
        ? `Update on your bid for ${scopeItemName}`
        : "Update on your recent bid submission"
      const baseUrl = siteBaseUrl()
      if (partner?.email) {
        try {
          let declineBody = `Thank you for submitting your bid. After careful review, ${leadAgencyName} has decided to move forward with another vendor for this scope.\n\nWe appreciate your time and the quality of your submission. We hope to work together on a future project.`
          if (declineReason && String(declineReason).trim()) {
            declineBody += `\n\nReason: ${String(declineReason).trim()}`
          }
          await sendTransactionalEmail({
            to: partner.email,
            cc: "hello@withligament.com",
            subject: declineSubject,
            html: buildBrandedEmailHtml({
              title: "Update on your bid",
              recipientName: partnerName,
              body: declineBody,
              ctaText: "View Update",
              ctaUrl: `${baseUrl}/partner/rfps`,
            }),
          })
        } catch (emailErr) {
          console.error("[api] decline: Resend send failed", {
            route,
            responseId: id,
            message: emailErr instanceof Error ? emailErr.message : String(emailErr),
          })
        }
      }

      // Milestone: bid.decline. Vendor visible by whitelist. The decline reason is
      // deliberately NOT in the payload: it is already composed into agency_feedback and
      // mailed, and duplicating it here would put the same sentence under two different
      // read rules. 079: user.id is the acting company.
      await recordMilestone(supabase, {
        eventType: "bid.decline",
        // 079 PARAMETER CLASS: milestone_events.org_id is an organization column, and as of
        // applied-080 it carries milestone_events_org_id_org_fkey REFERENCES
        // organizations(id). A user id written here therefore raises 23503; it is no longer
        // the silent defect this comment used to describe. Visibility is the second gate,
        // and the policy reads `org_id IN (SELECT public.current_user_org_ids())` - IN
        // (SELECT ...), not `= ANY (...)`, which raises 42809 on a SETOF-returning function.
        // `existing.lead_org_id` was fetched under `.in("lead_org_id", callerOrgIds)`, so it
        // is provably one of the caller's own organizations and clears both gates.
        orgId: orgIdFromColumn(existing.lead_org_id),
        actorId: user.id,
        vendorOrgId: orgIdFromColumn(existing.vendor_org_id),
        partnershipId: (inbox?.partnership_id as string | null) ?? guest?.partnershipId ?? null,
        subjectType: "bid",
        subjectId: id,
        payload: {
          scope_item_name: rawScopeItemName || null,
          had_reason: Boolean(declineReason && String(declineReason).trim()),
        },
      })
    }

    console.log("[api] success", {
      route,
      method: "PATCH",
      userId: user.id,
      role: profile.role,
      responseId: id,
      fromStatus: existing.status,
      toStatus: nextStatus,
      feedbackUpdated: body.agency_feedback !== undefined || !!declineReason,
    })
    return NextResponse.json({ response: updated })
  } catch (error) {
    console.error("[api] failure", {
      route,
      method: "PATCH",
      code: 500,
      message: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
