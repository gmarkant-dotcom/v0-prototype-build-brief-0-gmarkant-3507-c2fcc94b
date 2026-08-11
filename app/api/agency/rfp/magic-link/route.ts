import { NextResponse, type NextRequest } from "next/server"
import { createClient as createAnonClient } from "@/lib/supabase/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import { buildVendorInvitationEmail, sendTransactionalEmail } from "@/lib/email"
import { normalizeBusinessCriteriaRequired } from "@/lib/business-criteria"
import { normalizeBudgetCategories } from "@/lib/budget-categories"
import { normalizeRfpEvaluationCriteria } from "@/lib/rfp-evaluation-criteria"
import { markPartnershipInvited } from "@/lib/partnership-invitations"
import { attachMagicTokenToPartnerInbox, type MagicTokenForAttach } from "@/lib/magic-token-attach"

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
      .eq("agency_id", auth.userId)
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
      .eq("agency_id", auth.userId)
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

    const tokenUpsertPayload = {
      agency_id: auth.userId,
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
    }

    // Pre-migration safety, progressive. Each retry drops one more optional column that a
    // not-yet-applied migration may not have created yet, newest migration first, so a
    // partially-migrated database still persists everything it can actually hold. Same 42703
    // (undefined_column) guard already used for business_criteria_acknowledgments pre-071.
    // Extend OPTIONAL_TOKEN_COLUMNS when a later phase adds another optional token column.
    const OPTIONAL_TOKEN_COLUMNS = ["evaluation_criteria", "budget_categories", "response_deadline"] as const
    let payloadAttempt: Record<string, unknown> = tokenUpsertPayload
    let { data: tokenRow, error: upsertErr } = await service
      .from("rfp_magic_tokens")
      .upsert(payloadAttempt, { onConflict: "agency_id,project_id,vendor_email" })
      .select()
      .single()
    for (const column of OPTIONAL_TOKEN_COLUMNS) {
      if (upsertErr?.code !== "42703") break
      console.warn(`[api] rfp/magic-link: optional column missing, retrying without it - ${column}`)
      const { [column]: _omitted, ...rest } = payloadAttempt
      payloadAttempt = rest
      ;({ data: tokenRow, error: upsertErr } = await service
        .from("rfp_magic_tokens")
        .upsert(payloadAttempt, { onConflict: "agency_id,project_id,vendor_email" })
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
    let attached = false
    if (matchedProfile?.id) {
      const attachResult = await attachMagicTokenToPartnerInbox(service, {
        tokenRow: tokenRow as unknown as MagicTokenForAttach,
        partnerId: matchedProfile.id as string,
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

    if (emailSent) {
      try {
        await markPartnershipInvited(service, {
          agencyId: auth.userId,
          vendorEmail,
          partnerId: matchedProfile?.id ?? null,
        })
      } catch (partnershipErr) {
        console.error("[api] failed to mark partnership invited", {
          route,
          method: "POST",
          vendorEmail,
          message: partnershipErr instanceof Error ? partnershipErr.message : String(partnershipErr),
        })
      }
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
              .eq("agency_id", auth.userId)
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
        .eq("agency_id", auth.userId)
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
