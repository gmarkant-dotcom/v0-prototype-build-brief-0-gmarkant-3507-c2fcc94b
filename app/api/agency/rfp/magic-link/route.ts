import { NextResponse, type NextRequest } from "next/server"
import { createClient as createAnonClient } from "@/lib/supabase/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import { buildVendorInvitationEmail, sendTransactionalEmail } from "@/lib/email"
import { normalizeBusinessCriteriaRequired } from "@/lib/business-criteria"

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

    const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "")
    const expires_at = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString()

    const { data: tokenRow, error: upsertErr } = await service
      .from("rfp_magic_tokens")
      .upsert(
        {
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
          status: "pending",
          submitted_at: null,
          response_id: null,
        },
        { onConflict: "agency_id,project_id,vendor_email" }
      )
      .select()
      .single()

    if (upsertErr || !tokenRow) {
      console.error("[api] failure", { route, method: "POST", code: 500, message: upsertErr?.message })
      return NextResponse.json({ error: "Failed to create invitation" }, { status: 500 })
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

    console.log("[api] success", { route, method: "POST", userId: auth.userId, projectId, is_existing_partner, emailSent })
    return NextResponse.json({ token: tokenRow.token, is_existing_partner, expires_at, email_sent: emailSent })
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
      const [{ data: matchedProfile }, { data: pendingInvite }] = await Promise.all([
        service.from("profiles").select("id").ilike("email", checkEmail).maybeSingle(),
        projectId
          ? service
              .from("rfp_magic_tokens")
              .select("id")
              .eq("agency_id", auth.userId)
              .eq("project_id", projectId)
              .eq("vendor_email", checkEmail)
              .eq("status", "pending")
              .maybeSingle()
          : Promise.resolve({ data: null }),
      ])
      return NextResponse.json({
        is_existing_partner: Boolean(matchedProfile?.id),
        has_pending_invite: Boolean(pendingInvite?.id),
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
          .or(emails.map((e) => `email.ilike.${e}`).join(","))
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
