import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { sendTransactionalEmail, siteBaseUrl } from "@/lib/email"
import { createNotification } from "@/lib/notifications"
import { normalizeMeetingUrlForHref } from "@/lib/utils"
export const dynamic = "force-dynamic"

type DocPayload = {
  documentRole: "agency_doc" | "project_doc" | "template"
  libraryDocumentId?: string | null
  label: string
  url: string
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { data: project, error: projectErr } = await supabase
      .from("projects")
      .select("agency_id")
      .eq("id", projectId)
      .single()
    if (projectErr) {
      console.error("[onboarding-packages] GET projects select failed", {
        route: "GET /api/projects/[id]/onboarding-packages",
        projectId,
        userId: user.id,
        message: projectErr.message,
        code: projectErr.code,
      })
      return NextResponse.json({ error: "Failed to load project" }, { status: 500 })
    }
    if (!project || project.agency_id !== user.id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const { data: packages, error } = await supabase
      .from("onboarding_packages")
      .select(
        `
        *,
        partnership:partnerships(
          id,
          partner:profiles!partnerships_partner_id_fkey(id, email, full_name, company_name)
        )
      `
      )
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })

    if (error) {
      console.error("[onboarding-packages] GET onboarding_packages select failed", {
        route: "GET /api/projects/[id]/onboarding-packages",
        projectId,
        userId: user.id,
        message: error.message,
        code: error.code,
      })
      return NextResponse.json({ packages: [], error: error.message }, { status: 500 })
    }

    return NextResponse.json({ packages: packages || [] })
  } catch (e) {
    console.error("[onboarding-packages] GET", e)
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const logPrefix = "[onboarding-packages] POST"
  try {
    const { id: rawProjectParam } = await params
    const projectParam = decodeURIComponent((rawProjectParam || "").trim())

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("role, company_name, full_name, meeting_url")
      .eq("id", user.id)
      .single()
    if (profile?.role !== "agency") {
      return NextResponse.json({ error: "Agency only" }, { status: 403 })
    }

    const {
      data: projectById,
      error: projectByIdErr,
    } = await supabase
      .from("projects")
      .select("id, name, agency_id")
      .eq("id", projectParam)
      .maybeSingle()

    const project = projectById

    if (!project || project.agency_id !== user.id) {
      return NextResponse.json({ error: "Project not found", projectId: projectParam }, { status: 404 })
    }
    const projectId = project.id as string

    const body = await request.json()
    const {
      partnershipId,
      assignmentId,
      kickoffType = "none",
      kickoffUrl = "",
      kickoffAvailability = "",
      customMessage = "",
      documents = [],
    } = body as {
      partnershipId?: string
      assignmentId?: string
      kickoffType?: string
      kickoffUrl?: string
      kickoffAvailability?: string
      customMessage?: string
      documents?: DocPayload[]
    }

    if (!partnershipId) {
      return NextResponse.json({ error: "partnershipId required" }, { status: 400 })
    }

    const { data: partnership, error: partnershipErr } = await supabase
      .from("partnerships")
      .select("id, agency_id, partner_id, status")
      .eq("id", partnershipId)
      .single()

    if (!partnership || partnership.agency_id !== user.id) {
      return NextResponse.json({ error: "Partnership not found" }, { status: 404 })
    }
    if (partnership.status !== "active" || !partnership.partner_id) {
      return NextResponse.json({ error: "Partnership must be active with a linked partner" }, { status: 400 })
    }

    const { data: assignmentCheck, error: assignmentErr } = await supabase
      .from("project_assignments")
      .select("id")
      .eq("project_id", projectId)
      .eq("partnership_id", partnershipId)
      .maybeSingle()

    if (assignmentErr) {
      console.error(`${logPrefix} project_assignments lookup failed`, {
        projectId,
        partnershipId,
        userId: user.id,
        message: assignmentErr.message,
        code: assignmentErr.code,
      })
      return NextResponse.json({ error: "Could not verify project assignment" }, { status: 500 })
    }
    if (!assignmentCheck) {
      return NextResponse.json(
        { error: "Partner must be assigned to this project before sending onboarding" },
        { status: 400 }
      )
    }

    if (assignmentId && assignmentCheck.id !== assignmentId) {
      return NextResponse.json({ error: "assignmentId does not match project and partnership" }, { status: 400 })
    }

    const rawDocs: DocPayload[] = Array.isArray(documents) ? documents : []
    /** Drop empty slots; require label+url only for rows the client actually filled in. */
    const docs: DocPayload[] = []
    for (const d of rawDocs) {
      const label = (d.label || "").trim()
      const rawUrl = (d.url || "").trim()
      if (!label && !rawUrl) continue
      if (!label || !rawUrl) {
        return NextResponse.json({ error: "Each document needs label and url" }, { status: 400 })
      }
      const url = normalizeMeetingUrlForHref(rawUrl)
      if (!url || (!url.startsWith("http://") && !url.startsWith("https://"))) {
        return NextResponse.json({ error: "Each document url must be http(s)" }, { status: 400 })
      }
      docs.push({
        ...d,
        label,
        url,
      })
    }

    const projectDocCount = docs.filter((d) => d.documentRole === "project_doc").length
    if (projectDocCount > 10) {
      return NextResponse.json({ error: "Maximum 10 project documents" }, { status: 400 })
    }

    const kt = ["calendly", "availability", "none"].includes(kickoffType) ? kickoffType : "none"
    const calendlySource = (kickoffUrl || profile?.meeting_url || "").trim()
    const finalKickoffUrl =
      kt === "calendly" ? normalizeMeetingUrlForHref(calendlySource) || null : null
    const finalAvailability = kt === "availability" ? (kickoffAvailability || "").trim() : null

    if (kt === "calendly" && calendlySource && !finalKickoffUrl) {
      return NextResponse.json({ error: "Calendly or scheduling URL could not be normalized" }, { status: 400 })
    }

    const { data: pkg, error: pkgErr } = await supabase
      .from("onboarding_packages")
      .insert({
        project_id: projectId,
        agency_id: user.id,
        partnership_id: partnershipId,
        kickoff_type: kt,
        kickoff_url: finalKickoffUrl,
        kickoff_availability: finalAvailability || null,
        custom_message: customMessage?.trim() || null,
        status: "sent",
        updated_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (pkgErr || !pkg) {
      console.error("[onboarding-packages] insert package", pkgErr)
      return NextResponse.json({ error: pkgErr?.message || "Could not create package (run migration 024?)" }, { status: 500 })
    }

    if (docs.length > 0) {
      const rows = docs.map((d, i) => ({
        package_id: pkg.id,
        document_role: d.documentRole,
        library_document_id: d.libraryDocumentId || null,
        label: d.label.trim(),
        url: d.url.trim(),
        sort_order: i,
      }))

      const { error: docErr } = await supabase.from("onboarding_package_documents").insert(rows)
      if (docErr) {
        console.error("[onboarding-packages] insert docs", docErr)
        await supabase.from("onboarding_packages").delete().eq("id", pkg.id)
        return NextResponse.json({ error: "Could not save document list" }, { status: 500 })
      }
    }

    const { data: partnerProfile, error: partnerProfileErr } = await supabase
      .from("profiles")
      .select("email, full_name, company_name")
      .eq("id", partnership.partner_id)
      .single()
    if (partnerProfileErr) {
      console.error(`${logPrefix} partner profile select failed (email may be skipped)`, {
        projectId,
        packageId: pkg.id,
        partnershipId,
        partnerId: partnership.partner_id,
        message: partnerProfileErr.message,
        code: partnerProfileErr.code,
      })
    }

    const partnerEmail = partnerProfile?.email
    const agencyName = profile.company_name || profile.full_name || "Your lead agency"
    const projectTitle = project.name || "Project"
    const base = siteBaseUrl()
    const onboardingUrl = `${base}/partner/onboarding`

    const docListHtml =
      docs.length > 0
        ? docs.map((d) => `<li>${escapeHtml(d.label.trim())}</li>`).join("")
        : "<li><em>No documents attached to this package.</em></li>"
    let kickoffHtml = ""
    if (kt === "calendly" && finalKickoffUrl) {
      kickoffHtml = `<p><strong>Kickoff:</strong> <a href="${escapeHtml(finalKickoffUrl)}">Schedule here</a></p>`
    } else if (kt === "availability" && finalAvailability) {
      kickoffHtml = `<p><strong>Agency availability:</strong><br/>${escapeHtml(finalAvailability)}</p>`
    }

    if (partnerEmail) {
      await sendTransactionalEmail({
        to: partnerEmail,
        subject: "Your onboarding documents are ready",
        html: `
        <div style="font-family:system-ui,sans-serif;line-height:1.6;color:#0C3535;max-width:560px">
          <p><strong>${escapeHtml(agencyName)}</strong> shared an onboarding package for <strong>${escapeHtml(projectTitle)}</strong>.</p>
          ${customMessage ? `<p style="border-left:3px solid #C8F53C;padding-left:12px">${escapeHtml(customMessage)}</p>` : ""}
          <p><strong>Documents</strong></p>
          <ul>${docListHtml}</ul>
          ${kickoffHtml}
          <p>
            <a href="${onboardingUrl}" style="display:inline-block;background:#0C3535;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Open onboarding</a>
          </p>
        </div>
      `,
      })
    }

    await createNotification({
      supabase,
      userId: partnership.partner_id,
      type: "onboarding_deployed",
      title: "Onboarding documents ready",
      message: `${agencyName} sent onboarding materials for "${projectTitle}".`,
      link: "/partner/onboarding",
      data: { projectId, packageId: pkg.id },
    })

    return NextResponse.json({ success: true, package: pkg })
  } catch (e) {
    console.error(`${logPrefix} uncaught exception`, e)
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}
