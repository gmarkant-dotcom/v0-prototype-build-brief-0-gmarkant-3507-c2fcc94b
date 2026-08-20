import { NextResponse, type NextRequest } from "next/server"
import { createClient as createAnonClient } from "@/lib/supabase/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import { resolveCallerOrgIds, resolveCallerWriteOrgId, resolveOrgIdForUser } from "@/lib/entitlements"
import { buildVendorInvitationEmail, sendTransactionalEmail } from "@/lib/email"
import { normalizeBusinessCriteriaRequired } from "@/lib/business-criteria"
import { normalizeBudgetCategories } from "@/lib/budget-categories"
import { normalizeRfpEvaluationCriteria } from "@/lib/rfp-evaluation-criteria"
import { markPartnershipInvited } from "@/lib/partnership-invitations"
import { attachMagicTokenToPartnerInbox, type MagicTokenForAttach } from "@/lib/magic-token-attach"
import { recordMilestones, type MilestoneEvent } from "@/lib/milestone-events"

export const dynamic = "force-dynamic"

function getServiceSupabase() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null
  }
  // Service role used here intentionally — agency user is pre-verified via the
  // anon client's auth.getUser() + role check below before any service-role write.
  return createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
}

/** Advanced Options (output template) config captured on the Lightning RFP brief step.
 *  Nested inside rfp_magic_tokens.reference_materials so no new column is needed. */
function normalizeOutputTemplateConfig(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  const mode = r.mode === "ai" ? "ai" : r.mode === "upload" ? "upload" : null
  if (!mode) return null

  const sensitivityRaw = r.sensitivity && typeof r.sensitivity === "object" ? (r.sensitivity as Record<string, unknown>) : null
  const uploadedRaw = r.uploadedTemplate && typeof r.uploadedTemplate === "object" ? (r.uploadedTemplate as Record<string, unknown>) : null

  return {
    mode,
    templateStyle: typeof r.templateStyle === "string" ? r.templateStyle : null,
    outputFormat: typeof r.outputFormat === "string" ? r.outputFormat : null,
    sensitivity: sensitivityRaw
      ? {
          scrubBrand: Boolean(sensitivityRaw.scrubBrand),
          scrubBudget: Boolean(sensitivityRaw.scrubBudget),
          scrubStrategy: Boolean(sensitivityRaw.scrubStrategy),
          scrubTimeline: Boolean(sensitivityRaw.scrubTimeline),
        }
      : null,
    uploadedTemplate: uploadedRaw
      ? { name: String(uploadedRaw.name || ""), url: String(uploadedRaw.url || "") }
      : null,
    generatedTemplate: typeof r.generatedTemplate === "string" ? r.generatedTemplate.slice(0, 50000) : "",
  }
}

async function requireAgency() {
  const supabase = await createAnonClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false as const, status: 401, error: "Unauthorized" }
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, active_role, company_name, full_name, display_name")
    .eq("id", user.id)
    .single()
  if (profile?.role !== "agency" && profile?.active_role !== "agency")
    return { ok: false as const, status: 403, error: "Agency only" }
  return { ok: true as const, userId: user.id, profile }
}

export async function POST(request: NextRequest) {
  const route = "/api/agency/rfp/magic-link"
  try {
    const auth = await requireAgency()
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const service = getServiceSupabase()
    if (!service) {
      return NextResponse.json({ error: "Missing Supabase service configuration" }, { status: 500 })
    }

    // 079: THE SERVICE CLIENT BYPASSES RLS COMPLETELY, so the policy rewrite in 079
    // protects nothing on this route - the checks in this file ARE the permission. Before
    // 079 they were correct by accident: `org_id = <session uid>` was simultaneously the
    // ownership check and, coincidentally, the membership check, because one user was one
    // company. Scope by MEMBERSHIP instead. An empty set matches nothing, which fails
    // closed, so it is returned as a 403 rather than as an empty result set.
    const callerOrgIds = await resolveCallerOrgIds(auth.userId, service)
    if (callerOrgIds.length === 0) {
      console.error("[api] failure", { route, code: 403, message: "caller belongs to no organization" })
      return NextResponse.json({ error: "No organization found for this account" }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    const vendorEmail = String(body.vendor_email || "").trim().toLowerCase()
    const vendorName = String(body.vendor_name || "").trim() || null
    const projectId = String(body.project_id || "").trim()
    const rawScopeItemId = String(body.scope_item_id || "").trim()
    // rfp_magic_tokens.scope_item_id is a uuid column, but the agency UI's client-side
    // scope items use Date.now().toString() ids (see app/agency/page.tsx addScopeItem) —
    // not valid uuids. Only persist it when it actually is one; the name/description
    // snapshot below is the real source of truth for the guest brief either way.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    const scopeItemId = UUID_RE.test(rawScopeItemId) ? rawScopeItemId : null
    const scopeItemName = String(body.scope_item_name || "").trim() || null
    const scopeItemDescription = String(body.scope_item_description || "").trim() || null
    const referenceMaterials = Array.isArray(body.reference_materials)
      ? body.reference_materials
          .filter(
            (m: unknown): m is { type: string; label: string; url: string; created_at: string } =>
              !!m &&
              typeof m === "object" &&
              ("type" in m) &&
              ((m as Record<string, unknown>).type === "link" || (m as Record<string, unknown>).type === "file") &&
              typeof (m as Record<string, unknown>).url === "string" &&
              typeof (m as Record<string, unknown>).label === "string"
          )
          .slice(0, 20)
      : []
    const outputTemplateConfig = normalizeOutputTemplateConfig(body.output_template_config)
    const businessCriteriaRequired = normalizeBusinessCriteriaRequired(body.business_criteria_required)
    // P2-1. Never trust the client payload, same posture as business criteria above.
    const budgetCategories = normalizeBudgetCategories(body.budget_categories)
    const evaluationCriteria = normalizeRfpEvaluationCriteria(body.evaluation_criteria)
    // P2-4. Explicit true only - anything else leaves the RFP open, per the standing ruling.
    const closeBiddingAtDeadline = body.close_bidding_at_deadline === true
    // Only set on an explicit value (initial send). Resends omit this field so the upsert's
    // ON CONFLICT DO UPDATE leaves the originally-set requirement untouched.
    const hasRequireTermsDisclosure = typeof body.require_terms_disclosure === "boolean"
    const requireTermsDisclosure = body.require_terms_disclosure === true
    // F2: mirrors the same parsing broadcast-rfp/route.ts already does for
    // partner_rfp_inbox.response_deadline - this flow just never read it at all.
    const responseDeadlineRaw =
      typeof body.response_deadline === "string" && body.response_deadline.trim().length > 0
        ? body.response_deadline.trim()
        : null
    const responseDeadline =
      responseDeadlineRaw && !Number.isNaN(new Date(responseDeadlineRaw).getTime())
        ? new Date(responseDeadlineRaw).toISOString()
        : null

    if (!vendorEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(vendorEmail)) {
      return NextResponse.json({ error: "A valid vendor email is required" }, { status: 400 })
    }
    if (!projectId) {
      return NextResponse.json({ error: "project_id is required" }, { status: 400 })
    }

    const { data: project, error: projectErr } = await service
      .from("projects")
      .select("id, name, client_name, budget_range")
      .eq("id", projectId)
      .in("org_id", callerOrgIds)
      .maybeSingle()
    if (projectErr) {
      console.error("[api] failure", { route, method: "POST", code: 500, message: projectErr.message })
      return NextResponse.json({ error: "Failed to load project" }, { status: 500 })
    }
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 })
    }

    const { data: matchedProfile } = await service
      .from("profiles")
      .select("id")
      .ilike("email", vendorEmail)
      .maybeSingle()
    const is_existing_partner = Boolean(matchedProfile?.id)

    // Look up any existing row for this (agency, project, vendor) triple before deciding
    // whether to mint a new token or reuse the live one. A repeat send - an explicit resend,
    // or a different invite surface targeting the same recipient - must never orphan a link
    // already sitting in the vendor's inbox. Non-transactional by design: a double-click race
    // minting two tokens is an acceptable, rare cost at this scale, not worth locking for.
    const { data: existingToken, error: existingErr } = await service
      .from("rfp_magic_tokens")
      .select("token, expires_at, response_id")
      .in("org_id", callerOrgIds)
      .eq("project_id", projectId)
      .eq("vendor_email", vendorEmail)
      .maybeSingle()
    if (existingErr) {
      console.error("[api] failure", { route, method: "POST", code: 500, message: existingErr.message })
      return NextResponse.json({ error: "Failed to check for an existing invitation" }, { status: 500 })
    }

    const existingIsExpired =
      !!existingToken && new Date(existingToken.expires_at as string).getTime() <= Date.now()
    // A submitted bid's linkage must survive any resend, including a resend that mints a
    // fresh token because the old one had genuinely expired - the vendor's response stays
    // reachable at the new link either way. Only a token that was never submitted resets to
    // a clean "pending" slate on a fresh mint.
    const wasSubmitted = Boolean(existingToken?.response_id)

    const token =
      existingToken && !existingIsExpired
        ? (existingToken.token as string)
        : crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "")
    // Always refreshed: a resend is a renewed invitation, whether the token itself is new or
    // reused - resending is exactly how an agency extends a vendor's window to respond.
    const expires_at = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString()

    // 079: a write is attributed to ONE organization, not to the caller's whole membership
    // set. resolveCallerWriteOrgId() picks the organization the caller owns, then
    // administers, then the first by membership - deterministic rather than arbitrary.
    // Deliberately NOT agencyEntitlementId(): that resolver returns the user id unchanged
    // when membership does not resolve, and rfp_magic_tokens.org_id REFERENCES
    // organizations(id) after 079, so the fallback is a 23503 rather than a safe default.
    const writeOrgId = await resolveCallerWriteOrgId(auth.userId, service)
    if (!writeOrgId) {
      console.error("[api] failure", { route, method: "POST", code: 403, message: "caller belongs to no organization" })
      return NextResponse.json({ error: "Your account is not linked to an organization yet" }, { status: 403 })
    }

    // The deadline this send is about to OVERWRITE, read before the upsert discards it.
    //
    // This is what tells rfp.deadline_set from rfp.deadline_change, and it is the whole
    // reason migration 080's header calls the deadline path destructive today: the upsert
    // below writes `response_deadline` unconditionally, so a resend carrying a new date
    // replaces the old one with nothing anywhere recording what it was or who changed it.
    //
    // Deliberately a SEPARATE, best-effort query rather than a column added to the
    // `existingToken` select above. That select is load-bearing for the invitation itself -
    // it decides whether the live token is reused - and widening its column list would let a
    // missing column (74's `response_deadline`, guarded against everywhere else in this
    // file) fail a real send for the sake of a breadcrumb. An emitter may not change the
    // success or failure of the action it observes.
    //
    // Skipped entirely when there is no prior row, which is every first send: absent row
    // means absent deadline, known without asking. `priorDeadlineKnown` stays false only
    // when the read itself failed, and a deadline event is then not emitted at all - a
    // guessed one would be worse than a missing one.
    let priorDeadline: string | null = null
    let priorDeadlineKnown = false
    if (responseDeadline) {
      if (!existingToken) {
        priorDeadlineKnown = true
      } else {
        try {
          const { data: priorRow, error: priorErr } = await service
            .from("rfp_magic_tokens")
            .select("response_deadline")
            .in("org_id", callerOrgIds)
            .eq("project_id", projectId)
            .eq("vendor_email", vendorEmail)
            .maybeSingle()
          if (priorErr) {
            console.warn("[api] rfp/magic-link: could not read the prior response_deadline; deadline milestone skipped", {
              route,
              projectId,
              code: priorErr.code,
            })
          } else {
            priorDeadline = (priorRow?.response_deadline as string | null) ?? null
            priorDeadlineKnown = true
          }
        } catch (priorReadErr) {
          console.warn("[api] rfp/magic-link: prior response_deadline read threw; deadline milestone skipped", {
            route,
            projectId,
            message: priorReadErr instanceof Error ? priorReadErr.message : String(priorReadErr),
          })
        }
      }
    }

    const tokenUpsertPayload = {
      org_id: writeOrgId,
      project_id: projectId,
      vendor_email: vendorEmail,
      vendor_name: vendorName,
      scope_item_id: scopeItemId,
      scope_item_name: scopeItemName,
      scope_item_description: scopeItemDescription,
      reference_materials: { materials: referenceMaterials, output_template_config: outputTemplateConfig },
      business_criteria_required: businessCriteriaRequired,
      token,
      expires_at,
      // Never reset status/submitted_at/response_id for a row that already has a
      // submitted bid - a resend (or a second invite surface hitting the same recipient)
      // must not sever a live submission from its token.
      ...(wasSubmitted ? {} : { status: "pending", submitted_at: null, response_id: null }),
      ...(hasRequireTermsDisclosure ? { require_terms_disclosure: requireTermsDisclosure } : {}),
      response_deadline: responseDeadline,
      budget_categories: budgetCategories,
      evaluation_criteria: evaluationCriteria,
      close_bidding_at_deadline: closeBiddingAtDeadline,
    }

    // Pre-migration safety, progressive. Each retry drops one more optional column that a
    // not-yet-applied migration may not have created yet, newest migration first, so a
    // partially-migrated database still persists everything it can actually hold. Same 42703
    // (undefined_column) guard already used for business_criteria_acknowledgments pre-071.
    // Extend OPTIONAL_TOKEN_COLUMNS when a later phase adds another optional token column.
    const OPTIONAL_TOKEN_COLUMNS = ["close_bidding_at_deadline", "evaluation_criteria", "budget_categories", "response_deadline"] as const
    let payloadAttempt: Record<string, unknown> = tokenUpsertPayload
    let { data: tokenRow, error: upsertErr } = await service
      .from("rfp_magic_tokens")
      .upsert(payloadAttempt, { onConflict: "org_id,project_id,vendor_email" })
      .select()
      .single()
    for (const column of OPTIONAL_TOKEN_COLUMNS) {
      if (upsertErr?.code !== "42703") break
      console.warn(`[api] rfp/magic-link: optional column missing, retrying without it - ${column}`)
      const { [column]: _omitted, ...rest } = payloadAttempt
      payloadAttempt = rest
      ;({ data: tokenRow, error: upsertErr } = await service
        .from("rfp_magic_tokens")
        .upsert(payloadAttempt, { onConflict: "org_id,project_id,vendor_email" })
        .select()
        .single())
    }

    if (upsertErr || !tokenRow) {
      console.error("[api] failure", { route, method: "POST", code: 500, message: upsertErr?.message })
      return NextResponse.json({ error: "Failed to create invitation" }, { status: 500 })
    }

    // G1 send-time attach: the recipient already has a Ligament account (matchedProfile,
    // looked up above for is_existing_partner) - also surface this RFP in their portal
    // inbox, not just as a bearer link in the invitation email below. Idempotent, so a
    // resend through this same route never creates a duplicate inbox row.
    // 079 PARAMETER CLASS: the recipient is NOT the caller here, so neither caller resolver
    // applies - this is "which organization does that person belong to", which had no answer
    // before 079 because a profiles.id WAS the company. matchedProfile.id is a profiles.id
    // and is written into vendor_org_id, which REFERENCES organizations(id). Null means the
    // matched account has no organization: the attach is skipped rather than writing a user
    // id, and the invitation email below still sends, so the vendor is never left with
    // nothing.
    const matchedVendorOrgId = matchedProfile?.id
      ? await resolveOrgIdForUser(matchedProfile.id as string, service)
      : null
    let attached = false
    if (matchedProfile?.id && !matchedVendorOrgId) {
      console.error("[api] rfp/magic-link: matched account belongs to no organization, skipping portal attach", {
        route,
        matchedProfileId: matchedProfile.id,
        vendorEmail,
      })
    }
    if (matchedVendorOrgId) {
      const attachResult = await attachMagicTokenToPartnerInbox(service, {
        tokenRow: tokenRow as unknown as MagicTokenForAttach,
        partnerId: matchedVendorOrgId,
      })
      if (attachResult.attached) {
        attached = true
      } else {
        console.error("[api] rfp/magic-link: send-time portal attach failed", {
          route,
          token: tokenRow.token,
          reason: attachResult.reason,
        })
      }
    }

    const agencyName =
      auth.profile.company_name?.trim() || auth.profile.full_name?.trim() || auth.profile.display_name?.trim() || "A lead agency"
    const scopeSummary = [
      `${agencyName} has invited you to bid on ${project.name}${project.client_name ? ` for ${project.client_name}` : ""}.`,
      project.budget_range ? `Budget range: ${project.budget_range}.` : null,
      scopeItemName ? `Scope: ${scopeItemName}.` : null,
    ]
      .filter(Boolean)
      .join(" ")

    // sendTransactionalEmail swallows Resend API failures internally and returns false rather
    // than throwing (and returns false immediately, with no Resend attempt, if RESEND_API_KEY
    // is unset). A try/catch alone cannot detect a failed send, so the return value is checked too.
    let emailSent = false
    try {
      const invitation = buildVendorInvitationEmail({
        agencyName,
        vendorName: vendorName || undefined,
        projectName: project.name,
        scopeSummary,
        token: tokenRow.token as string,
      })
      emailSent = await sendTransactionalEmail({ to: vendorEmail, ...invitation })
      if (!emailSent) {
        console.error("[api] vendor invitation email not sent", {
          route,
          method: "POST",
          token: tokenRow.token,
          vendorEmail,
          reason: "sendTransactionalEmail returned false. Check RESEND_API_KEY and the Resend API response.",
        })
      }
    } catch (emailErr) {
      console.error("[api] vendor invitation email failed", {
        route,
        method: "POST",
        token: tokenRow.token,
        vendorEmail,
        message: emailErr instanceof Error ? emailErr.message : String(emailErr),
      })
    }

    let partnershipId: string | null = null
    if (emailSent) {
      try {
        // 079 PARAMETER CLASS: both ids here are organization ids written into
        // partnerships.lead_org_id / .vendor_org_id. `auth.userId` was a user id and
        // `matchedProfile.id` a profiles.id; both REFERENCE organizations(id) now.
        const ref = await markPartnershipInvited(service, {
          agencyId: writeOrgId,
          vendorEmail,
          partnerId: matchedVendorOrgId,
        })
        partnershipId = ref.partnershipId
      } catch (partnershipErr) {
        console.error("[api] failed to mark partnership invited", {
          route,
          method: "POST",
          vendorEmail,
          message: partnershipErr instanceof Error ? partnershipErr.message : String(partnershipErr),
        })
      }
    }

    // Milestones: rfp.magic_link_send, and rfp.deadline_set / rfp.deadline_change.
    //
    // ONE recordMilestones call, so all of them share one statement, one transaction and
    // therefore one `created_at` - which is what lets the feed group them
    // (lib/activity-feed.ts, milestoneGroupKey). recordMilestones catches everything and
    // returns void; nothing below can change what this route returns.
    //
    // ON THE SERVICE CLIENT. Every other emit in the product runs on a session client, so
    // this is the first row written with RLS bypassed: migration 080's INSERT policy does
    // not run here and the checks at the top of this file ARE the permission, exactly as
    // the 079 note at line 80 says for every other write on this route. The row is still
    // correct for RLS on the way OUT - `writeOrgId` is the caller's own organization, so
    // the SELECT policy's `org_id IN (SELECT public.current_user_org_ids())` matches for
    // the team, and `partnership_id` is what the counterparty policy reads.
    //
    // EVERY PAYLOAD FIELD BELOW IS ABOUT THE ONE RECIPIENT THIS ROW IS FOR. All three types
    // are on public.vendor_visible_event_types() and the counterparty policy grants the
    // WHOLE row, payload included. This route sends to exactly ONE vendor per call, so
    // there is no cross-vendor figure available to leak here even by accident - and the
    // one field that must never appear regardless is `tokenRow.token`, which is a BEARER
    // CREDENTIAL for this RFP. It is deliberately absent below.
    const milestones: MilestoneEvent[] = []
    if (emailSent) {
      milestones.push({
        eventType: "rfp.magic_link_send",
        // 079 PARAMETER CLASS: milestone_events.org_id REFERENCES organizations(id).
        // writeOrgId is the caller's own organization, already resolved above for the token
        // row itself, so both the key and the read policy are satisfied by the same value.
        orgId: writeOrgId,
        actorId: auth.userId,
        // Null whenever the recipient has no account, or has one that belongs to no
        // organization - both are ordinary here, this route exists to reach vendors who are
        // not on the platform yet.
        vendorOrgId: matchedVendorOrgId,
        partnershipId,
        // Same subject as rfp.broadcast: the project. That is what makes the feed resolve a
        // project name and a project href for this line rather than dropping it on
        // /agency/bids. Not in UNION_REPLACING_EVENT_TYPES, so it dedupes nothing away.
        subjectType: "project",
        subjectId: projectId,
        payload: {
          scope_item_name: scopeItemName,
          recipient_email: vendorEmail,
          response_deadline: responseDeadline,
        },
      })
    }
    // The deadline pair. Emitted on the persisted value, NOT gated on `emailSent`: the
    // upsert has already committed the new deadline by this point, so it is true whether or
    // not the mail left. Nothing is emitted when the read of the prior value failed, and
    // nothing is emitted when the deadline did not actually move.
    if (responseDeadline && priorDeadlineKnown && priorDeadline !== responseDeadline) {
      milestones.push({
        eventType: priorDeadline === null ? "rfp.deadline_set" : "rfp.deadline_change",
        orgId: writeOrgId,
        actorId: auth.userId,
        vendorOrgId: matchedVendorOrgId,
        partnershipId,
        subjectType: "project",
        subjectId: projectId,
        payload: {
          scope_item_name: scopeItemName,
          response_deadline: responseDeadline,
          // The value the upsert discarded. Greg's ruling: the old deadline IS this
          // vendor's own and may be shown to them; what may not be shown is who ELSE the
          // change touched, and this route touches exactly one vendor, so no such figure
          // exists here. Null on a first set - never a placeholder string, so the renderer
          // and any later consumer can tell "there was none" from "there was one".
          previous_response_deadline: priorDeadline,
        },
      })
    }
    if (milestones.length > 0) {
      await recordMilestones(service, milestones)
    }

    console.log("[api] success", { route, method: "POST", userId: auth.userId, projectId, is_existing_partner, emailSent, attached })
    return NextResponse.json({ token: tokenRow.token, is_existing_partner, expires_at, email_sent: emailSent, attached })
  } catch (error) {
    console.error("[api] failure", {
      route,
      method: "POST",
      code: 500,
      message: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: "Failed to create invitation" }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  const route = "/api/agency/rfp/magic-link"
  try {
    const auth = await requireAgency()
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const service = getServiceSupabase()
    if (!service) {
      return NextResponse.json({ error: "Missing Supabase service configuration" }, { status: 500 })
    }

    // 079: THE SERVICE CLIENT BYPASSES RLS COMPLETELY, so the policy rewrite in 079
    // protects nothing on this route - the checks in this file ARE the permission. Before
    // 079 they were correct by accident: `org_id = <session uid>` was simultaneously the
    // ownership check and, coincidentally, the membership check, because one user was one
    // company. Scope by MEMBERSHIP instead. An empty set matches nothing, which fails
    // closed, so it is returned as a 403 rather than as an empty result set.
    const callerOrgIds = await resolveCallerOrgIds(auth.userId, service)
    if (callerOrgIds.length === 0) {
      console.error("[api] failure", { route, code: 403, message: "caller belongs to no organization" })
      return NextResponse.json({ error: "No organization found for this account" }, { status: 403 })
    }

    const url = new URL(request.url)
    const checkEmail = (url.searchParams.get("check_email") || "").trim().toLowerCase()
    const projectId = (url.searchParams.get("project_id") || "").trim()

    if (checkEmail) {
      const [{ data: matchedProfile }, { data: existingInvite }] = await Promise.all([
        service.from("profiles").select("id").ilike("email", checkEmail).maybeSingle(),
        projectId
          ? service
              .from("rfp_magic_tokens")
              .select("id, expires_at")
              .in("org_id", callerOrgIds)
              .eq("project_id", projectId)
              .eq("vendor_email", checkEmail)
              .maybeSingle()
          : Promise.resolve({ data: null }),
      ])
      const existingInviteExpired =
        !!existingInvite && new Date(existingInvite.expires_at as string).getTime() <= Date.now()
      return NextResponse.json({
        is_existing_partner: Boolean(matchedProfile?.id),
        // has_pending_invite means "an unexpired invite already exists" - sending now will
        // reuse its token (see POST) rather than mint a new one. has_expired_invite means the
        // opposite: sending now mints a fresh token because the old one has lapsed.
        has_pending_invite: Boolean(existingInvite?.id) && !existingInviteExpired,
        has_expired_invite: Boolean(existingInvite?.id) && existingInviteExpired,
      })
    }

    if (projectId) {
      const { data: invites, error: invitesErr } = await service
        .from("rfp_magic_tokens")
        .select("*")
        .in("org_id", callerOrgIds)
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
      if (invitesErr) {
        console.error("[api] failure", { route, method: "GET", code: 500, message: invitesErr.message })
        return NextResponse.json({ error: "Failed to load invitations" }, { status: 500 })
      }
      const emails = [...new Set((invites || []).map((i) => (i.vendor_email as string).toLowerCase()))]
      let partnerEmailSet = new Set<string>()
      if (emails.length > 0) {
        const { data: matchedProfiles } = await service
          .from("profiles")
          .select("email")
          .in("email", emails)
        partnerEmailSet = new Set((matchedProfiles || []).map((p) => (p.email as string || "").toLowerCase()))
      }
      const enriched = (invites || []).map((i) => ({
        ...i,
        is_existing_partner: partnerEmailSet.has((i.vendor_email as string).toLowerCase()),
      }))
      return NextResponse.json({ invites: enriched })
    }

    return NextResponse.json({ error: "check_email or project_id is required" }, { status: 400 })
  } catch (error) {
    console.error("[api] failure", {
      route,
      method: "GET",
      code: 500,
      message: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: "Failed to load invitations" }, { status: 500 })
  }
}
