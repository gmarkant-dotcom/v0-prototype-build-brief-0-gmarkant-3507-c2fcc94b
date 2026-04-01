import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

const ROUTE = "/api/partner/projects/[projectId]/active-engagement"

const noStoreHeaders = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate",
} as const

type InboxSnippet = {
  project_id: string | null
  scope_item_name: string | null
  partnership_id: string | null
}

type AwardedResponseRow = {
  id: string
  proposal_text: string
  budget_proposal: string
  timeline_proposal: string
  inbox_item_id: string
  partner_id: string
  updated_at: string
  partner_rfp_inbox: InboxSnippet | InboxSnippet[] | null
}

function inboxRow(embed: AwardedResponseRow["partner_rfp_inbox"]): InboxSnippet | null {
  if (!embed) return null
  return Array.isArray(embed) ? embed[0] ?? null : embed
}

function pickResponseForAssignment(
  rows: AwardedResponseRow[],
  projectId: string,
  partnershipId: string,
  partnerId: string
): AwardedResponseRow | null {
  const candidates = rows.filter((r) => {
    if (r.partner_id !== partnerId) return false
    const inbox = inboxRow(r.partner_rfp_inbox)
    if (!inbox || inbox.project_id !== projectId) return false
    if (inbox.partnership_id && inbox.partnership_id !== partnershipId) return false
    return true
  })
  if (candidates.length === 0) return null
  candidates.sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""))
  return candidates[0] ?? null
}

export async function GET(_req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStoreHeaders })
    }

    console.log("[api] partner active-engagement after auth", { route: ROUTE, userId: user.id, projectId })

    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single()
    if (profileErr || profile?.role !== "partner") {
      return NextResponse.json({ error: "Partner only" }, { status: 403, headers: noStoreHeaders })
    }

    const { data: partnerships, error: pErr } = await supabase
      .from("partnerships")
      .select("id")
      .eq("partner_id", user.id)

    if (pErr) {
      console.error("[api] partner active-engagement partnerships lookup failed", {
        userId: user.id,
        message: pErr.message,
        code: pErr.code,
      })
      return NextResponse.json({ error: "Failed to load partnerships" }, { status: 500, headers: noStoreHeaders })
    }

    const partnershipIds = (partnerships || []).map((p) => p.id as string)
    console.log("[api] partner active-engagement partnerships", {
      userId: user.id,
      projectId,
      partnershipCount: partnershipIds.length,
      partnershipIds,
    })

    if (partnershipIds.length === 0) {
      console.log("[api] partner active-engagement no partnerships — found false", { userId: user.id, projectId })
      return NextResponse.json({ found: false }, { headers: noStoreHeaders })
    }

    const { data: assignmentRows, error: asgErr } = await supabase
      .from("project_assignments")
      .select(
        `
        id,
        project_id,
        partnership_id,
        status,
        partnership:partnerships!inner(id, partner_id)
      `
      )
      .eq("project_id", projectId)
      .eq("status", "awarded")
      .in("partnership_id", partnershipIds)
      .order("updated_at", { ascending: false })
      .limit(5)

    if (asgErr) {
      console.error("[api] partner active-engagement assignments lookup failed", {
        userId: user.id,
        projectId,
        partnershipIds,
        message: asgErr.message,
        code: asgErr.code,
      })
      return NextResponse.json({ error: "Failed to load assignment" }, { status: 500, headers: noStoreHeaders })
    }

    const rows = assignmentRows || []
    console.log("[api] partner active-engagement assignments", {
      userId: user.id,
      projectId,
      rowCount: rows.length,
      assignments: rows.map((r) => ({
        id: r.id,
        project_id: r.project_id,
        partnership_id: r.partnership_id,
        status: r.status,
      })),
    })

    const assignment = rows[0] ?? null

    if (!assignment) {
      console.log("[api] partner active-engagement no awarded assignment", { userId: user.id, projectId, partnershipIds })
      return NextResponse.json({ found: false }, { headers: noStoreHeaders })
    }

    const partnershipId = assignment.partnership_id as string

    const { data: project, error: projectErr } = await supabase
      .from("projects")
      .select("id, name, agency_id")
      .eq("id", projectId)
      .maybeSingle()

    console.log("[api] partner active-engagement project lookup", {
      userId: user.id,
      projectId,
      projectErr: projectErr
        ? { message: projectErr.message, code: projectErr.code, details: projectErr.details }
        : null,
      hasProject: !!project,
    })

    if (projectErr) {
      console.error("[api] partner active-engagement project query error", {
        userId: user.id,
        projectId,
        message: projectErr.message,
        code: projectErr.code,
      })
      return NextResponse.json({ error: "Failed to load project" }, { status: 500, headers: noStoreHeaders })
    }

    if (!project) {
      console.log("[api] partner active-engagement project not found (RLS or missing row)", {
        userId: user.id,
        projectId,
        assignmentId: assignment.id,
      })
      return NextResponse.json({ error: "Project not found" }, { status: 404, headers: noStoreHeaders })
    }

    const projectName = ((project as { name?: string | null }).name || "").trim() || "Untitled project"
    const agencyId = (project as { agency_id: string }).agency_id

    const { data: leadAgency, error: agencyErr } = await supabase
      .from("profiles")
      .select("id, email, full_name, company_name")
      .eq("id", agencyId)
      .single()

    if (agencyErr) {
      console.error("[api] partner active-engagement agency profile", {
        message: agencyErr.message,
        code: agencyErr.code,
      })
    }

    const { data: respRows, error: respErr } = await supabase
      .from("partner_rfp_responses")
      .select(
        `
        id,
        proposal_text,
        budget_proposal,
        timeline_proposal,
        inbox_item_id,
        partner_id,
        updated_at,
        partner_rfp_inbox(project_id, scope_item_name, partnership_id)
      `
      )
      .eq("partner_id", user.id)
      .eq("status", "awarded")
      .eq("agency_id", agencyId)

    if (respErr) {
      console.error("[api] partner active-engagement responses", { message: respErr.message, code: respErr.code })
      return NextResponse.json({ error: "Failed to load bid" }, { status: 500, headers: noStoreHeaders })
    }

    const responses = (respRows || []) as AwardedResponseRow[]
    const resp = pickResponseForAssignment(responses, projectId, partnershipId, user.id)
    const inbox = resp ? inboxRow(resp.partner_rfp_inbox) : null

    const { data: pkg, error: pkgErr } = await supabase
      .from("onboarding_packages")
      .select(
        `
        id,
        kickoff_url,
        kickoff_type,
        created_at,
        onboarding_package_documents(id, label, url, sort_order)
      `
      )
      .eq("project_id", projectId)
      .eq("partnership_id", partnershipId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (pkgErr) {
      console.error("[api] partner active-engagement package", { message: pkgErr.message, code: pkgErr.code })
    }

    type DocRow = { id: string; label: string; url: string; sort_order: number | null }
    const rawDocs = (pkg as { onboarding_package_documents?: DocRow[] | null } | null)?.onboarding_package_documents
    const docs = (rawDocs || []).slice().sort((x, y) => (x.sort_order ?? 0) - (y.sort_order ?? 0))
    const onboardingDocuments = docs.map((d) => ({ label: d.label, url: d.url }))

    console.log("[api] success", { route: ROUTE, method: "GET", userId: user.id, found: true, projectId })

    return NextResponse.json(
      {
        found: true,
        assignmentId: assignment.id,
        partnershipId,
        project: {
          id: project.id,
          title: projectName,
        },
        leadAgency: leadAgency
          ? {
              email: leadAgency.email,
              fullName: leadAgency.full_name,
              companyName: leadAgency.company_name,
            }
          : null,
        scopeItemName: inbox?.scope_item_name ?? null,
        proposalText: resp?.proposal_text ?? "",
        budgetProposal: resp?.budget_proposal ?? "",
        timelineProposal: resp?.timeline_proposal ?? "",
        kickoffUrl: (pkg as { kickoff_url?: string | null } | null)?.kickoff_url ?? null,
        kickoffType: (pkg as { kickoff_type?: string | null } | null)?.kickoff_type ?? null,
        onboardingDocuments,
      },
      { headers: noStoreHeaders }
    )
  } catch (e) {
    console.error("[api] partner active-engagement unhandled error", {
      route: ROUTE,
      method: "GET",
      error: e instanceof Error ? e.message : String(e),
      stack: e instanceof Error ? e.stack : undefined,
    })
    return NextResponse.json({ error: "Failed" }, { status: 500, headers: noStoreHeaders })
  }
}
