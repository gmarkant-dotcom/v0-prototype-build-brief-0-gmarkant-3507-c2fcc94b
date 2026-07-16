import { NextResponse } from "next/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import { serializeBudget, formatBudgetForDisplay } from "@/lib/rfp-response-fields"
import {
  buildVendorConfirmationEmail,
  buildAgencyBidNotificationEmail,
  sendTransactionalEmail,
} from "@/lib/email"
import { normalizeBusinessCriteriaRequired, withBusinessCriteriaDefaults } from "@/lib/business-criteria"

export const dynamic = "force-dynamic"

function getServiceSupabase() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null
  }
  // Service role required throughout: guests have no authenticated session for RLS.
  return createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
}

type PaymentTermsInput = {
  deposit_pct?: unknown
  schedule_preference?: unknown
  currency?: unknown
  notes?: unknown
}

function normalizeGuestPaymentTerms(raw: unknown) {
  const source = raw && typeof raw === "object" ? (raw as PaymentTermsInput) : {}
  const parsedDeposit =
    source.deposit_pct === null || source.deposit_pct === undefined ? null : Number(source.deposit_pct)
  const deposit_required_pct =
    parsedDeposit != null && Number.isFinite(parsedDeposit) && parsedDeposit >= 0 && parsedDeposit <= 100
      ? parsedDeposit
      : null
  const payment_schedule_preference =
    String(source.schedule_preference ?? "").trim().slice(0, 80) || null
  const preferred_currency = String(source.currency ?? "").trim().toUpperCase().slice(0, 16) || null
  const additional_notes = String(source.notes ?? "").trim() || null
  return { deposit_required_pct, payment_schedule_preference, preferred_currency, additional_notes }
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
        .eq("id", tokenRow.agency_id)
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
        .select("company_name, display_name, avatar_url")
        .eq("id", tokenRow.agency_id)
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
      console.log("[api] success", { route, method: "GET", token, status: "submitted" })
      return NextResponse.json({
        status: "submitted",
        token: tokenRow,
        project,
        scopeItem,
        agency,
        reference_materials: referenceMaterials,
        business_criteria_required: normalizeBusinessCriteriaRequired(tokenRow.business_criteria_required),
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
  budget_proposal?: { amount?: unknown; currency?: unknown }
  timeline_proposal?: string
  payment_terms?: PaymentTermsInput
  attachments?: unknown
  business_criteria_responses?: unknown
  is_edit?: boolean
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
    const is_edit = body.is_edit === true
    if (tokenRow.status === "submitted" && !is_edit) {
      return NextResponse.json({ error: "already_submitted" }, { status: 409 })
    }
    if (is_edit && !tokenRow.response_id) {
      return NextResponse.json({ error: "No existing bid to edit" }, { status: 400 })
    }

    const proposal_text = (body.proposal_text || "").toString().trim()
    const amount = Number(body.budget_proposal?.amount)
    const currency = String(body.budget_proposal?.currency || "").trim().toUpperCase()
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

    const vendorEmail = (tokenRow.vendor_email || "").trim().toLowerCase()
    const { data: matchedProfile } = await supabase
      .from("profiles")
      .select("id")
      .ilike("email", vendorEmail)
      .maybeSingle()
    const is_existing_partner = Boolean(matchedProfile?.id)

    const payment_terms = normalizeGuestPaymentTerms(body.payment_terms)
    const attachments = normalizeGuestAttachments(body.attachments)
    const business_criteria_responses = withBusinessCriteriaDefaults(body.business_criteria_responses)
    const budget_proposal = serializeBudget(amount, currency)
    const partner_display_name = (tokenRow.vendor_name || "").trim() || vendorEmail

    if (is_edit) {
      const submittedAt = new Date().toISOString()
      const { error: updateErr } = await supabase
        .from("partner_rfp_responses")
        .update({
          proposal_text,
          budget_proposal,
          timeline_proposal,
          payment_terms,
          attachments,
          business_criteria_responses,
          status: "submitted",
          submitted_at: submittedAt,
          updated_at: submittedAt,
        })
        .eq("id", tokenRow.response_id)

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

      console.log("[api] success", { route, method: "POST", token, is_existing_partner, is_edit: true })
      return NextResponse.json({ success: true, is_existing_partner, is_edit: true })
    }

    const { data: saved, error: insertErr } = await supabase
      .from("partner_rfp_responses")
      .insert({
        agency_id: tokenRow.agency_id,
        partner_id: is_existing_partner ? matchedProfile!.id : null,
        inbox_item_id: null,
        proposal_text,
        budget_proposal,
        timeline_proposal,
        payment_terms,
        attachments,
        business_criteria_responses,
        partner_display_name,
        status: "submitted",
        updated_at: new Date().toISOString(),
      })
      .select()
      .single()

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

    const { data: project } = await supabase
      .from("projects")
      .select("name")
      .eq("id", tokenRow.project_id)
      .maybeSingle()
    const { data: agencyProfile } = await supabase
      .from("profiles")
      .select("email, company_name, display_name, full_name")
      .eq("id", tokenRow.agency_id)
      .maybeSingle()

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

    try {
      if (agencyProfile?.email) {
        const agencyRecipient =
          agencyProfile.company_name?.trim() || agencyProfile.display_name?.trim() || agencyProfile.full_name?.trim() || "there"
        const notification = buildAgencyBidNotificationEmail({
          agencyRecipientName: agencyRecipient,
          vendorNameOrEmail: (tokenRow.vendor_name || "").trim() || vendorEmail,
          projectName,
          proposalText: proposal_text,
          budgetSummary,
          timelineSummary: timeline_proposal,
        })
        await sendTransactionalEmail({ to: agencyProfile.email, ...notification })
      }
    } catch (emailErr) {
      console.error("[api] agency notification email failed", {
        route,
        message: emailErr instanceof Error ? emailErr.message : String(emailErr),
      })
    }

    console.log("[api] success", { route, method: "POST", token, responseId: saved.id, is_existing_partner })
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
