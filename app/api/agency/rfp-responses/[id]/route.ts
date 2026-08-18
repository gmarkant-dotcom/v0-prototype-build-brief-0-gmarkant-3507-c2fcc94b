import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildBrandedEmailHtml, resolveOrgNotificationRecipients, sendTransactionalEmail, siteBaseUrl } from "@/lib/email"
import { notifyProjectAwarded } from "@/lib/notifications"
import { resolvePartnershipForAward } from "@/lib/award-partnership-resolution"
import { mapResponseStatusToInboxStatus } from "@/lib/bid-status"
import { can, capabilityDeniedMessage } from "@/lib/capabilities"
import { recordMilestone } from "@/lib/milestone-events"

export const dynamic = "force-dynamic"

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
      .eq("lead_org_id", user.id)
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
     * `.eq("lead_org_id", user.id)`, which is ownership - and 079 turns ownership into
     * membership, at which point every colleague passes it identically and this is the only
     * thing left that can distinguish an admin from a member. All three resolve true for
     * everyone today.
     */
    const isAwarding = existing.status !== "awarded" && nextStatus === "awarded"
    const isDeclining = existing.status !== "declined" && nextStatus === "declined"
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
    if (existing.status !== "shortlisted" && nextStatus === "shortlisted") {
      patch.shortlisted_at = patch.updated_at
    }
    if (existing.status !== "meeting_requested" && nextStatus === "meeting_requested") {
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
        scope_item_name: string | null
        master_rfp_json: unknown
      }
      let inboxRow: InboxForAward | null = null

      if (resolvedInboxItemId) {
        const { data, error: inboxFetchErr } = await supabase
          .from("partner_rfp_inbox")
          .select("id, project_id, vendor_org_id, partnership_id, scope_item_name, master_rfp_json")
          .eq("id", resolvedInboxItemId)
          .eq("lead_org_id", user.id)
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
            .select("id, project_id, vendor_org_id, partnership_id, scope_item_name, master_rfp_json")
            .eq("lead_org_id", user.id)
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
              .eq("lead_org_id", user.id)
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
      let partnerIdForResolution = (inboxRow.vendor_org_id as string | null) || existing.vendor_org_id

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
            const { data: matchedProfile } = await supabase
              .from("profiles")
              .select("id")
              .ilike("email", vendorEmail)
              .maybeSingle()
            if (matchedProfile?.id) {
              partnerIdForResolution = matchedProfile.id as string
              const { error: backfillErr } = await supabase
                .from("partner_rfp_responses")
                .update({ vendor_org_id: matchedProfile.id })
                .eq("id", id)
                .eq("lead_org_id", user.id)
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

        const resolution = await resolvePartnershipForAward(supabase, {
          agencyId: user.id,
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
          return NextResponse.json(
            { error: "Cannot award this bid: no vendor account or email is linked to it, so no relationship could be established." },
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
      .eq("lead_org_id", user.id)
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
        .eq("lead_org_id", user.id)
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
                .eq("lead_org_id", user.id)
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

      const scopeName = inboxRow?.scope_item_name?.trim?.() || ""
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
        orgId: user.id,
        actorId: user.id,
        vendorOrgId: (existing.vendor_org_id as string | null) ?? null,
        partnershipId: (inboxRow?.partnership_id as string | null) ?? null,
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
        .eq("org_id", user.id)
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
          .eq("org_id", user.id)
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
        orgId: user.id,
        actorId: user.id,
        vendorOrgId: (existing.vendor_org_id as string | null) ?? null,
        partnershipId: awardContext.partnershipId,
        subjectType: "bid",
        subjectId: id,
        payload: {
          project_id: awardContext.projectId,
          project_name: projectName,
          scope_item_name: scopeItemName,
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
      const rawProjectName =
        (inbox?.master_rfp_json as Record<string, unknown> | null)?.projectName?.toString?.() || ""
      const rawScopeItemName = inbox?.scope_item_name?.trim?.() || ""
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
        orgId: user.id,
        actorId: user.id,
        vendorOrgId: (existing.vendor_org_id as string | null) ?? null,
        partnershipId: (inbox?.partnership_id as string | null) ?? null,
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
