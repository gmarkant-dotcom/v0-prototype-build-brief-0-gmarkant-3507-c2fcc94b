import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

const ROUTE = "/api/agency/active-engagements"

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

/** All awarded responses for this project + partnership + partner (one row per scope/bid in UI). */
function responsesForAssignment(
  rows: AwardedResponseRow[],
  projectId: string,
  partnershipId: string,
  partnerId: string
): AwardedResponseRow[] {
  const candidates = rows.filter((r) => {
    if (r.partner_id !== partnerId) return false
    const inbox = inboxRow(r.partner_rfp_inbox)
    if (!inbox || inbox.project_id !== projectId) return false
    if (inbox.partnership_id && inbox.partnership_id !== partnershipId) return false
    return true
  })
  candidates.sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""))
  return candidates
}

export async function GET(request: NextRequest) {
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

    console.log("[api] start", { route: ROUTE, method: "GET", userId: user.id })

    const projectIdFilter = request.nextUrl.searchParams.get("projectId")?.trim() || null

    const { data: projectRows, error: projErr } = await supabase
      .from("projects")
      .select("id, name")
      .eq("agency_id", user.id)

    if (projErr) {
      console.error("[api] active-engagements projects", { message: projErr.message, code: projErr.code })
      return NextResponse.json({ error: "Failed to load projects" }, { status: 500, headers: noStoreHeaders })
    }

    let agencyProjectIds = (projectRows || []).map((p) => p.id as string)
    if (projectIdFilter) {
      if (!agencyProjectIds.includes(projectIdFilter)) {
        console.log("[api] active-engagements projectId filter not in agency projects", {
          userId: user.id,
          projectIdFilter,
          agencyProjectCount: agencyProjectIds.length,
        })
        return NextResponse.json({ projects: [] }, { headers: noStoreHeaders })
      }
      agencyProjectIds = [projectIdFilter]
    }

    if (agencyProjectIds.length === 0) {
      console.log("[api] success", { route: ROUTE, method: "GET", userId: user.id, projectCount: 0 })
      return NextResponse.json({ projects: [] }, { headers: noStoreHeaders })
    }

    const titleByProjectId = new Map<string, string>()
    for (const p of projectRows || []) {
      const row = p as { id: string; name?: string | null }
      if (projectIdFilter && row.id !== projectIdFilter) continue
      titleByProjectId.set(row.id, (row.name || "").trim() || "Untitled project")
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

    type StatusUpdateRow = {
      id: string
      project_id: string
      partnership_id: string
      project_assignment_id: string
      status: string
      budget_status: string
      completion_pct: number
      notes: string | null
      is_resolved: boolean
      created_at: string
    }

    let allStatusRows: StatusUpdateRow[] = []
    if (agencyProjectIds.length > 0) {
      const { data: suRows, error: suErr } = await supabase
        .from("partner_status_updates")
        .select(
          "id, project_id, partnership_id, project_assignment_id, status, budget_status, completion_pct, notes, is_resolved, created_at"
        )
        .in("project_id", agencyProjectIds)

      if (suErr) {
        console.error("[api] active-engagements partner_status_updates", {
          message: suErr.message,
          code: suErr.code,
        })
      } else {
        allStatusRows = (suRows || []) as StatusUpdateRow[]
      }
    }

    function statusUpdatesForPartner(projectId: string, partnershipId: string): StatusUpdateRow[] {
      return allStatusRows
        .filter((r) => r.project_id === projectId && r.partnership_id === partnershipId)
        .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))
    }

    function isAlertRow(u: StatusUpdateRow): boolean {
      return !u.is_resolved && u.status !== "on_track" && u.status !== "complete"
    }

    function notesPreview60(notes: string | null): string {
      const t = (notes || "").trim()
      if (!t) return ""
      return t.length <= 60 ? t : `${t.slice(0, 60)}…`
    }

    function summarizeStatusUpdates(updates: StatusUpdateRow[]) {
      if (!updates.length) {
        return {
          current_status: null as string | null,
          completion_pct: 0,
          alert_count: 0,
          latest_alert: null as {
            id: string
            status: string
            budget_status: string
            completion_pct: number
            notes: string | null
            created_at: string
          } | null,
          alert_summaries: [] as { status: string; budget_status: string; notes_preview: string }[],
        }
      }
      const latest = updates[0]
      const unresolvedAlerts = updates.filter(isAlertRow)
      const latestAlert = unresolvedAlerts[0]
      return {
        current_status: latest.status,
        completion_pct: latest.completion_pct,
        alert_count: unresolvedAlerts.length,
        latest_alert: latestAlert
          ? {
              id: latestAlert.id,
              status: latestAlert.status,
              budget_status: latestAlert.budget_status,
              completion_pct: latestAlert.completion_pct,
              notes: latestAlert.notes,
              created_at: latestAlert.created_at,
            }
          : null,
        alert_summaries: unresolvedAlerts.map((u) => ({
          status: u.status,
          budget_status: u.budget_status,
          notes_preview: notesPreview60(u.notes),
        })),
      }
    }
    const partnerIds = [
      ...new Set(
        list
          .map((a) => {
            const raw = a.partnership as unknown
            const pship = unwrapRelation(
              raw as
                | { partner_id?: string }
                | { partner_id?: string }[]
                | null
            )
            return pship?.partner_id
          })
          .filter(Boolean),
      ),
    ] as string[]

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
    async function latestPackage(pid: string, partnershipId: string): Promise<OnboardingPkgRow | null> {
      const key = `${pid}:${partnershipId}`
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
        .eq("project_id", pid)
        .eq("partnership_id", partnershipId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()

      if (error) {
        console.error("[api] active-engagements onboarding package", {
          projectId: pid,
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
      /** partner_rfp_responses.id when this row is tied to a specific awarded bid; null for placeholder row */
      awardedResponseId: string | null
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
      current_status: string | null
      completion_pct: number
      alert_count: number
      latest_alert: {
        id: string
        status: string
        budget_status: string
        completion_pct: number
        notes: string | null
        created_at: string
      } | null
      alert_summaries: { status: string; budget_status: string; notes_preview: string }[]
    }

    const byProject = new Map<string, PartnerRow[]>()

    for (const a of list) {
      const projId = a.project_id as string
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

      const responses = responsesForAssignment(awardedResponses, projId, partnershipId, partnerId)

      const pkg = await latestPackage(projId, partnershipId)
      const docs = (pkg?.onboarding_package_documents || []).slice().sort((x, y) => (x.sort_order ?? 0) - (y.sort_order ?? 0))
      const onboardingDocuments = docs.map((d) => ({ label: d.label, url: d.url }))

      const statusSummary = summarizeStatusUpdates(statusUpdatesForPartner(projId, partnershipId))

      const baseRow = {
        assignmentId: a.id as string,
        partnershipId,
        awardedAt: (a.awarded_at as string | null) ?? null,
        partner: {
          companyName: partnerEmbed?.company_name ?? null,
          fullName: partnerEmbed?.full_name ?? null,
          email: partnerEmbed?.email ?? null,
        },
        kickoffUrl: pkg?.kickoff_url ?? null,
        kickoffType: pkg?.kickoff_type ?? null,
        onboardingDocuments,
        current_status: statusSummary.current_status,
        completion_pct: statusSummary.completion_pct,
        alert_count: statusSummary.alert_count,
        latest_alert: statusSummary.latest_alert,
        alert_summaries: statusSummary.alert_summaries,
      }

      const cur = byProject.get(projId) || []

      if (responses.length === 0) {
        const row: PartnerRow = {
          ...baseRow,
          awardedResponseId: null,
          scopeItemName: null,
          proposalText: "",
          budgetProposal: "",
          timelineProposal: "",
        }
        cur.push(row)
      } else {
        for (const resp of responses) {
          const inbox = inboxRow(resp.partner_rfp_inbox)
          const row: PartnerRow = {
            ...baseRow,
            awardedResponseId: resp.id,
            scopeItemName: inbox?.scope_item_name ?? null,
            proposalText: resp.proposal_text ?? "",
            budgetProposal: resp.budget_proposal ?? "",
            timelineProposal: resp.timeline_proposal ?? "",
          }
          cur.push(row)
        }
      }

      byProject.set(projId, cur)
    }

    const projects = Array.from(byProject.entries()).map(([pid, partners]) => ({
      id: pid,
      title: titleByProjectId.get(pid) || "Untitled project",
      partners,
    }))

    projects.sort((x, y) => x.title.localeCompare(y.title))

    console.log("[api] success", {
      route: ROUTE,
      method: "GET",
      userId: user.id,
      projectCount: projects.length,
      partnerRowCount: [...byProject.values()].reduce((n, rows) => n + rows.length, 0),
      assignmentCount: list.length,
      projectIdFilter,
    })

    return NextResponse.json({ projects }, { headers: noStoreHeaders })
  } catch (e) {
    console.error("[api] active-engagements unhandled error", {
      route: ROUTE,
      method: "GET",
      error: e instanceof Error ? e.message : String(e),
      stack: e instanceof Error ? e.stack : undefined,
    })
    return NextResponse.json({ error: "Failed" }, { status: 500, headers: noStoreHeaders })
  }
}
