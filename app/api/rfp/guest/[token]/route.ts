import { orgIdsFromColumns, orgIdFromColumn, resolveOrgIdForUser } from "@/lib/entitlements"
import { NextResponse } from "next/server"
import { createClient as createServiceClient, SupabaseClient } from "@supabase/supabase-js"
import { serializeBudget, formatBudgetForDisplay } from "@/lib/rfp-response-fields"
import { buildAgencyBidNotificationEmail, buildAgencyPoolNotificationEmail, buildVendorConfirmationEmail, resolveOrgNotificationRecipients, sendTransactionalEmail } from "@/lib/email"
import { normalizeBusinessCriteriaRequired, withBusinessCriteriaDefaults, normalizeAcknowledgments } from "@/lib/business-criteria"
import { normalizeBudgetLines } from "@/lib/budget-categories"
import { isBiddingClosed, BIDDING_CLOSED_API_MESSAGE } from "@/lib/bid-close"
import { buildProposalSectionsForSave, normalizeProposalSections } from "@/lib/proposal-sections"
import { isFreeEmailDomain, getEmailDomain } from "@/lib/email-domains"
import { generateAndSaveBidSummary } from "@/lib/bid-summary-generation"
import { validateTermsDisclosure } from "@/lib/terms-disclosure"
import { notifyBidSubmitted } from "@/lib/notifications"
import { recordMilestone } from "@/lib/milestone-events"

export const dynamic = "force-dynamic"

type PoolClassification = {
  poolStatus: "existing_user_added" | "ghost_created" | "domain_match_flagged" | "self_account_skipped"
  domainMatchProfileId: string | null
}

/**
 * Auto-adds a guest bidder to the lead agency's partner pool (magic link auto-add).
 * Callers must wrap this in try/catch - classification failures must never block or
 * fail the bid submission itself, only be logged.
 *
 * Activation here (Case 1) stays partner-initiated by design - the vendor is submitting a
 * real bid on this agency's RFP, an affirmative act, unlike an agency-side import matching
 * an email with no consent from the matched person. Self-partnership must still be
 * impossible either way (shared self-guard concern with lib/server/partner-import-guard.ts,
 * even though this route doesn't import that module - the domain-match logic below is
 * specific to this flow and intentionally untouched).
 */
async function classifyGuestVendorForPool(
  supabase: SupabaseClient,
  params: { agencyId: string; vendorEmail: string; matchedProfileId: string | null }
): Promise<PoolClassification> {
  const { agencyId, vendorEmail, matchedProfileId } = params

  if (matchedProfileId && matchedProfileId === agencyId) {
    return { poolStatus: "self_account_skipped", domainMatchProfileId: null }
  }

  // Case 1: vendor email matches an existing profile.
  if (matchedProfileId) {
    const byId = await supabase
      .from("partnerships")
      .select("id, vendor_org_id")
      .eq("lead_org_id", agencyId)
      .eq("vendor_org_id", matchedProfileId)
      .limit(1)
      .maybeSingle()
    if (byId.error) throw byId.error

    let existingPartnership = byId.data as { id: string; vendor_org_id: string | null } | null

    // A partnership between this agency and this email may already exist with no
    // vendor_org_id yet - e.g. a manual invite-by-email sent before the vendor had an
    // account, or an older unclaimed magic-link ghost row. The vendor_org_id-only lookup
    // above misses it, and inserting a new row for the same (lead_org_id, partner_email)
    // would collide with it. Check by email too before deciding to insert.
    if (!existingPartnership) {
      const byEmail = await supabase
        .from("partnerships")
        .select("id, vendor_org_id")
        .eq("lead_org_id", agencyId)
        .ilike("partner_email", vendorEmail)
        .limit(1)
        .maybeSingle()
      if (byEmail.error) throw byEmail.error
      existingPartnership = byEmail.data as { id: string; vendor_org_id: string | null } | null
    }

    if (!existingPartnership) {
      const { error: insertErr } = await supabase.from("partnerships").insert({
        lead_org_id: agencyId,
        vendor_org_id: matchedProfileId,
        partner_email: vendorEmail,
        status: "active",
        profile_status: "active",
      })
      if (insertErr) throw insertErr
    } else if (!existingPartnership.vendor_org_id) {
      // Found by email, unclaimed - claim it onto this profile instead of inserting a
      // duplicate row for the same (lead_org_id, partner_email).
      const { error: claimErr } = await supabase
        .from("partnerships")
        .update({ vendor_org_id: matchedProfileId, profile_status: "active", updated_at: new Date().toISOString() })
        .eq("id", existingPartnership.id)
      if (claimErr) throw claimErr
    }
    return { poolStatus: "existing_user_added", domainMatchProfileId: null }
  }

  // Case 3: no exact profile match, but a custom (non-free) company domain shared with
  // another existing profile - flag for manual review. A ghost partnership row is still
  // created below (same as Case 2) so the vendor shows up in the pool's Discovered/Invited
  // sections either way; the "Domain Match - Review" badge (driven by poolStatus, cross-
  // referenced from rfp_magic_tokens on read) is what flags it for manual review, not
  // whether it gets a pool row at all.
  let poolStatus: PoolClassification["poolStatus"] = "ghost_created"
  let domainMatchProfileId: string | null = null
  if (!isFreeEmailDomain(vendorEmail)) {
    const domain = getEmailDomain(vendorEmail)
    if (domain) {
      const { data: domainMatch, error: domainErr } = await supabase
        .from("profiles")
        .select("id")
        .ilike("email", `%@${domain}`)
        .limit(1)
        .maybeSingle()
      if (domainErr) throw domainErr
      if (domainMatch?.id) {
        poolStatus = "domain_match_flagged"
        domainMatchProfileId = domainMatch.id as string
      }
    }
  }

  // Case 2 (and the domain-match-flagged case above) - create a ghost partnership row so
  // the vendor shows up in the pool. No invitation_sent_at here: the vendor bid via a magic
  // link they already had, nobody sent them an invitation to join the network, so this
  // lands in Discovered, not Invited.
  const { data: existingGhost, error: ghostLookupErr } = await supabase
    .from("partnerships")
    .select("id")
    .eq("lead_org_id", agencyId)
    .ilike("partner_email", vendorEmail)
    .limit(1)
    .maybeSingle()
  if (ghostLookupErr) throw ghostLookupErr
  if (!existingGhost) {
    const { error: insertErr } = await supabase.from("partnerships").insert({
      lead_org_id: agencyId,
      vendor_org_id: null,
      partner_email: vendorEmail,
      profile_status: "unclaimed",
      status: "pending",
    })
    if (insertErr) throw insertErr
  }
  return { poolStatus, domainMatchProfileId }
}

function getServiceSupabase() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null
  }
  // Service role required throughout: guests have no authenticated session for RLS.
  return createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
}

function labelFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname
    const last = decodeURIComponent(pathname.split("/").pop() || "")
    return last || "Attachment"
  } catch {
    return "Attachment"
  }
}

function normalizeGuestAttachments(raw: unknown): { type: string; label: string; url: string }[] {
  if (!Array.isArray(raw)) return []
  const out: { type: string; label: string; url: string }[] = []
  for (const item of raw.slice(0, 10)) {
    // Legacy shape: a bare URL string, with no label/type of its own.
    if (typeof item === "string") {
      const url = item.trim()
      if (!url) continue
      out.push({ type: "other", label: labelFromUrl(url), url })
      continue
    }
    // Current shape: { type: 'file' | 'link', label, url } from the guest response form.
    if (item && typeof item === "object") {
      const obj = item as Record<string, unknown>
      const url = typeof obj.url === "string" ? obj.url.trim() : ""
      if (!url) continue
      const type = obj.type === "link" ? "link" : obj.type === "file" ? "file" : "other"
      const label = typeof obj.label === "string" && obj.label.trim() ? obj.label.trim() : labelFromUrl(url)
      out.push({ type, label, url })
    }
  }
  return out
}

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const route = "/api/rfp/guest/[token]"
  try {
    const { token } = await params
    const supabase = getServiceSupabase()
    if (!supabase) {
      return NextResponse.json({ error: "Missing Supabase service configuration" }, { status: 500 })
    }

    const { data: tokenRow, error: tokenErr } = await supabase
      .from("rfp_magic_tokens")
      .select("*")
      .eq("token", token)
      .maybeSingle()

    if (tokenErr) {
      console.error("[api] failure", { route, method: "GET", code: 500, message: tokenErr.message })
      return NextResponse.json({ error: "Failed to load invitation" }, { status: 500 })
    }
    if (!tokenRow) {
      return NextResponse.json({ error: "not_found" }, { status: 404 })
    }

    const isExpired = new Date(tokenRow.expires_at as string).getTime() <= Date.now()
    if (isExpired) {
      if (tokenRow.status !== "expired") {
        await supabase.from("rfp_magic_tokens").update({ status: "expired" }).eq("token", token)
      }
      const { data: agencyProfile } = await supabase
        .from("profiles")
        .select("company_name, display_name")
        .eq("id", tokenRow.org_id)
        .maybeSingle()
      return NextResponse.json(
        {
          error: "expired",
          agencyName: agencyProfile?.company_name || agencyProfile?.display_name || null,
        },
        { status: 410 }
      )
    }

    // Project/agency/scope-item context is needed for the "RFP Details" tab regardless of
    // whether a bid has already been submitted, so fetch it up front for both branches.
    const [{ data: project, error: projectErr }, { data: agency, error: agencyErr }] = await Promise.all([
      supabase
        .from("projects")
        .select("id, name, client_name, budget_range, description, start_date, end_date")
        .eq("id", tokenRow.project_id)
        .maybeSingle(),
      supabase
        .from("profiles")
        // company_logo_url is the agency's company logo (shown to vendors). avatar_url is the
        // signed-in user's personal photo, a different field, and not what belongs on this page.
        .select("company_name, display_name, company_logo_url")
        .eq("id", tokenRow.org_id)
        .maybeSingle(),
    ])
    if (projectErr || agencyErr) {
      console.error("[api] failure", {
        route,
        method: "GET",
        code: 500,
        message: projectErr?.message || agencyErr?.message,
      })
      return NextResponse.json({ error: "Failed to load brief" }, { status: 500 })
    }

    // Keyed on scope_item_name rather than scope_item_id: the agency UI's scope item ids
    // (Date.now().toString()) aren't valid uuids, so scope_item_id is often left null even
    // when a scope item snapshot was provided — see app/api/agency/rfp/magic-link/route.ts.
    const scopeItem = tokenRow.scope_item_name
      ? { name: tokenRow.scope_item_name, description: tokenRow.scope_item_description || null }
      : null
    // reference_materials is stored as { materials, output_template_config } — output_template_config
    // is an internal agency-side setting and is intentionally not exposed to guests. Older rows may
    // still hold a bare array from before that shape existed, so support both.
    const rawReferenceMaterials = tokenRow.reference_materials
    const referenceMaterials = Array.isArray(rawReferenceMaterials)
      ? rawReferenceMaterials
      : Array.isArray(rawReferenceMaterials?.materials)
        ? rawReferenceMaterials.materials
        : []

    if (tokenRow.status === "submitted" && tokenRow.response_id) {
      const { data: response, error: responseErr } = await supabase
        .from("partner_rfp_responses")
        .select("*")
        .eq("id", tokenRow.response_id)
        .maybeSingle()
      if (responseErr) {
        console.error("[api] failure", { route, method: "GET", code: 500, message: responseErr.message })
        return NextResponse.json({ error: "Failed to load submitted bid" }, { status: 500 })
      }
      const vendorEmail = (tokenRow.vendor_email || "").trim().toLowerCase()
      const { data: matchedProfile } = await supabase
        .from("profiles")
        .select("id")
        .ilike("email", vendorEmail)
        .maybeSingle()
      const is_existing_partner = Boolean(matchedProfile?.id)
      console.log("[api] success", { route, method: "GET", token, status: "submitted" })
      return NextResponse.json({
        status: "submitted",
        token: tokenRow,
        project,
        scopeItem,
        agency,
        reference_materials: referenceMaterials,
        business_criteria_required: normalizeBusinessCriteriaRequired(tokenRow.business_criteria_required),
        is_existing_partner,
        response: response
          ? {
              ...response,
              // partner_rfp_responses may not carry its own submitted_at; the token row's
              // submitted_at (set on every (re)submission) is the reliable source.
              submitted_at: response.submitted_at || tokenRow.submitted_at,
            }
          : null,
      })
    }

    console.log("[api] success", { route, method: "GET", token, status: "active" })
    return NextResponse.json({
      status: "active",
      token: tokenRow,
      project,
      scopeItem,
      agency,
      reference_materials: referenceMaterials,
      business_criteria_required: normalizeBusinessCriteriaRequired(tokenRow.business_criteria_required),
    })
  } catch (error) {
    console.error("[api] failure", {
      route,
      method: "GET",
      code: 500,
      message: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: "Failed to load invitation" }, { status: 500 })
  }
}

type PostBody = {
  token?: string
  proposal_text?: string
  budget_proposal?: { amount?: unknown; currency?: unknown; custom?: unknown }
  timeline_proposal?: string
  terms_disclosure?: unknown
  attachments?: unknown
  business_criteria_responses?: unknown
  /** Cannot-meet acknowledgments (S4-1). Column added by migration 071 - see the write
   *  guard around `saveGuestResponseRow` below for pre-migration safety. */
  business_criteria_acknowledgments?: unknown
  /** P2-1/P2-2. Absent on every request shaped like today's. */
  budget_lines?: unknown
  proposal_sections?: unknown
  is_edit?: boolean
}

/**
 * Optional columns a not-yet-applied migration may not have created yet, newest migration
 * first. Dropped one at a time on Postgres undefined_column (42703) so a partially-migrated
 * database still persists everything it can hold. Mirrors the identical guard in the portal
 * response route - the two bid paths write the same table and must degrade the same way.
 *   proposal_sections                  - migration 076 (P2-2)
 *   budget_lines                       - migration 072 (P2-1)
 *   business_criteria_acknowledgments  - migration 071 (S4-1), applied
 */
const OPTIONAL_RESPONSE_COLUMNS = ["proposal_sections", "budget_lines", "business_criteria_acknowledgments"] as const

async function saveGuestResponseRow<T>(
  attempt: (row: Record<string, unknown>) => PromiseLike<{ data: T | null; error: { code?: string; message: string } | null }>,
  row: Record<string, unknown>
): Promise<{ data: T | null; error: { code?: string; message: string } | null }> {
  let current = row
  let result = await attempt(current)
  for (const column of OPTIONAL_RESPONSE_COLUMNS) {
    if (!result.error || result.error.code !== "42703") break
    if (!(column in current)) continue
    console.warn(`[rfp/guest] optional column missing, retrying without it - ${column}`)
    const { [column]: _omitted, ...rest } = current
    current = rest
    result = await attempt(current)
  }
  return result
}

export async function POST(req: Request) {
  const route = "/api/rfp/guest/[token]"
  try {
    const supabase = getServiceSupabase()
    if (!supabase) {
      return NextResponse.json({ error: "Missing Supabase service configuration" }, { status: 500 })
    }

    const body = (await req.json().catch(() => ({}))) as PostBody
    const token = (body.token || "").trim()
    if (!token) {
      return NextResponse.json({ error: "Missing token" }, { status: 400 })
    }

    const { data: tokenRow, error: tokenErr } = await supabase
      .from("rfp_magic_tokens")
      .select("*")
      .eq("token", token)
      .maybeSingle()
    if (tokenErr) {
      console.error("[api] failure", { route, method: "POST", code: 500, message: tokenErr.message })
      return NextResponse.json({ error: "Failed to load invitation" }, { status: 500 })
    }
    if (!tokenRow) {
      return NextResponse.json({ error: "Invalid invitation link" }, { status: 400 })
    }
    if (new Date(tokenRow.expires_at as string).getTime() <= Date.now()) {
      return NextResponse.json({ error: "expired" }, { status: 400 })
    }
    // P2-4 trust boundary: the form disables its own submit, so this is the check that actually
    // enforces it. tokenRow comes from select("*"), so the flag is simply undefined before
    // migration 076 and reads as "open", which is today's behavior.
    if (isBiddingClosed({
      close_bidding_at_deadline: tokenRow.close_bidding_at_deadline as boolean | null | undefined,
      response_deadline: tokenRow.response_deadline as string | null | undefined,
    })) {
      return NextResponse.json({ error: BIDDING_CLOSED_API_MESSAGE }, { status: 403 })
    }
    const is_edit = body.is_edit === true
    if (tokenRow.status === "submitted" && !is_edit) {
      return NextResponse.json({ error: "already_submitted" }, { status: 409 })
    }
    if (is_edit && !tokenRow.response_id) {
      return NextResponse.json({ error: "No existing bid to edit" }, { status: 400 })
    }

    const proposal_text = (body.proposal_text || "").toString().trim()
    const amount = Number(body.budget_proposal?.amount)
    // "Other" is the one option that is not an ISO code, so it must survive the uppercase
    // that normalizes the rest - serializeBudget matches it case-sensitively, and an "OTHER"
    // that misses that check stores an amount whose currency reads as a literal "OTHER".
    const currencyRaw = String(body.budget_proposal?.currency || "").trim()
    const currency = currencyRaw.toLowerCase() === "other" ? "Other" : currencyRaw.toUpperCase()
    const currencyCustom = String(body.budget_proposal?.custom || "").trim()
    const timeline_proposal = (body.timeline_proposal || "").toString().trim()

    if (!proposal_text) {
      return NextResponse.json({ error: "Proposal is required" }, { status: 400 })
    }
    if (!Number.isFinite(amount) || amount <= 0 || !currency) {
      return NextResponse.json({ error: "A valid budget amount and currency are required" }, { status: 400 })
    }
    if (!timeline_proposal) {
      return NextResponse.json({ error: "Timeline is required" }, { status: 400 })
    }

    // Trust boundary: the guest form only blocks submission client-side, so re-validate
    // here regardless of what was sent. Guest submissions are always final (no draft
    // concept for this flow), so this always enforces the RFP's requirement.
    const termsValidation = validateTermsDisclosure(body.terms_disclosure, tokenRow.require_terms_disclosure === true)
    if (!termsValidation.ok) {
      return NextResponse.json(
        { error: "Please complete the required term disclosures", detail: termsValidation.errors },
        { status: 400 }
      )
    }
    const terms_disclosure = termsValidation.value

    const vendorEmail = (tokenRow.vendor_email || "").trim().toLowerCase()
    const { data: matchedProfile, error: matchedProfileErr } = await supabase
      .from("profiles")
      .select("id, company_name, full_name, display_name")
      .ilike("email", vendorEmail)
      .maybeSingle()
    if (matchedProfileErr) {
      console.error("[api] failure", { route, method: "POST", code: 500, message: matchedProfileErr.message })
    }
    const is_existing_partner = Boolean(matchedProfile?.id)

    const attachments = normalizeGuestAttachments(body.attachments)
    const business_criteria_responses = withBusinessCriteriaDefaults(body.business_criteria_responses)
    // Write guard (S4-1): only carries acknowledgment data when the request actually sent
    // some - never invents an empty object on requests shaped like today's.
    // P2-1: never trust the client payload. Malformed input normalizes to null, which is the
    // same state as "this RFP has no budget categories".
    const budget_lines = normalizeBudgetLines(body.budget_lines)
    const proposal_sections = buildProposalSectionsForSave(normalizeProposalSections(body.proposal_sections))
    const hasAcknowledgments = body.business_criteria_acknowledgments != null
    const business_criteria_acknowledgments = hasAcknowledgments
      ? normalizeAcknowledgments(body.business_criteria_acknowledgments)
      : null
    const budget_proposal = serializeBudget(amount, currency, currencyCustom || undefined)
    // /agency/bids groups bids by this exact string (see app/agency/bids/page.tsx groupBy
    // "partner"). For a known vendor, use their real profile name so the bid lands in the
    // same group as every other bid tied to vendor_org_id - not a separate group keyed off
    // whatever name/email the agency typed into the magic-link invite.
    const partner_display_name = is_existing_partner
      ? matchedProfile?.company_name?.trim() || matchedProfile?.full_name?.trim() || matchedProfile?.display_name?.trim() || vendorEmail
      : (tokenRow.vendor_name || "").trim() || vendorEmail

    if (is_edit) {
      const submittedAt = new Date().toISOString()
      const editRow = {
        proposal_text,
        budget_proposal,
        timeline_proposal,
        terms_disclosure,
        attachments,
        business_criteria_responses,
        status: "submitted",
        submitted_at: submittedAt,
        updated_at: submittedAt,
        ...(hasAcknowledgments ? { business_criteria_acknowledgments } : {}),
        ...(budget_lines ? { budget_lines } : {}),
      ...(proposal_sections ? { proposal_sections } : {}),
        ...(proposal_sections ? { proposal_sections } : {}),
      }
      const { error: updateErr } = await saveGuestResponseRow(
        (attemptRow) => supabase.from("partner_rfp_responses").update(attemptRow).eq("id", tokenRow.response_id),
        editRow
      )

      if (updateErr) {
        console.error("[api] failure", { route, method: "POST", code: 500, message: updateErr.message })
        return NextResponse.json({ error: "Failed to update bid" }, { status: 500 })
      }

      const { error: tokenUpdateErr } = await supabase
        .from("rfp_magic_tokens")
        .update({ submitted_at: submittedAt })
        .eq("token", token)
      if (tokenUpdateErr) {
        console.error("[api] failure", { route, method: "POST", code: 500, message: tokenUpdateErr.message })
      }

      // Fire-and-forget: AI summary generation must never fail the bid submission itself.
      void generateAndSaveBidSummary(supabase, tokenRow.response_id as string, orgIdsFromColumns(tokenRow.org_id)).catch((err) => {
        console.error("[api] fire-and-forget summary generation failed", {
          route,
          responseId: tokenRow.response_id,
          message: err instanceof Error ? err.message : String(err),
        })
      })

      // Guest revisions previously sent no agency notification at all (email or in-app) -
      // the mirror-image gap of the portal path, which only notified on revision, not on
      // first submission. Both paths now notify on every submitted transition.
      // 079: tokenRow.org_id is a lead agency ORGANISATION id (rfp_magic_tokens is a
      // one-company table). The guest path is the largest surface in the rename and this
      // send is guarded by `if (editAgencyProfile?.email)` - silent on failure. See
      // resolveOrgNotificationRecipients() in lib/email.ts.
      //
      // display_name is deliberately dropped: the resolver returns full_name and
      // company_name, which is what the recipient line below falls back through anyway.
      const [{ data: editProject }, editAgencyRecipients] = await Promise.all([
        supabase.from("projects").select("name").eq("id", tokenRow.project_id).maybeSingle(),
        resolveOrgNotificationRecipients(orgIdFromColumn(tokenRow.org_id), supabase),
      ])
      if (editAgencyRecipients.length === 0) {
        console.error("[api] guest bid revision: no notification recipients for the lead agency", {
          route,
          orgId: tokenRow.org_id,
        })
      }
      const editAgencyProfile = editAgencyRecipients[0] ?? null
      const editVendorName = (tokenRow.vendor_name || "").trim() || vendorEmail
      const editScopeItemName = (tokenRow.scope_item_name as string | null) || "Scope item"
      if (editAgencyProfile?.email) {
        try {
          const editAgencyRecipient =
            editAgencyProfile.company_name?.trim() ||
            editAgencyProfile.full_name?.trim() ||
            "there"
          const editNotification = buildAgencyBidNotificationEmail({
            agencyRecipientName: editAgencyRecipient,
            vendorNameOrEmail: editVendorName,
            projectName: editProject?.name || "Project",
            scopeItemName: editScopeItemName,
            proposalText: proposal_text,
            budgetSummary: formatBudgetForDisplay(budget_proposal),
            timelineSummary: timeline_proposal,
            isRevision: true,
          })
          await sendTransactionalEmail({ to: editAgencyProfile.email, ...editNotification })
        } catch (emailErr) {
          console.error("[api] guest bid revision: agency notification email failed", {
            route,
            message: emailErr instanceof Error ? emailErr.message : String(emailErr),
          })
        }
      } else {
        console.error("[api] guest bid revision: agency has no email on file, notification skipped", {
          route,
          agencyId: tokenRow.org_id,
        })
      }
      try {
        await notifyBidSubmitted(
          supabase,
          tokenRow.org_id as string,
          editVendorName,
          editScopeItemName,
          tokenRow.response_id as string,
          true
        )
      } catch (notifyErr) {
        console.error("[api] guest bid revision: in-app notification failed", {
          route,
          message: notifyErr instanceof Error ? notifyErr.message : String(notifyErr),
        })
      }

      console.log("[api] success", { route, method: "POST", token, is_existing_partner, is_edit: true })
      return NextResponse.json({ success: true, is_existing_partner, is_edit: true })
    }

    const insertRow = {
      lead_org_id: tokenRow.org_id,
      vendor_org_id: is_existing_partner ? matchedProfile!.id : null,
      inbox_item_id: null,
      proposal_text,
      budget_proposal,
      timeline_proposal,
      terms_disclosure,
      attachments,
      business_criteria_responses,
      partner_display_name,
      status: "submitted",
      updated_at: new Date().toISOString(),
      ...(hasAcknowledgments ? { business_criteria_acknowledgments } : {}),
      ...(budget_lines ? { budget_lines } : {}),
    }
    const { data: saved, error: insertErr } = await saveGuestResponseRow<{ id: string; [key: string]: unknown }>(
      (attemptRow) => supabase.from("partner_rfp_responses").insert(attemptRow).select().single(),
      insertRow
    )

    if (insertErr || !saved) {
      console.error("[api] failure", { route, method: "POST", code: 500, message: insertErr?.message })
      return NextResponse.json({ error: "Failed to save bid" }, { status: 500 })
    }

    const submittedAt = new Date().toISOString()
    const { error: tokenUpdateErr } = await supabase
      .from("rfp_magic_tokens")
      .update({ status: "submitted", submitted_at: submittedAt, response_id: saved.id })
      .eq("token", token)
    if (tokenUpdateErr) {
      console.error("[api] failure", { route, method: "POST", code: 500, message: tokenUpdateErr.message })
    }

    // Fire-and-forget: AI summary generation must never fail the bid submission itself.
    void generateAndSaveBidSummary(supabase, saved.id as string, orgIdsFromColumns(tokenRow.org_id)).catch((err) => {
      console.error("[api] fire-and-forget summary generation failed", {
        route,
        responseId: saved.id,
        message: err instanceof Error ? err.message : String(err),
      })
    })

    // Partner-pool auto-classification (magic link auto-add). Must never block or fail
    // the bid submission response - any failure here is logged loudly and swallowed.
    // On failure, pool_status is set to 'classification_error' (best-effort, also swallowed)
    // so a broken classification is visible with a plain SELECT on rfp_magic_tokens, not
    // just in function logs, which have short retention.
    let poolClassification: PoolClassification | null = null
    try {
      poolClassification = await classifyGuestVendorForPool(supabase, {
        agencyId: tokenRow.org_id,
        vendorEmail,
        matchedProfileId: is_existing_partner ? matchedProfile!.id : null,
      })
      const { error: poolStatusErr } = await supabase
        .from("rfp_magic_tokens")
        .update({
          pool_status: poolClassification.poolStatus,
          domain_match_profile_id: poolClassification.domainMatchProfileId,
        })
        .eq("token", token)
      if (poolStatusErr) {
        console.error("[api] partner-pool classification: failed to persist pool_status", {
          route,
          token,
          vendorEmail,
          code: poolStatusErr.code,
          message: poolStatusErr.message,
          details: poolStatusErr.details,
          hint: poolStatusErr.hint,
        })
      }
    } catch (classifyErr) {
      const supabaseErr = classifyErr as { code?: string; message?: string; details?: string; hint?: string }
      console.error("[api] partner-pool classification failed", {
        route,
        token,
        vendorEmail,
        agencyId: tokenRow.org_id,
        matchedProfileId: is_existing_partner ? matchedProfile?.id : null,
        code: supabaseErr?.code,
        message: classifyErr instanceof Error ? classifyErr.message : String(classifyErr),
        details: supabaseErr?.details,
        hint: supabaseErr?.hint,
        stack: classifyErr instanceof Error ? classifyErr.stack : undefined,
      })
      try {
        await supabase.from("rfp_magic_tokens").update({ pool_status: "classification_error" }).eq("token", token)
      } catch (markErr) {
        console.error("[api] partner-pool classification: failed to mark classification_error", {
          route,
          token,
          message: markErr instanceof Error ? markErr.message : String(markErr),
        })
      }
    }

    const { data: project } = await supabase
      .from("projects")
      .select("name")
      .eq("id", tokenRow.project_id)
      .maybeSingle()
    // 079: as above. Organization recipients, not a profile row of the same id.
    const agencyRecipients = await resolveOrgNotificationRecipients(orgIdFromColumn(tokenRow.org_id), supabase)
    if (agencyRecipients.length === 0) {
      console.error("[api] guest bid submit: no notification recipients for the lead agency", {
        route,
        orgId: tokenRow.org_id,
      })
    }
    const agencyProfile = agencyRecipients[0] ?? null

    const projectName = project?.name || "Project"
    const budgetSummary = formatBudgetForDisplay(budget_proposal)

    try {
      const confirmation = buildVendorConfirmationEmail({
        vendorName: tokenRow.vendor_name || undefined,
        vendorEmail,
        projectName,
        submittedAt,
        budgetSummary,
        timelineSummary: timeline_proposal,
      })
      await sendTransactionalEmail({ to: vendorEmail, ...confirmation })
    } catch (emailErr) {
      console.error("[api] vendor confirmation email failed", {
        route,
        message: emailErr instanceof Error ? emailErr.message : String(emailErr),
      })
    }

    const agencyRecipient =
      agencyProfile?.company_name?.trim() || agencyProfile?.full_name?.trim() || "there"
    const submissionVendorName = (tokenRow.vendor_name || "").trim() || vendorEmail
    const submissionScopeItemName = (tokenRow.scope_item_name as string | null) || "Scope item"

    if (agencyProfile?.email) {
      try {
        const notification = buildAgencyBidNotificationEmail({
          agencyRecipientName: agencyRecipient,
          vendorNameOrEmail: submissionVendorName,
          projectName,
          scopeItemName: submissionScopeItemName,
          proposalText: proposal_text,
          budgetSummary,
          timelineSummary: timeline_proposal,
          isRevision: false,
        })
        await sendTransactionalEmail({ to: agencyProfile.email, ...notification })
      } catch (emailErr) {
        console.error("[api] agency notification email failed", {
          route,
          message: emailErr instanceof Error ? emailErr.message : String(emailErr),
        })
      }
    } else {
      console.error("[api] guest bid submission: agency has no email on file, notification skipped", {
        route,
        agencyId: tokenRow.org_id,
      })
    }

    try {
      await notifyBidSubmitted(supabase, tokenRow.org_id as string, submissionVendorName, submissionScopeItemName, saved.id as string, false)
    } catch (notifyErr) {
      console.error("[api] guest bid submission: in-app notification failed", {
        route,
        message: notifyErr instanceof Error ? notifyErr.message : String(notifyErr),
      })
    }

    if (poolClassification && poolClassification.poolStatus !== "domain_match_flagged") {
      try {
        if (agencyProfile?.email) {
          const poolNotification = buildAgencyPoolNotificationEmail({
            agencyRecipientName: agencyRecipient,
            vendorNameOrEmail: (tokenRow.vendor_name || "").trim() || vendorEmail,
            vendorEmail,
            proposalText: proposal_text,
            budgetSummary,
            timelineSummary: timeline_proposal,
          })
          const sent = await sendTransactionalEmail({ to: agencyProfile.email, ...poolNotification })
          if (!sent) {
            console.error("[api] agency pool notification email not sent", { route, token })
          }
        }
      } catch (emailErr) {
        console.error("[api] agency pool notification email failed", {
          route,
          message: emailErr instanceof Error ? emailErr.message : String(emailErr),
        })
      }
    }

    /**
     * Milestone: bid.submit. THE FIRST VENDOR-SIDE EVENT IN THE PRODUCT.
     *
     * Everything recorded until now was the agency acting on a vendor. This is the vendor
     * acting on the agency, and it lands on the AGENCY's feed - `org_id` is the agency, which
     * is what "Members read own company milestone events" reads, so their own dashboard shows
     * a line whose actor is the counterparty. `lib/activity-feed.ts` already names actor kinds
     * by relation rather than by side, so it renders as a counterparty without a change there.
     *
     * WHY THIS NEEDS NO NEW POLICY, AND WHY IT IS ONLY WRITTEN HERE. This route is
     * service-role throughout (getServiceSupabase(), used at :192 and :379) and RLS is not
     * enforced for the service key, so 080's agency-only INSERT policy is never consulted.
     * That is not a loophole: a magic-link guest is not `authenticated`, holds a bearer token
     * rather than a session, and `auth.uid()` is null for them - no policy `TO authenticated`
     * could ever serve this caller, and the alternative, granting `anon` an INSERT, would be
     * forgeable by anyone holding the anon key. The token check this route already performed
     * is a stronger constraint than any RLS predicate could express.
     *
     * The authenticated portal bid submit (app/api/partner/rfps/[id]/response/route.ts) is a
     * SESSION client and gets no emitter here. It is reported, not written.
     *
     * ONCE, ON THE TRANSITION. This branch is the first-submission branch: :416 returns 409
     * for a token already marked submitted, and the edit branch returns before reaching here.
     * One bid.submit per token, and a later revision records nothing (bid.revise on the edit
     * branch is the obvious next one and is deliberately not written in this commit).
     *
     * IDENTITY. actor_id is null - a guest has no account - and actor_email is the vendor's
     * address FROM THE TOKEN ROW, never from the request body. That is the shape the writer's
     * actor_email rule permits, and the only shape it permits.
     *
     * PAYLOAD is about this vendor and this scope only: the scope item they were invited to
     * bid on. Nothing about the other recipients of the same broadcast, nothing about their
     * bid's contents, and no amount - the agency reads the bid itself in the portal, and a
     * figure in a counterparty-readable payload is a figure with a second set of read rules.
     */
    try {
      // The partnership the classification above created or found, read back independently
      // rather than by widening classifyGuestVendorForPool()'s return type - it is what makes
      // the row reachable by the vendor on their own feed. Same key the classifier uses.
      const { data: milestonePartnership } = await supabase
        .from("partnerships")
        .select("id")
        .eq("lead_org_id", tokenRow.org_id)
        .ilike("partner_email", vendorEmail)
        .limit(1)
        .maybeSingle()

      // NOT `matchedProfile.id`. insertRow above writes a profiles id into
      // partner_rfp_responses.vendor_org_id, which is this file's share of the known class B
      // debt; milestone_events.vendor_org_id REFERENCES organizations(id) and a profiles id
      // there raises 23503. Resolved properly, and null where the matched person belongs to
      // no organization - which is the true answer, not a fallback.
      const milestoneVendorOrgId = matchedProfile?.id
        ? await resolveOrgIdForUser(matchedProfile.id as string, supabase)
        : null

      await recordMilestone(supabase, {
        eventType: "bid.submit",
        actorSide: "vendor",
        // The agency. On a vendor-side row org_id still names the agency - it is the column
        // their SELECT policy reads, and the acting company is carried by vendorOrgId.
        orgId: orgIdFromColumn(tokenRow.org_id),
        actorId: null,
        actorEmail: vendorEmail || null,
        vendorOrgId: orgIdFromColumn(milestoneVendorOrgId),
        partnershipId: (milestonePartnership?.id as string | null) ?? null,
        // The response id, NOT the inbox id - a guest bid has no inbox row at all, and
        // lib/activity-feed.ts:498 keys the derived union for this type on the response.
        subjectType: "bid",
        subjectId: saved.id as string,
        payload: { scope_item_name: (tokenRow.scope_item_name as string | null)?.trim?.() || null },
      })
    } catch (milestoneErr) {
      // recordMilestone() never throws; this catches the two reads above. A breadcrumb is
      // strictly less important than the bid it describes, and the bid is already saved.
      console.error("[api] guest bid submission: milestone context lookup failed (non-fatal)", {
        route,
        responseId: saved.id,
        message: milestoneErr instanceof Error ? milestoneErr.message : String(milestoneErr),
      })
    }

    console.log("[api] success", {
      route,
      method: "POST",
      token,
      responseId: saved.id,
      is_existing_partner,
      pool_status: poolClassification?.poolStatus ?? null,
    })
    return NextResponse.json({ success: true, is_existing_partner })
  } catch (error) {
    console.error("[api] failure", {
      route,
      method: "POST",
      code: 500,
      message: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: "Failed to submit bid" }, { status: 500 })
  }
}
