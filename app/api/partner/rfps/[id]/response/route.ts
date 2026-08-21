import { resolveCallerOrgIds, resolveCallerWriteOrgId, orgIdsFromColumns, orgIdFromColumn } from "@/lib/entitlements"
import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { partnerCanAccessPartnerRfpInbox } from "@/lib/partner-inbox-access"
import { isBudgetValidForSubmit, isTimelineValidForSubmit, formatBudgetForDisplay, formatTimelineForDisplay } from "@/lib/rfp-response-fields"
import { buildAgencyBidNotificationEmail, resolveOrgNotificationRecipients, sendTransactionalEmail } from "@/lib/email"
import { withBusinessCriteriaDefaults, normalizeAcknowledgments } from "@/lib/business-criteria"
import { normalizeBudgetLines } from "@/lib/budget-categories"
import { buildProposalSectionsForSave, normalizeProposalSections } from "@/lib/proposal-sections"
import { isBiddingClosed, BIDDING_CLOSED_API_MESSAGE } from "@/lib/bid-close"
import { generateAndSaveBidSummary } from "@/lib/bid-summary-generation"
import { validateTermsDisclosure, isTermsDisclosureStarted, withTermsDisclosureDefaults } from "@/lib/terms-disclosure"
import { notifyBidSubmitted } from "@/lib/notifications"
import { recordMilestone } from "@/lib/milestone-events"

export const dynamic = "force-dynamic"

type Body = {
  proposal_text?: string
  budget_proposal?: string
  timeline_proposal?: string
  terms_disclosure?: unknown
  attachments?: unknown
  business_criteria_responses?: unknown
  /** Cannot-meet acknowledgments (S4-1). Column added by migration 071 - see the write
   *  guard around `saveResponseRow` below for pre-migration safety. */
  business_criteria_acknowledgments?: unknown
  /** P2-1/P2-2. Absent on every request shaped like today's. */
  budget_lines?: unknown
  proposal_sections?: unknown
  status?: "draft" | "submitted"
  change_notes?: string
}

/**
 * Optional columns a not-yet-applied migration may not have created yet, newest migration
 * first. saveResponseRow drops them one at a time on Postgres undefined_column (42703), so a
 * partially-migrated database still persists everything it can actually hold rather than
 * failing the whole save or discarding every optional field at once.
 *   proposal_sections                  - migration 076 (P2-2)
 *   budget_lines                       - migration 072 (P2-1)
 *   business_criteria_acknowledgments  - migration 071 (S4-1), applied
 */
const OPTIONAL_RESPONSE_COLUMNS = ["proposal_sections", "budget_lines", "business_criteria_acknowledgments"] as const

async function saveResponseRow<T>(
  attempt: (row: Record<string, unknown>) => PromiseLike<{ data: T | null; error: { code?: string; message: string } | null }>,
  row: Record<string, unknown>
): Promise<{ data: T | null; error: { code?: string; message: string } | null }> {
  let current = row
  let result = await attempt(current)
  for (const column of OPTIONAL_RESPONSE_COLUMNS) {
    if (!result.error || result.error.code !== "42703") break
    if (!(column in current)) continue
    console.warn(`[partner/rfps/[id]/response] optional column missing, retrying without it - ${column}`)
    const { [column]: _omitted, ...rest } = current
    current = rest
    result = await attempt(current)
  }
  return result
}

const ALLOWED_TYPES = new Set([
  "work_example",
  "capabilities_overview",
  "proposal",
  "timeline",
  "budget",
  "other",
])

export type SavedAttachment = {
  type: string
  label: string
  url: string
}

function normalizeAttachments(raw: unknown): SavedAttachment[] {
  if (!Array.isArray(raw)) return []
  const out: SavedAttachment[] = []
  for (const item of raw.slice(0, 6)) {
    if (!item || typeof item !== "object") continue
    const o = item as Record<string, unknown>
    const type = String(o.type ?? "").trim()
    const url = String(o.url ?? "").trim()
    let label = String(o.label ?? "").trim()
    if (!ALLOWED_TYPES.has(type) || !url) continue
    if (type === "other") {
      if (!label) continue
    } else if (!label) {
      label = defaultLabelForType(type)
    }
    out.push({ type, label, url })
  }
  return out
}

function defaultLabelForType(type: string): string {
  switch (type) {
    case "work_example":
      return "Work Example"
    case "capabilities_overview":
      return "Capabilities Overview"
    case "proposal":
      return "Proposal"
    case "timeline":
      return "Timeline"
    case "budget":
      return "Budget"
    default:
      return type
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const route = "/api/partner/rfps/[id]/response"
    const { id: inboxId } = await params

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // 079: an organization column is not a user id. Reads scope to the caller's memberships.
    const callerOrgIds = await resolveCallerOrgIds(user.id, supabase)
    // 079: a write is attributed to the caller's OWN organization. Never a visibility set.
    const writeOrgId = await resolveCallerWriteOrgId(user.id, supabase)
    if (!writeOrgId) {
      return NextResponse.json({ error: "Your account is not linked to an organization yet" }, { status: 403 })
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, active_role, company_name, full_name, email")
      .eq("id", user.id)
      .single()
    console.log("[api] start", { route, method: "POST", userId: user.id, role: profile?.role ?? null })

    if (profile?.role !== "partner" && profile?.active_role !== "partner") {
      return NextResponse.json({ error: "Vendors only" }, { status: 403 })
    }

    const { data: inbox, error: inboxErr } = await supabase
      .from("partner_rfp_inbox")
      .select("id, lead_org_id, vendor_org_id, recipient_email, nda_gate_enforced, nda_confirmed_at, require_terms_disclosure")
      .eq("id", inboxId)
      .maybeSingle()

    if (inboxErr || !inbox) {
      return NextResponse.json({ error: "RFP not found or access denied" }, { status: 404 })
    }

    const access = partnerCanAccessPartnerRfpInbox(
      {
        vendor_org_id: (inbox.vendor_org_id as string | null) ?? null,
        recipient_email: (inbox.recipient_email as string | null) ?? null,
        nda_gate_enforced: (inbox.nda_gate_enforced as boolean | null) ?? false,
        nda_confirmed_at: (inbox.nda_confirmed_at as string | null) ?? null,
      },
      callerOrgIds,
      profile?.email
    )
    if (!access.allowed) {
      if (access.reason === "nda_required") {
        return NextResponse.json({ error: "nda_required", inboxItemId: inboxId }, { status: 403 })
      }
      return NextResponse.json({ error: "RFP not found or access denied" }, { status: 404 })
    }

    const body = (await req.json().catch(() => ({}))) as Body

    const status = body.status === "submitted" ? "submitted" : "draft"
    const proposal_text = (body.proposal_text ?? "").toString()
    const budget_proposal = (body.budget_proposal ?? "").toString()
    const timeline_proposal = (body.timeline_proposal ?? "").toString()
    const attachments = normalizeAttachments(body.attachments)
    const business_criteria_responses = withBusinessCriteriaDefaults(body.business_criteria_responses)
    // Write guard (S4-1): only carries acknowledgment data when the request actually sent
    // some - never invents an empty object on requests shaped like today's.
    // P2-1: never trust the client payload. normalizeBudgetLines returns null for anything
    // malformed, which is the same state as "this RFP has no categories".
    // P2-4 trust boundary. close_bidding_at_deadline is kept out of the inbox select above,
    // because selecting a column that does not exist yet errors the whole route - it is read
    // separately here, and a failed read means "open", which is today's behavior.
    const { data: closeConfig, error: closeErr } = await supabase
      .from("partner_rfp_inbox")
      .select("close_bidding_at_deadline, response_deadline")
      .eq("id", inboxId)
      .maybeSingle()
    if (closeErr && closeErr.code !== "42703") {
      console.warn("[partner/rfps/[id]/response] close-at-deadline config unavailable, treating RFP as open", {
        code: closeErr.code,
        message: closeErr.message,
      })
    }
    if (isBiddingClosed(closeConfig)) {
      return NextResponse.json({ error: BIDDING_CLOSED_API_MESSAGE }, { status: 403 })
    }

    const budget_lines = normalizeBudgetLines(body.budget_lines)
    const proposal_sections = buildProposalSectionsForSave(normalizeProposalSections(body.proposal_sections))
    const hasAcknowledgments = body.business_criteria_acknowledgments != null
    const business_criteria_acknowledgments = hasAcknowledgments
      ? normalizeAcknowledgments(body.business_criteria_acknowledgments)
      : null
    const changeNotes = (body.change_notes ?? "").toString().trim()

    if (status === "submitted") {
      if (!proposal_text.trim()) {
        console.error("[api] failure", { route, method: "POST", userId: user.id, role: profile?.role ?? null, code: 400, message: "Proposal text is required to submit" })
        return NextResponse.json({ error: "Proposal text is required to submit" }, { status: 400 })
      }
      if (!isBudgetValidForSubmit(budget_proposal)) {
        console.error("[api] failure", { route, method: "POST", userId: user.id, role: profile?.role ?? null, code: 400, message: "Budget proposal is required to submit" })
        return NextResponse.json(
          {
            error: "Budget proposal is required to submit",
            detail: "Enter a positive amount and currency (or use a valid saved value).",
          },
          { status: 400 }
        )
      }
      if (!isTimelineValidForSubmit(timeline_proposal)) {
        console.error("[api] failure", { route, method: "POST", userId: user.id, role: profile?.role ?? null, code: 400, message: "Timeline proposal is required to submit" })
        return NextResponse.json(
          {
            error: "Timeline proposal is required to submit",
            detail: "Enter a positive duration and unit (Days, Weeks, or Months).",
          },
          { status: 400 }
        )
      }
    }

    // Trust boundary: the client only blocks submission client-side, so re-validate here
    // regardless of what the form sent. Drafts never block on terms completeness, matching
    // the proposal/budget/timeline checks above.
    const termsRequired = status === "submitted" && inbox.require_terms_disclosure === true
    const termsValidation = validateTermsDisclosure(body.terms_disclosure, termsRequired)
    if (!termsValidation.ok) {
      console.error("[api] failure", { route, method: "POST", userId: user.id, role: profile?.role ?? null, code: 400, message: "Invalid terms disclosure", errors: termsValidation.errors })
      return NextResponse.json({ error: "Please complete the required term disclosures", detail: termsValidation.errors }, { status: 400 })
    }
    const parsedTermsDisclosure = withTermsDisclosureDefaults(body.terms_disclosure)
    const terms_disclosure =
      status === "submitted"
        ? termsValidation.value
        : isTermsDisclosureStarted(parsedTermsDisclosure)
          ? parsedTermsDisclosure
          : null

    const partner_display_name =
      profile.company_name?.trim() ||
      profile.full_name?.trim() ||
      profile.email?.trim() ||
      "Vendor"

    const row = {
      proposal_text,
      budget_proposal,
      timeline_proposal,
      terms_disclosure,
      attachments,
      business_criteria_responses,
      partner_display_name,
      status,
      updated_at: new Date().toISOString(),
      ...(hasAcknowledgments ? { business_criteria_acknowledgments } : {}),
      ...(budget_lines ? { budget_lines } : {}),
      ...(proposal_sections ? { proposal_sections } : {}),
    }

    const insertRow = {
      inbox_item_id: inboxId,
      vendor_org_id: writeOrgId,
      lead_org_id: inbox.lead_org_id,
      ...row,
    }

    const { data: existing } = await supabase
      .from("partner_rfp_responses")
      .select("id")
      .eq("inbox_item_id", inboxId)
      .in("vendor_org_id", callerOrgIds)
      .maybeSingle()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let saved: any
    let wasUpdate = false
    if (existing?.id) {
      wasUpdate = true
      const { data, error } = await saveResponseRow(
        (attemptRow) => supabase.from("partner_rfp_responses").update(attemptRow).eq("id", existing.id).select().single(),
        row
      )
      if (error) {
        console.error("[api] failure", { route, method: "POST", userId: user.id, role: profile?.role ?? null, code: 500, message: error.message })
        return NextResponse.json(
          { error: error.message, detail: error.code ? `code=${error.code}` : undefined },
          { status: 500 }
        )
      }
      saved = data
    } else {
      const { data, error } = await saveResponseRow(
        (attemptRow) => supabase.from("partner_rfp_responses").insert(attemptRow).select().single(),
        insertRow
      )
      if (error) {
        console.error("[api] failure", { route, method: "POST", userId: user.id, role: profile?.role ?? null, code: 500, message: error.message })
        return NextResponse.json(
          { error: error.message, detail: error.code ? `code=${error.code}` : undefined },
          { status: 500 }
        )
      }
      saved = data
    }
    if (!saved) {
      console.error("[api] failure", { route, method: "POST", userId: user.id, role: profile?.role ?? null, code: 500, message: "Save returned no row" })
      return NextResponse.json({ error: "Save failed" }, { status: 500 })
    }

    if (status === "submitted") {
      await supabase
        .from("partner_rfp_inbox")
        .update({ status: "bid_submitted", updated_at: new Date().toISOString() })
        .eq("id", inboxId)

      const { data: latestVersion } = await supabase
        .from("partner_rfp_response_versions")
        .select("version_number")
        .eq("response_id", saved.id)
        .order("version_number", { ascending: false })
        .limit(1)
        .maybeSingle()
      const nextVersion = Number(latestVersion?.version_number || 0) + 1
      const versionInsertPayload = {
        response_id: saved.id,
        vendor_org_id: writeOrgId,
        lead_org_id: inbox.lead_org_id,
        version_number: nextVersion,
      }
      const { error: versionErr } = await supabase.from("partner_rfp_response_versions").insert({
        ...versionInsertPayload,
        proposal_text,
        budget_proposal,
        timeline_proposal,
        attachments,
        status_at_submission: status,
        change_notes: changeNotes || null,
      })
      if (versionErr) {
        console.error("[api] version insert failed", {
          route,
          method: "POST",
          userId: user.id,
          responseId: saved.id,
          versionNumber: nextVersion,
          code: versionErr.code,
          message: versionErr.message,
        })
      }

      // Fire-and-forget: AI summary generation must never fail the bid submission itself.
      void generateAndSaveBidSummary(supabase, saved.id, orgIdsFromColumns(inbox.lead_org_id)).catch((err) => {
        console.error("[api] fire-and-forget summary generation failed", {
          route,
          responseId: saved.id,
          message: err instanceof Error ? err.message : String(err),
        })
      })

      // Agency notification (email + in-app) on every submitted transition - initial
      // submission previously sent nothing at all here (only revisions did); both now
      // notify the same way the guest/magic-link path does, via the shared email builder.
      // 079: inbox.lead_org_id is an ORGANISATION id, resolved to that organization's
      // notification recipients. This send is guarded by `if (agencyProfile?.email)`, so
      // the pre-079 lookup would have failed silently for a new organization.
      const [agencyRecipients, { data: inboxDetail }] = await Promise.all([
        resolveOrgNotificationRecipients(inbox.lead_org_id, supabase),
        supabase.from("partner_rfp_inbox").select("scope_item_name, master_rfp_json").eq("id", inboxId).maybeSingle(),
      ])
      if (agencyRecipients.length === 0) {
        console.error("[api] bid submit: no notification recipients for the lead agency", {
          inboxId,
          leadOrgId: inbox.lead_org_id,
        })
      }
      const agencyProfile = agencyRecipients[0] ?? null
      const projectName =
        (inboxDetail?.master_rfp_json as Record<string, unknown> | null)?.projectName?.toString?.() || "Project"
      const scopeItemName = inboxDetail?.scope_item_name || "Scope item"
      if (agencyProfile?.email) {
        try {
          const agencyRecipient =
            agencyProfile.company_name?.trim() ||
            agencyProfile.full_name?.trim() ||
            agencyProfile.email.trim()
          const notification = buildAgencyBidNotificationEmail({
            agencyRecipientName: agencyRecipient,
            vendorNameOrEmail: partner_display_name,
            projectName,
            scopeItemName,
            proposalText: proposal_text,
            budgetSummary: formatBudgetForDisplay(budget_proposal),
            timelineSummary: formatTimelineForDisplay(timeline_proposal),
            isRevision: wasUpdate,
          })
          await sendTransactionalEmail({ to: agencyProfile.email, cc: "hello@withligament.com", ...notification })
        } catch (emailErr) {
          console.error("[api] bid submission: agency notification email failed", {
            route,
            responseId: saved.id,
            message: emailErr instanceof Error ? emailErr.message : String(emailErr),
          })
        }
      } else {
        console.error("[api] bid submission: agency has no email on file, notification skipped", {
          route,
          agencyId: inbox.lead_org_id,
        })
      }
      try {
        await notifyBidSubmitted(supabase, inbox.lead_org_id, partner_display_name, scopeItemName, saved.id, wasUpdate)
      } catch (notifyErr) {
        console.error("[api] bid submission: in-app notification failed", {
          route,
          responseId: saved.id,
          message: notifyErr instanceof Error ? notifyErr.message : String(notifyErr),
        })
      }

      /**
       * Milestone: bid.submit, from the PORTAL. The first vendor-side write in the product
       * that RLS actually applies to.
       *
       * This route runs on a SESSION client, so unlike the guest path it goes through a
       * policy - "Vendors insert own company milestone events", authored in
       * supabase/migrations/088_vendor_milestone_events.sql and shipped in this same commit,
       * which is what 080:366-372 said would happen.
       *
       * IF 088 IS NOT APPLIED YET, THIS IS HARMLESS. Deny-by-default refuses the insert with
       * 42501, lib/milestone-events.ts catches it, logs at ERROR and returns void. The bid is
       * already saved by this point and nothing here can touch it. The cost of the window
       * between deploy and apply is lost breadcrumbs, nothing else - see ORDERING AGAINST THE
       * CODE in the migration.
       *
       * WHAT THE POLICY REQUIRES, AND WHY EACH FIELD IS WHAT IT IS:
       *   - actor_side "vendor", actor_id = auth.uid(). The policy demands the caller's own
       *     id and does NOT accept a null one; a null actor is the guest shape and this
       *     caller is not a guest.
       *   - NO actorEmail. The policy requires `actor_email IS NULL`, which is the writer's
       *     own rule (resolveActorEmail) made structural. An authenticated actor has a
       *     profile and never needs one stored.
       *   - org_id is the AGENCY. It is the column the agency's SELECT policy reads, so it is
       *     what puts this line on their dashboard. The acting company rides on vendor_org_id.
       *   - partnership_id is REQUIRED by the policy, which pins org_id through it. Resolved
       *     below, non-fatally: no partnership means no breadcrumb, never a failed bid.
       *
       * ONE TYPE PER TRANSITION. `nextVersion === 1` means no prior version row exists for
       * this response, and version rows are written only inside this `status === "submitted"`
       * branch - so version 1 is the first submitted transition and every later one is a
       * revision.
       *
       * bid.revise WAS ADDED AFTERWARDS and it is the same emit with a different type. It is
       * on vendor_emittable_event_types() already (088), lib/activity-feed.ts:392 already
       * carries its copy, and nothing about it needed a ruling - the only reason it was not
       * in the original commit is that the original commit was about the policy. The guest
       * path still records neither, because a magic-link guest has no version history to
       * revise.
       *
       * The one way version 1 could fire twice is if a previous version insert failed -
       * which logs loudly above - and even then the feed absorbs it: both rows carry the
       * dedupe key `bid:<response_id>` and mergeActivityEntries keeps one.
       */
      {
        const milestoneType = nextVersion === 1 ? ("bid.submit" as const) : ("bid.revise" as const)
        try {
          // The partnership, read independently rather than by widening either the acting
          // query or the notification query above. Preferred from the inbox row, which is the
          // authoritative link; falling back to the (lead, vendor) pair for inbox rows that
          // predate the link. Both are scoped to the caller by RLS already.
          const { data: inboxLink } = await supabase
            .from("partner_rfp_inbox")
            .select("partnership_id")
            .eq("id", inboxId)
            .maybeSingle()
          let milestonePartnershipId = (inboxLink?.partnership_id as string | null) ?? null
          if (!milestonePartnershipId) {
            const { data: pair } = await supabase
              .from("partnerships")
              .select("id")
              .eq("lead_org_id", inbox.lead_org_id)
              .in("vendor_org_id", callerOrgIds)
              .limit(1)
              .maybeSingle()
            milestonePartnershipId = (pair?.id as string | null) ?? null
          }

          await recordMilestone(supabase, {
            eventType: milestoneType,
            actorSide: "vendor",
            orgId: orgIdFromColumn(inbox.lead_org_id),
            actorId: user.id,
            // actorEmail deliberately absent. See the block above.
            vendorOrgId: writeOrgId,
            partnershipId: milestonePartnershipId,
            // The response id, not the inbox id - lib/activity-feed.ts:498 keys the derived
            // union for this type on the response, and source 2 on the agency dashboard keys
            // on the same id.
            subjectType: "bid",
            subjectId: saved.id as string,
            // inboxDetail?.scope_item_name, NOT scopeItemName: the latter has already fallen
            // back to the literal "Scope item" for the email subject line, and a display
            // placeholder must never be persisted where a null belongs.
            payload: {
              scope_item_name: (inboxDetail?.scope_item_name as string | null)?.trim?.() || null,
            },
          })
        } catch (milestoneErr) {
          // recordMilestone() never throws; this catches the two lookups above.
          console.error("[api] bid submission: milestone context lookup failed (non-fatal)", {
            route,
            responseId: saved.id,
            milestoneType,
            message: milestoneErr instanceof Error ? milestoneErr.message : String(milestoneErr),
          })
        }
      }
    }

    console.log("[api] success", {
      route,
      method: "POST",
      userId: user.id,
      role: profile?.role ?? null,
      recordId: saved?.id,
      status,
      attachmentCount: attachments.length,
    })
    return NextResponse.json({ response: saved })
  } catch (e) {
    console.error("[api] failure", {
      route: "/api/partner/rfps/[id]/response",
      method: "POST",
      code: 500,
      message: e instanceof Error ? e.message : String(e),
    })
    return NextResponse.json(
      { error: "Failed to save response", detail: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    )
  }
}
