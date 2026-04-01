import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { sendTransactionalEmail, siteBaseUrl } from "@/lib/email"
import { createNotification } from "@/lib/notifications"
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

    const { data: project } = await supabase.from("projects").select("agency_id").eq("id", projectId).single()
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
      console.error("[onboarding-packages] GET", error)
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
    console.log(`${logPrefix} step:incoming`, {
      rawProjectParam,
      projectParam,
      projectParamLength: projectParam.length,
    })

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      console.log(`${logPrefix} step:auth — returning 401 Unauthorized (no user)`)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    console.log(`${logPrefix} step:auth`, { userId: user.id })

    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("role, company_name, full_name, meeting_url")
      .eq("id", user.id)
      .single()
    console.log(`${logPrefix} step:profile`, {
      userId: user.id,
      role: profile?.role ?? null,
      profileError: profileErr
        ? { message: profileErr.message, code: profileErr.code, details: profileErr.details }
        : null,
    })
    if (profile?.role !== "agency") {
      console.log(`${logPrefix} step:role-check — returning 403 Agency only (role=${profile?.role ?? "missing"})`)
      return NextResponse.json({ error: "Agency only" }, { status: 403 })
    }

    // Primary path: route param is the project UUID.
    const {
      data: projectById,
      error: projectByIdErr,
    } = await supabase
      .from("projects")
      .select("id, title, agency_id")
      .eq("id", projectParam)
      .maybeSingle()

    console.log(`${logPrefix} step:project-lookup-by-id`, {
      lookupKey: projectParam,
      data: projectById,
      error: projectByIdErr
        ? { message: projectByIdErr.message, code: projectByIdErr.code, details: projectByIdErr.details }
        : null,
      rowFound: !!projectById,
    })

    let project = projectById

    // Fallback path: tolerate accidental project title in route param.
    if (!project) {
      const {
        data: projectByTitle,
        error: projectByTitleErr,
      } = await supabase
        .from("projects")
        .select("id, title, agency_id")
        .eq("agency_id", user.id)
        .eq("title", projectParam)
        .maybeSingle()
      project = projectByTitle || null
      console.log(`${logPrefix} step:project-lookup-by-title-fallback`, {
        agencyIdFilter: user.id,
        titleParam: projectParam,
        data: projectByTitle,
        error: projectByTitleErr
          ? { message: projectByTitleErr.message, code: projectByTitleErr.code, details: projectByTitleErr.details }
          : null,
        rowFound: !!projectByTitle,
      })
    }

    const ownershipMatch = project ? project.agency_id === user.id : false
    console.log(`${logPrefix} step:agency-ownership`, {
      userId: user.id,
      projectAgencyId: project?.agency_id ?? null,
      ownershipMatch,
    })

    if (!project || project.agency_id !== user.id) {
      const reason404 = !project
        ? "no_project_row_after_id_and_title_lookups"
        : "agency_mismatch_project_agency_id_ne_user_id"
      console.warn(`${logPrefix} step:404 Project not found`, {
        reason404,
        projectParam,
        userId: user.id,
        projectRowPresent: !!project,
        projectIdIfAny: project?.id ?? null,
        projectAgencyIdIfAny: project?.agency_id ?? null,
      })
      return NextResponse.json({ error: "Project not found", projectId: projectParam }, { status: 404 })
    }
    const projectId = project.id as string
    console.log(`${logPrefix} step:project-resolved`, { projectId, title: project.title })

    const body = await request.json()
    console.log(`${logPrefix} step:body-parsed`, {
      projectId,
      hasPartnershipId: !!(body as { partnershipId?: string }).partnershipId,
      hasAssignmentId: !!(body as { assignmentId?: string }).assignmentId,
      documentCount: Array.isArray((body as { documents?: unknown }).documents)
        ? (body as { documents: unknown[] }).documents.length
        : 0,
    })
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
      console.log(`${logPrefix} step:validation — returning 400 partnershipId required`)
      return NextResponse.json({ error: "partnershipId required" }, { status: 400 })
    }

    const { data: partnership, error: partnershipErr } = await supabase
      .from("partnerships")
      .select("id, agency_id, partner_id, status")
      .eq("id", partnershipId)
      .single()

    console.log(`${logPrefix} step:partnership-lookup`, {
      partnershipId,
      data: partnership,
      error: partnershipErr
        ? { message: partnershipErr.message, code: partnershipErr.code, details: partnershipErr.details }
        : null,
      agencyMatch: partnership ? partnership.agency_id === user.id : false,
    })

    if (!partnership || partnership.agency_id !== user.id) {
      console.log(`${logPrefix} step:404 Partnership not found`, {
        reason: !partnership ? "no_row_or_query_error" : "agency_id_mismatch",
        partnershipId,
        userId: user.id,
      })
      return NextResponse.json({ error: "Partnership not found" }, { status: 404 })
    }
    if (partnership.status !== "active" || !partnership.partner_id) {
      console.log(`${logPrefix} step:400 partnership not active or missing partner_id`, {
        status: partnership.status,
        hasPartnerId: !!partnership.partner_id,
      })
      return NextResponse.json({ error: "Partnership must be active with a linked partner" }, { status: 400 })
    }

    const { data: assignmentCheck, error: assignmentErr } = await supabase
      .from("project_assignments")
      .select("id")
      .eq("project_id", projectId)
      .eq("partnership_id", partnershipId)
      .maybeSingle()

    console.log(`${logPrefix} step:project-assignment-lookup`, {
      projectId,
      partnershipId,
      assignmentRow: assignmentCheck,
      error: assignmentErr
        ? { message: assignmentErr.message, code: assignmentErr.code, details: assignmentErr.details }
        : null,
    })

    if (!assignmentCheck) {
      console.log(`${logPrefix} step:400 no project_assignment for project+partnership`)
      return NextResponse.json(
        { error: "Partner must be assigned to this project before sending onboarding" },
        { status: 400 }
      )
    }

    if (assignmentId && assignmentCheck.id !== assignmentId) {
      console.log(`${logPrefix} step:400 assignmentId mismatch`, {
        bodyAssignmentId: assignmentId,
        dbAssignmentId: assignmentCheck.id,
      })
      return NextResponse.json({ error: "assignmentId does not match project and partnership" }, { status: 400 })
    }

    const docs: DocPayload[] = Array.isArray(documents) ? documents : []
    const projectDocCount = docs.filter((d) => d.documentRole === "project_doc").length
    if (projectDocCount > 10) {
      console.log(`${logPrefix} step:400 too many project docs`, { projectDocCount })
      return NextResponse.json({ error: "Maximum 10 project documents" }, { status: 400 })
    }
    if (docs.length === 0) {
      console.log(`${logPrefix} step:400 no documents`)
      return NextResponse.json({ error: "Add at least one document" }, { status: 400 })
    }

    for (const d of docs) {
      if (!d.label?.trim() || !d.url?.trim()) {
        console.log(`${logPrefix} step:400 document missing label or url`)
        return NextResponse.json({ error: "Each document needs label and url" }, { status: 400 })
      }
      if (!d.url.startsWith("http://") && !d.url.startsWith("https://")) {
        console.log(`${logPrefix} step:400 document url not http(s)`)
        return NextResponse.json({ error: "Each document url must be http(s)" }, { status: 400 })
      }
    }

    const kt = ["calendly", "availability", "none"].includes(kickoffType) ? kickoffType : "none"
    const finalKickoffUrl = kt === "calendly" ? (kickoffUrl || profile?.meeting_url || "").trim() : null
    const finalAvailability = kt === "availability" ? (kickoffAvailability || "").trim() : null

    const { data: pkg, error: pkgErr } = await supabase
      .from("onboarding_packages")
      .insert({
        project_id: projectId,
        agency_id: user.id,
        partnership_id: partnershipId,
        kickoff_type: kt,
        kickoff_url: finalKickoffUrl || null,
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

    const { data: partnerProfile } = await supabase
      .from("profiles")
      .select("email, full_name, company_name")
      .eq("id", partnership.partner_id)
      .single()

    const partnerEmail = partnerProfile?.email
    const agencyName = profile.company_name || profile.full_name || "Your lead agency"
    const projectTitle = project.title || "Project"
    const base = siteBaseUrl()
    const onboardingUrl = `${base}/partner/onboarding`

    const docListHtml = docs.map((d) => `<li>${escapeHtml(d.label.trim())}</li>`).join("")
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

    console.log(`${logPrefix} step:success`, { projectId, packageId: pkg.id, partnershipId })
    return NextResponse.json({ success: true, package: pkg })
  } catch (e) {
    console.error(`${logPrefix} uncaught exception`, e)
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}
