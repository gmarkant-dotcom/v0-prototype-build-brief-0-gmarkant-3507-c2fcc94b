import { NextResponse } from "next/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import { serializeBudget, formatBudgetForDisplay } from "@/lib/rfp-response-fields"
import {
  buildVendorConfirmationEmail,
  buildAgencyBidNotificationEmail,
  sendTransactionalEmail,
} from "@/lib/email"

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
    const url = typeof item === "string" ? item.trim() : ""
    if (!url) continue
    out.push({ type: "other", label: labelFromUrl(url), url })
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
      return NextResponse.json({ status: "submitted", token: tokenRow, response })
    }

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

    console.log("[api] success", { route, method: "GET", token, status: "active" })
    return NextResponse.json({ status: "active", token: tokenRow, project, scopeItem, agency })
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
    if (tokenRow.status === "submitted") {
      return NextResponse.json({ error: "already_submitted" }, { status: 409 })
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
    const budget_proposal = serializeBudget(amount, currency)
    const partner_display_name = (tokenRow.vendor_name || "").trim() || vendorEmail

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
