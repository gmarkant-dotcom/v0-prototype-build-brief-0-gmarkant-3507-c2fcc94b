import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildBrandedEmailHtml, resolveOrgNotificationRecipients, sendTransactionalEmail, siteBaseUrl } from "@/lib/email"

export const dynamic = "force-dynamic"

const noStoreHeaders = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate",
} as const

export async function GET(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params
    const partnershipIdFilter = new URL(req.url).searchParams.get("partnershipId")?.trim() || null
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStoreHeaders })
    }

    const { data: profile } = await supabase.from("profiles").select("role, active_role").eq("id", user.id).single()
    if (profile?.role !== "agency" && profile?.active_role !== "agency") {
      return NextResponse.json({ error: "Agency only" }, { status: 403, headers: noStoreHeaders })
    }

    const { data: project } = await supabase
      .from("projects")
      .select("id, title, org_id")
      .eq("id", projectId)
      .eq("org_id", user.id)
      .maybeSingle()
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404, headers: noStoreHeaders })
    }

    // Use a plain select (no nested embed). Nested partnership embeds can return zero rows
    // under RLS/embed quirks even when the agency can read partner_status_updates.
    let query = supabase
      .from("partner_status_updates")
      .select("*")
      .eq("project_id", projectId)
      .eq("is_resolved", false)
      .order("created_at", { ascending: false })

    if (partnershipIdFilter) {
      query = query.eq("partnership_id", partnershipIdFilter)
    }

    console.log("[agency/status-updates] GET", {
      projectId,
      partnershipIdFilter,
    })

    const { data: rows, error } = await query

    if (error) {
      console.error("[agency/status-updates] GET", error)
      return NextResponse.json({ error: "Failed to load updates" }, { status: 500, headers: noStoreHeaders })
    }

    const partnershipIds = [...new Set((rows || []).map((r) => r.partnership_id as string).filter(Boolean))]
    const nameByPartnershipId = new Map<string, string>()
    if (partnershipIds.length > 0) {
      const { data: pships } = await supabase
        // 079-EMBED-BREAK. The `profiles!<fkey>` embed inside the select below traverses a
        // foreign key that 079 REPOINTS, and this is not a rename problem - it is a shape problem.
        // After 079, partnerships.vendor_org_id references organizations(id) rather than profiles(id), and
        // the constraint is rebuilt as partnerships_vendor_org_id_org_fkey. So the old constraint name
        // resolves to nothing, and the new one resolves to `organizations`, which carries only
        // id / name / is_lead_agency / is_vendor - no email, no full_name, no company_name, which
        // is exactly what this embed selects.
        //
        // LEFT UNCHANGED AND UNRESOLVED ON PURPOSE. Rewriting it means answering "what is a
        // vendor company's email address under an organization model", which is the
        // resolveOrgNotificationRecipients() product ruling, not a substitution. The grep guard
        // cannot see this: the constraint name embeds the old column name with no word boundary
        // in front of it, so scripts/check-identity-columns.mjs never matched it and will report
        // the rename complete with all thirteen of these still broken.
        // See docs/079-rename-execution-report.md, "The thirteen broken embeds".
        .from("partnerships")
        .select(
          `
          id,
          partner:profiles!partnerships_partner_id_fkey(company_name, full_name)
        `
        )
        .in("id", partnershipIds)
      for (const row of pships || []) {
        const pr = row.partner as { company_name?: string | null; full_name?: string | null } | null
        const inner = Array.isArray(pr) ? pr[0] : pr
        const partnerName =
          inner?.company_name?.trim() || inner?.full_name?.trim() || "Vendor"
        nameByPartnershipId.set(row.id as string, partnerName)
      }
    }

    const updates = (rows || []).map((r) => ({
      ...r,
      partner_display_name: nameByPartnershipId.get(r.partnership_id as string) || "Vendor",
    }))

    console.log("[agency/status-updates] GET result", {
      projectId,
      partnershipIdFilter,
      rowCount: updates.length,
    })

    return NextResponse.json({ updates }, { headers: noStoreHeaders })
  } catch (e) {
    console.error("[agency/status-updates] GET unhandled", e)
    return NextResponse.json({ error: "Failed" }, { status: 500, headers: noStoreHeaders })
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStoreHeaders })
    }

    const { data: profile } = await supabase.from("profiles").select("role, active_role").eq("id", user.id).single()
    if (profile?.role !== "agency" && profile?.active_role !== "agency") {
      return NextResponse.json({ error: "Agency only" }, { status: 403, headers: noStoreHeaders })
    }

    const { data: project } = await supabase
      .from("projects")
      .select("id, title, org_id")
      .eq("id", projectId)
      .eq("org_id", user.id)
      .maybeSingle()
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404, headers: noStoreHeaders })
    }

    const body = (await req.json().catch(() => ({}))) as { id?: string; updateId?: string }
    const id = (typeof body.updateId === "string" ? body.updateId.trim() : "") || (typeof body.id === "string" ? body.id.trim() : "")
    if (!id) {
      return NextResponse.json({ error: "updateId required" }, { status: 400, headers: noStoreHeaders })
    }

    const { data: existing, error: existingError } = await supabase
      .from("partner_status_updates")
      .select("*")
      .eq("id", id)
      .eq("project_id", projectId)
      .maybeSingle()

    if (existingError) {
      console.error("[agency/status-updates] PATCH existing lookup", existingError)
      return NextResponse.json({ error: "Update failed" }, { status: 500, headers: noStoreHeaders })
    }
    if (!existing) {
      return NextResponse.json({ error: "Update not found" }, { status: 404, headers: noStoreHeaders })
    }

    const wasResolved = existing.is_resolved === true
    const now = new Date().toISOString()
    const { data: updated, error } = await supabase
      .from("partner_status_updates")
      .update({ is_resolved: true, updated_at: now })
      .eq("id", id)
      .eq("project_id", projectId)
      .select("*")
      .maybeSingle()

    if (error) {
      console.error("[agency/status-updates] PATCH", error)
      return NextResponse.json({ error: "Update failed" }, { status: 500, headers: noStoreHeaders })
    }
    if (!updated) {
      return NextResponse.json({ error: "Update failed" }, { status: 500, headers: noStoreHeaders })
    }

    if (!wasResolved && updated.is_resolved === true) {
      try {
        const { data: partnership } = await supabase
          .from("partnerships")
          .select("vendor_org_id")
          .eq("id", updated.partnership_id)
          .maybeSingle()

        const partnerId = partnership?.vendor_org_id
        if (partnerId) {
          // 079: partnerId is a vendor ORGANISATION id. Resolve it to that organization's
          // notification recipients rather than to a profile row of the same id.
          const [partnerRecipients, { data: agencyProfile }] = await Promise.all([
            resolveOrgNotificationRecipients(partnerId, supabase),
            supabase
              .from("profiles")
              .select("full_name, company_name")
              .eq("id", project.org_id)
              .maybeSingle(),
          ])
          if (partnerRecipients.length === 0) {
            console.error("[api] status-update resolve: no recipients for the vendor organization", {
              projectId,
              vendorOrgId: partnerId,
            })
          }
          const partnerProfile = partnerRecipients[0] ?? null
          const recipientEmail = partnerProfile?.email?.trim()
          if (recipientEmail) {
            const agencyName =
              agencyProfile?.company_name?.trim() || agencyProfile?.full_name?.trim() || "Your lead agency"
            const projectName = project.title?.trim() || "Project"
            const viewUrl = `${siteBaseUrl()}/partner/projects`
            const recipientName =
              partnerProfile?.company_name?.trim() ||
              partnerProfile?.full_name?.trim() ||
              recipientEmail
            const body = `${agencyName} has reviewed and resolved your status update for ${projectName}. Log in to view any notes or next steps.`
            await sendTransactionalEmail({
              to: recipientEmail,
              subject: `Your status update on ${projectName} has been reviewed`,
              html: buildBrandedEmailHtml({
                title: "Status Update Reviewed",
                recipientName,
                body,
                ctaText: "View Project",
                ctaUrl: viewUrl,
              }),
            })
          }
        }
      } catch (emailError) {
        console.error("[agency/status-updates] PATCH notification email failed", emailError)
      }
    }

    return NextResponse.json({ update: updated }, { headers: noStoreHeaders })
  } catch (e) {
    console.error("[agency/status-updates] PATCH unhandled", e)
    return NextResponse.json({ error: "Failed" }, { status: 500, headers: noStoreHeaders })
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStoreHeaders })

    const { data: profile } = await supabase.from("profiles").select("role, active_role").eq("id", user.id).single()
    if (profile?.role !== "agency" && profile?.active_role !== "agency") return NextResponse.json({ error: "Agency only" }, { status: 403, headers: noStoreHeaders })

    const { data: project } = await supabase
      .from("projects").select("id, org_id").eq("id", projectId).eq("org_id", user.id).maybeSingle()
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404, headers: noStoreHeaders })

    const body = (await req.json().catch(() => ({}))) as {
      partnershipId?: string
      projectAssignmentId?: string
      status?: string
      completionPct?: number
      note?: string
    }

    if (!body.partnershipId || !body.status) {
      return NextResponse.json({ error: "partnershipId and status required" }, { status: 400, headers: noStoreHeaders })
    }

    const validStatuses = ["on_track", "at_risk", "delayed", "blocked", "complete"]
    if (!validStatuses.includes(body.status)) {
      return NextResponse.json({ error: "Invalid status value" }, { status: 400, headers: noStoreHeaders })
    }

    const now = new Date().toISOString()
    const notes = body.note?.trim()
      ? "[Agency override] " + body.note.trim()
      : "[Agency override]"

    const { data: inserted, error } = await supabase
      .from("partner_status_updates")
      .insert({
        project_id: projectId,
        partnership_id: body.partnershipId,
        project_assignment_id: body.projectAssignmentId || null,
        status: body.status,
        budget_status: "on_track",
        completion_pct: typeof body.completionPct === "number" ? Math.min(100, Math.max(0, body.completionPct)) : 0,
        notes,
        is_resolved: false,
        created_at: now,
        updated_at: now,
      })
      .select("*")
      .maybeSingle()

    if (error) {
      console.error("[agency/status-updates] POST override", error)
      return NextResponse.json({ error: "Failed to save override" }, { status: 500, headers: noStoreHeaders })
    }

    return NextResponse.json({ update: inserted }, { headers: noStoreHeaders })
  } catch (e) {
    console.error("[agency/status-updates] POST unhandled", e)
    return NextResponse.json({ error: "Failed" }, { status: 500, headers: noStoreHeaders })
  }
}
