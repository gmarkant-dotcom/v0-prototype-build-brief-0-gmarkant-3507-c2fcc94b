import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

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

type OnboardingDocRow = {
  id: string
  label: string
  url: string
  sort_order: number | null
}

type OnboardingPkgRow = {
  id: string
  kickoff_url: string | null
  kickoff_type: string | null
  created_at: string
  onboarding_package_documents: OnboardingDocRow[] | null
}

function inboxRow(embed: AwardedResponseRow["partner_rfp_inbox"]): InboxSnippet | null {
  if (!embed) return null
  return Array.isArray(embed) ? embed[0] ?? null : embed
}

function unwrapRelation<T>(x: T | T[] | null | undefined): T | null {
  if (x == null) return null
  return Array.isArray(x) ? x[0] ?? null : x
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

export async function GET() {
  const route = "/api/agency/active-engagements"
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStoreHeaders })
    }

    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single()
    if (profileErr || profile?.role !== "agency") {
      return NextResponse.json({ error: "Agency only" }, { status: 403, headers: noStoreHeaders })
    }

    console.log("[api] start", { route, method: "GET", userId: user.id, role: profile?.role })

    const { data: projectRows, error: projErr } = await supabase
      .from("projects")
      .select("id, title")
      .eq("agency_id", user.id)

    if (projErr) {
      console.error("[api] active-engagements projects", { message: projErr.message, code: projErr.code })
      return NextResponse.json({ error: "Failed to load projects" }, { status: 500, headers: noStoreHeaders })
    }

    const agencyProjectIds = (projectRows || []).map((p) => p.id as string)
    if (agencyProjectIds.length === 0) {
      console.log("[api] success", { route, method: "GET", userId: user.id, projectCount: 0 })
      return NextResponse.json({ projects: [] }, { headers: noStoreHeaders })
    }

    const titleByProjectId = new Map<string, string>()
    for (const p of projectRows || []) {
      titleByProjectId.set(p.id as string, (p.title as string) || "Untitled project")
    }

    const { data: assignments, error: asgErr } = await supabase
      .from("project_assignments")
      .select(
        `
        id,
        project_id,
        partnership_id,
        status,
        awarded_at,
        partnership:partnerships!inner(
          id,
          partner_id,
          partner:profiles!partnerships_partner_id_fkey(
            id,
            email,
            full_name,
            company_name
          )
        )
      `
      )
      .eq("status", "awarded")
      .in("project_id", agencyProjectIds)

    if (asgErr) {
      console.error("[api] active-engagements assignments", { message: asgErr.message, code: asgErr.code })
      return NextResponse.json({ error: "Failed to load assignments" }, { status: 500, headers: noStoreHeaders })
    }

    const list = assignments || []
    const partnerIds = [...new Set(list.map((a) => (a.partnership as { partner_id?: string })?.partner_id).filter(Boolean))] as string[]

    let awardedResponses: AwardedResponseRow[] = []
    if (partnerIds.length > 0) {
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
        .eq("agency_id", user.id)
        .eq("status", "awarded")
        .in("partner_id", partnerIds)

      if (respErr) {
        console.error("[api] active-engagements responses", { message: respErr.message, code: respErr.code })
        return NextResponse.json({ error: "Failed to load bid responses" }, { status: 500, headers: noStoreHeaders })
      }
      awardedResponses = (respRows || []) as AwardedResponseRow[]
    }

    const pkgCache = new Map<string, OnboardingPkgRow | null>()
    async function latestPackage(projectId: string, partnershipId: string): Promise<OnboardingPkgRow | null> {
      const key = `${projectId}:${partnershipId}`
      if (pkgCache.has(key)) return pkgCache.get(key) ?? null
      const { data, error } = await supabase
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

      if (error) {
        console.error("[api] active-engagements onboarding package", {
          projectId,
          partnershipId,
          message: error.message,
          code: error.code,
        })
        pkgCache.set(key, null)
        return null
      }
      const row = data as OnboardingPkgRow | null
      pkgCache.set(key, row)
      return row
    }

    type PartnerRow = {
      assignmentId: string
      partnershipId: string
      awardedAt: string | null
      partner: {
        companyName: string | null
        fullName: string | null
        email: string | null
      }
      scopeItemName: string | null
      proposalText: string
      budgetProposal: string
      timelineProposal: string
      kickoffUrl: string | null
      kickoffType: string | null
      onboardingDocuments: { label: string; url: string }[]
    }

    const byProject = new Map<string, PartnerRow[]>()

    for (const a of list) {
      const projectId = a.project_id as string
      const partnershipId = a.partnership_id as string
      const pship = unwrapRelation(
        a.partnership as unknown as
          | {
              id: string
              partner_id: string
              partner:
                | { email: string | null; full_name: string | null; company_name: string | null }
                | { email: string | null; full_name: string | null; company_name: string | null }[]
                | null
            }
          | null
      )
      const partnerEmbed = unwrapRelation(pship?.partner ?? null)
      const partnerId = pship?.partner_id
      if (!partnerId) continue

      const resp = pickResponseForAssignment(awardedResponses, projectId, partnershipId, partnerId)
      const inbox = resp ? inboxRow(resp.partner_rfp_inbox) : null

      const pkg = await latestPackage(projectId, partnershipId)
      const docs = (pkg?.onboarding_package_documents || []).slice().sort((x, y) => (x.sort_order ?? 0) - (y.sort_order ?? 0))
      const onboardingDocuments = docs.map((d) => ({ label: d.label, url: d.url }))

      const row: PartnerRow = {
        assignmentId: a.id as string,
        partnershipId,
        awardedAt: (a.awarded_at as string | null) ?? null,
        partner: {
          companyName: partnerEmbed?.company_name ?? null,
          fullName: partnerEmbed?.full_name ?? null,
          email: partnerEmbed?.email ?? null,
        },
        scopeItemName: inbox?.scope_item_name ?? null,
        proposalText: resp?.proposal_text ?? "",
        budgetProposal: resp?.budget_proposal ?? "",
        timelineProposal: resp?.timeline_proposal ?? "",
        kickoffUrl: pkg?.kickoff_url ?? null,
        kickoffType: pkg?.kickoff_type ?? null,
        onboardingDocuments,
      }

      const cur = byProject.get(projectId) || []
      cur.push(row)
      byProject.set(projectId, cur)
    }

    const projects = Array.from(byProject.entries()).map(([projectId, partners]) => ({
      id: projectId,
      title: titleByProjectId.get(projectId) || "Untitled project",
      partners,
    }))

    projects.sort((x, y) => x.title.localeCompare(y.title))

    console.log("[api] success", {
      route,
      method: "GET",
      userId: user.id,
      projectCount: projects.length,
      partnerRowCount: list.length,
    })

    return NextResponse.json({ projects }, { headers: noStoreHeaders })
  } catch (e) {
    console.error("[api] failure", {
      route,
      method: "GET",
      message: e instanceof Error ? e.message : String(e),
    })
    return NextResponse.json({ error: "Failed" }, { status: 500, headers: noStoreHeaders })
  }
}
