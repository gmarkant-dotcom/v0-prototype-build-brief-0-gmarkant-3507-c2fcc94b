import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { sendTransactionalEmail, siteBaseUrl } from "@/lib/email"

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

    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single()
    if (profile?.role !== "agency") {
      return NextResponse.json({ error: "Agency only" }, { status: 403, headers: noStoreHeaders })
    }

    const { data: project } = await supabase
      .from("projects")
      .select("id, title, agency_id")
      .eq("id", projectId)
      .eq("agency_id", user.id)
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
          inner?.company_name?.trim() || inner?.full_name?.trim() || "Partner"
        nameByPartnershipId.set(row.id as string, partnerName)
      }
    }

    const updates = (rows || []).map((r) => ({
      ...r,
      partner_display_name: nameByPartnershipId.get(r.partnership_id as string) || "Partner",
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

    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single()
    if (profile?.role !== "agency") {
      return NextResponse.json({ error: "Agency only" }, { status: 403, headers: noStoreHeaders })
    }

    const { data: project } = await supabase.from("projects").select("id").eq("id", projectId).eq("agency_id", user.id).maybeSingle()
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
          .select("partner_id")
          .eq("id", updated.partnership_id)
          .maybeSingle()

        const partnerId = partnership?.partner_id
        if (partnerId) {
          const [{ data: partnerProfile }, { data: agencyProfile }] = await Promise.all([
            supabase.from("profiles").select("email").eq("id", partnerId).maybeSingle(),
            supabase
              .from("profiles")
              .select("full_name, company_name")
              .eq("id", project.agency_id)
              .maybeSingle(),
          ])
          const recipientEmail = partnerProfile?.email?.trim()
          if (recipientEmail) {
            const agencyName =
              agencyProfile?.company_name?.trim() || agencyProfile?.full_name?.trim() || "Your lead agency"
            const projectName = project.title?.trim() || "Project"
            const viewUrl = `${siteBaseUrl()}/partner/projects`
            await sendTransactionalEmail({
              to: recipientEmail,
              subject: `Your status update on ${projectName} has been reviewed`,
              html: `
                <p style="font-family:system-ui,sans-serif">
                  ${agencyName} has reviewed and resolved your status update for ${projectName}.
                </p>
                <p style="font-family:system-ui,sans-serif">
                  Log in to view any notes or next steps.
                </p>
                <p style="font-family:system-ui,sans-serif">
                  <a href="${viewUrl}" style="font-weight:700;color:#0C3535">View Project</a>
                </p>
                <p style="font-family:system-ui,sans-serif">
                  The Ligament Team<br />
                  <a href="${siteBaseUrl()}" style="color:#0C3535">withligament.com</a>
                </p>
              `,
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
