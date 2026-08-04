import { NextResponse } from "next/server"
import { requireAgencyRole } from "@/lib/api-auth"
import { parseDoubleJson } from "@/lib/active-engagement-parse"

export const dynamic = "force-dynamic"

// Alerts are unresolved partner_status_updates rows outside these statuses - same set
// app/api/projects/route.ts already uses for the (currently broken - see below) alert
// count on the old dashboard.
const ALERT_EXCLUDED_STATUSES = new Set(["on_track", "complete"])
const RFP_CLOSING_WINDOW_DAYS = 7
const RECENT_ACTIVITY_LIMIT = 15

// Same orchestration-funnel stage classification as app/api/projects/route.ts's
// dashboardWorkflowForProject - reused here (not imported, since that function is
// private to that file) rather than falling back to the raw projects.status column,
// which is this task's whole point: replace the fake progress bar with the real stage.
type WorkflowStageKey = "active_engagements" | "bid_management" | "rfp_broadcast" | "setup"
const WORKFLOW_STAGE_LABELS: Record<WorkflowStageKey, string> = {
  active_engagements: "Active Engagements",
  bid_management: "Bid Management",
  rfp_broadcast: "RFP Broadcast",
  setup: "Setup",
}
function workflowStageForProject(
  projectId: string,
  awardedProjectIds: Set<string>,
  bidProjectIds: Set<string>,
  inboxProjectIds: Set<string>
): WorkflowStageKey {
  if (awardedProjectIds.has(projectId)) return "active_engagements"
  if (bidProjectIds.has(projectId)) return "bid_management"
  if (inboxProjectIds.has(projectId)) return "rfp_broadcast"
  return "setup"
}

type BudgetJson = { amount?: number; currency?: string }

function parsePartnerBudgetProposal(raw: unknown): number | null {
  const o = parseDoubleJson<BudgetJson>(raw)
  if (!o || o.amount == null || !Number.isFinite(Number(o.amount))) return null
  return Number(o.amount)
}

function parseClientBudget(raw: unknown): number | null {
  if (raw == null) return null
  if (typeof raw === "number" && Number.isFinite(raw)) return raw
  if (typeof raw !== "string") return null
  const s = raw.replace(/[$,\s]/g, "").trim()
  if (!s) return null
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : null
}

function monthStartIso(): string {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
}

function quarterStartIso(): string {
  const now = new Date()
  const quarterMonth = Math.floor(now.getUTCMonth() / 3) * 3
  return new Date(Date.UTC(now.getUTCFullYear(), quarterMonth, 1)).toISOString()
}

type ActivityItem = { id: string; text: string; href: string; timestamp: string }

export async function GET() {
  const route = "/api/agency/dashboard"
  try {
    const auth = await requireAgencyRole()
    if (!auth.authorized) return auth.response
    const { user, supabase } = auth
    const agencyId = user.id

    const [projectsRes, partnershipsRes, inboxRes, responsesRes, deliveryReviewsRes, magicTokenExistsRes] = await Promise.all([
      supabase
        .from("projects")
        .select("id, name, client_name, status, budget_range, created_at")
        .eq("agency_id", agencyId),
      supabase.from("partnerships").select("id, status, partner_id, partner_email, created_at").eq("agency_id", agencyId),
      supabase
        .from("partner_rfp_inbox")
        .select("id, project_id, scope_item_id, scope_item_name, response_deadline, partner_id, recipient_email, viewed_at, created_at")
        .eq("agency_id", agencyId),
      supabase
        .from("partner_rfp_responses")
        .select("id, inbox_item_id, partner_id, partner_display_name, status, submitted_at, created_at, updated_at, budget_proposal")
        .eq("agency_id", agencyId)
        .order("created_at", { ascending: false })
        .limit(500),
      supabase
        .from("delivery_reviews")
        .select("id, project_id, partnership_id, assignment_id, status, updated_at")
        .eq("agency_id", agencyId),
      // Existence-only check for the Getting Started checklist's "Broadcast an RFP" step -
      // the only one of the four checks not already covered by a table this route fetches
      // anyway (partner_rfp_inbox is, but a magic-link RFP with no portal recipient never
      // creates an inbox row, so that alone would under-count).
      supabase.from("rfp_magic_tokens").select("id").eq("agency_id", agencyId).limit(1),
    ])

    for (const [label, res] of [
      ["projects", projectsRes],
      ["partnerships", partnershipsRes],
      ["partner_rfp_inbox", inboxRes],
      ["partner_rfp_responses", responsesRes],
      ["delivery_reviews", deliveryReviewsRes],
      ["rfp_magic_tokens", magicTokenExistsRes],
    ] as const) {
      if (res.error) {
        console.error("[api] failure", { route, method: "GET", table: label, message: res.error.message })
        return NextResponse.json({ error: "Failed to load dashboard data" }, { status: 500 })
      }
    }

    const projects = projectsRes.data || []
    const partnerships = partnershipsRes.data || []
    const inboxRows = inboxRes.data || []
    const responses = responsesRes.data || []
    const deliveryReviews = deliveryReviewsRes.data || []
    const hasMagicTokens = (magicTokenExistsRes.data || []).length > 0
    const projectIds = projects.map((p) => p.id as string)

    const [assignmentsRes, statusUpdatesRes, onboardingRes] = await Promise.all([
      projectIds.length > 0
        ? supabase
            .from("project_assignments")
            .select("id, project_id, partnership_id, status, awarded_at, created_at")
            .in("project_id", projectIds)
        : Promise.resolve({ data: [], error: null }),
      projectIds.length > 0
        ? supabase
            .from("partner_status_updates")
            .select("project_id, status, budget_status, completion_pct, notes, created_at")
            .in("project_id", projectIds)
            .eq("is_resolved", false)
        : Promise.resolve({ data: [], error: null }),
      projectIds.length > 0
        ? supabase
            .from("onboarding_packages")
            .select("id, project_id, partnership_id, partner_reviewed_at, created_at")
            .in("project_id", projectIds)
            .not("partner_reviewed_at", "is", null)
            .order("partner_reviewed_at", { ascending: false })
            .limit(RECENT_ACTIVITY_LIMIT)
        : Promise.resolve({ data: [], error: null }),
    ])

    for (const [label, res] of [
      ["project_assignments", assignmentsRes],
      ["partner_status_updates", statusUpdatesRes],
      ["onboarding_packages", onboardingRes],
    ] as const) {
      if (res.error) {
        console.error("[api] failure", { route, method: "GET", table: label, message: (res.error as { message: string }).message })
        return NextResponse.json({ error: "Failed to load dashboard data" }, { status: 500 })
      }
    }

    const assignments = assignmentsRes.data || []
    const statusUpdates = statusUpdatesRes.data || []
    const onboardingAcks = onboardingRes.data || []

    // Partner display names - resolved once for every partner_id referenced anywhere
    // below (partnerships, inbox rows, assignments) so activity/attention rows can show a
    // real name instead of an email or raw id.
    const partnerIds = new Set<string>()
    for (const row of partnerships) if (row.partner_id) partnerIds.add(row.partner_id as string)
    for (const row of inboxRows) if (row.partner_id) partnerIds.add(row.partner_id as string)
    const { data: partnerProfiles } = partnerIds.size
      ? await supabase.from("profiles").select("id, company_name, full_name, email").in("id", Array.from(partnerIds))
      : { data: [] as { id: string; company_name: string | null; full_name: string | null; email: string | null }[] }
    const partnerNameById = new Map<string, string>()
    for (const p of partnerProfiles || []) {
      const name = (p.company_name || p.full_name || p.email || "").trim()
      if (name) partnerNameById.set(p.id as string, name)
    }
    const partnershipById = new Map(partnerships.map((p) => [p.id as string, p]))
    function partnerNameForPartnership(partnershipId: string | null): string {
      if (!partnershipId) return "A partner"
      const partnership = partnershipById.get(partnershipId)
      if (!partnership) return "A partner"
      const byId = partnership.partner_id ? partnerNameById.get(partnership.partner_id as string) : null
      return byId || (partnership.partner_email as string | null) || "A partner"
    }

    const projectById = new Map(projects.map((p) => [p.id as string, p]))
    const inboxById = new Map(inboxRows.map((r) => [r.id as string, r]))
    // Every response for a given inbox row (a scope item sent to one recipient) - a
    // recipient has "responded" once any row exists here, regardless of its status.
    const responsesByInboxId = new Map<string, typeof responses>()
    for (const r of responses) {
      const key = r.inbox_item_id as string | null
      if (!key) continue
      const list = responsesByInboxId.get(key) || []
      list.push(r)
      responsesByInboxId.set(key, list)
    }

    // ── RFP groups: partner_rfp_inbox has no separate "RFP" entity - a broadcast RFP is
    // every inbox row sharing (project_id, scope_item_id). Grouped here once, reused for
    // both the "Open RFPs" funnel count and the "RFPs closing soon" attention item.
    type RfpGroup = {
      projectId: string
      scopeItemId: string
      scopeItemName: string
      deadline: string | null
      invited: number
      responded: number
    }
    const rfpGroups = new Map<string, RfpGroup>()
    for (const row of inboxRows) {
      const projectId = row.project_id as string | null
      const scopeItemId = row.scope_item_id as string | null
      if (!projectId || !scopeItemId) continue
      const key = `${projectId}:${scopeItemId}`
      const hasRecipient = Boolean(row.partner_id || row.recipient_email)
      const hasResponded = (responsesByInboxId.get(row.id as string) || []).length > 0
      const existing = rfpGroups.get(key)
      const deadline = (row.response_deadline as string | null) || null
      if (!existing) {
        rfpGroups.set(key, {
          projectId,
          scopeItemId,
          scopeItemName: (row.scope_item_name as string | null) || "Scope",
          deadline,
          invited: hasRecipient ? 1 : 0,
          responded: hasRecipient && hasResponded ? 1 : 0,
        })
      } else {
        if (hasRecipient) existing.invited += 1
        if (hasRecipient && hasResponded) existing.responded += 1
        // Every recipient in a broadcast shares the same deadline in practice; keep
        // whichever is earliest if they ever differ, so "closing soon" errs conservative.
        if (deadline && (!existing.deadline || deadline < existing.deadline)) existing.deadline = deadline
      }
    }
    const allRfpGroups = Array.from(rfpGroups.values())
    const openRfpGroups = allRfpGroups.filter((g) => g.responded < g.invited)

    // ── Funnel metrics ──────────────────────────────────────────────────────────
    const activePartners = partnerships.filter((p) => p.status === "active").length
    // Distinct projects with at least one open RFP scope item, not a count of open scope
    // items themselves - a project broadcasting 3 open scopes should read as 1 open RFP.
    const openRfps = new Set(openRfpGroups.map((g) => g.projectId)).size
    const monthStart = monthStartIso()
    const quarterStart = quarterStartIso()
    const bidsReceivedThisMonth = responses.filter(
      (r) => typeof r.submitted_at === "string" && r.submitted_at >= monthStart
    ).length
    const awardedThisQuarter = assignments.filter(
      (a) => a.status === "awarded" && typeof a.awarded_at === "string" && (a.awarded_at as string) >= quarterStart
    ).length

    let committedPartnerSpend = 0
    for (const r of responses) {
      if (r.status !== "awarded") continue
      const amount = parsePartnerBudgetProposal((r as { budget_proposal?: unknown }).budget_proposal)
      if (amount != null) committedPartnerSpend += amount
    }
    let totalClientBudget = 0
    for (const p of projects) {
      const amount = parseClientBudget(p.budget_range)
      if (amount != null) totalClientBudget += amount
    }

    // ── Attention queue ─────────────────────────────────────────────────────────
    const bidsAwaitingByProject = new Map<string, number>()
    for (const r of responses) {
      if (r.status !== "submitted") continue
      const inbox = r.inbox_item_id ? inboxById.get(r.inbox_item_id as string) : null
      const projectId = inbox?.project_id as string | undefined
      if (!projectId) continue
      bidsAwaitingByProject.set(projectId, (bidsAwaitingByProject.get(projectId) || 0) + 1)
    }
    const bidsAwaitingReview = Array.from(bidsAwaitingByProject.entries()).map(([projectId, count]) => ({
      projectId,
      projectName: (projectById.get(projectId)?.name as string | undefined) || "Untitled project",
      count,
      href: "/agency/bids",
    }))

    const now = Date.now()
    const closingCutoff = now + RFP_CLOSING_WINDOW_DAYS * 24 * 60 * 60 * 1000
    const rfpsClosingSoon = openRfpGroups
      .filter((g) => {
        if (!g.deadline) return false
        const t = new Date(g.deadline).getTime()
        return Number.isFinite(t) && t >= now && t <= closingCutoff
      })
      .map((g) => ({
        projectId: g.projectId,
        projectName: (projectById.get(g.projectId)?.name as string | undefined) || "Untitled project",
        scopeItemName: g.scopeItemName,
        deadline: g.deadline as string,
        invited: g.invited,
        pending: g.invited - g.responded,
        href: "/agency/bids",
      }))
      .filter((g) => g.pending > 0)
      .sort((a, b) => a.deadline.localeCompare(b.deadline))

    const completedAssignmentIds = new Set(
      assignments.filter((a) => a.status === "completed").map((a) => a.id as string)
    )
    const reviewedAssignmentIds = new Set(
      deliveryReviews.filter((r) => r.status === "complete" && r.assignment_id).map((r) => r.assignment_id as string)
    )
    const pendingDeliveryByProject = new Map<string, number>()
    for (const a of assignments) {
      if (a.status !== "completed") continue
      if (reviewedAssignmentIds.has(a.id as string)) continue
      const projectId = a.project_id as string
      pendingDeliveryByProject.set(projectId, (pendingDeliveryByProject.get(projectId) || 0) + 1)
    }
    const pendingDeliveryEvaluations = Array.from(pendingDeliveryByProject.entries()).map(([projectId, count]) => ({
      projectId,
      projectName: (projectById.get(projectId)?.name as string | undefined) || "Untitled project",
      count,
      href: `/agency/project?projectId=${encodeURIComponent(projectId)}`,
    }))

    const alertsByProject = new Map<string, number>()
    for (const s of statusUpdates) {
      if (ALERT_EXCLUDED_STATUSES.has(String(s.status || ""))) continue
      const projectId = s.project_id as string
      alertsByProject.set(projectId, (alertsByProject.get(projectId) || 0) + 1)
    }
    const alerts = Array.from(alertsByProject.entries()).map(([projectId, count]) => ({
      projectId,
      projectName: (projectById.get(projectId)?.name as string | undefined) || "Untitled project",
      count,
      href: `/agency/project?projectId=${encodeURIComponent(projectId)}`,
    }))

    const isBrandNew = projects.length === 0 && partnerships.length === 0

    // ── Getting Started checklist - four real state checks, no separate "onboarding
    // progress" table. Discovered partners count for step 1 (any status, not just active -
    // a ghost row from a spreadsheet import still means the step is done). Step 3 checks
    // both RFP delivery mechanisms since a magic-link-only broadcast never touches
    // partner_rfp_inbox. Step 4 covers both delivery mechanisms too - partner_rfp_responses
    // carries agency_id directly regardless of whether the bid came through the portal or
    // a guest link.
    const checklist = {
      importPartners: partnerships.length > 0,
      firstProject: projects.length > 0,
      broadcastRfp: inboxRows.length > 0 || hasMagicTokens,
      reviewBid: responses.length > 0,
    }

    // ── Activity feed - union of timestamped events from existing tables, no events
    // table involved. Newest first, capped at RECENT_ACTIVITY_LIMIT.
    const activity: ActivityItem[] = []
    for (const p of projects) {
      if (!p.created_at) continue
      activity.push({
        id: `project:${p.id}`,
        text: `Created project ${p.name || "Untitled project"}`,
        href: `/agency/projects/${p.id}`,
        timestamp: p.created_at as string,
      })
    }
    for (const r of responses) {
      if (!r.submitted_at) continue
      const inbox = r.inbox_item_id ? inboxById.get(r.inbox_item_id as string) : null
      const scopeName = (inbox?.scope_item_name as string | null) || "a scope item"
      const partnerName = (r.partner_display_name as string | null) || "A partner"
      activity.push({
        id: `response:${r.id}`,
        text: `${partnerName} submitted a bid on ${scopeName}`,
        href: "/agency/bids",
        timestamp: r.submitted_at as string,
      })
    }
    for (const row of inboxRows) {
      if (!row.viewed_at) continue
      const partnerName = row.partner_id ? partnerNameById.get(row.partner_id as string) : null
      const scopeName = (row.scope_item_name as string | null) || "a scope item"
      activity.push({
        id: `viewed:${row.id}`,
        text: `${partnerName || row.recipient_email || "A partner"} viewed the RFP for ${scopeName}`,
        href: "/agency/bids",
        timestamp: row.viewed_at as string,
      })
    }
    for (const pkg of onboardingAcks) {
      if (!pkg.partner_reviewed_at) continue
      const projectId = pkg.project_id as string
      const projectName = (projectById.get(projectId)?.name as string | undefined) || "a project"
      const partnerName = partnerNameForPartnership(pkg.partnership_id as string | null)
      activity.push({
        id: `onboarding:${pkg.id}`,
        text: `${partnerName} acknowledged onboarding for ${projectName}`,
        href: `/agency/project?projectId=${encodeURIComponent(projectId)}`,
        timestamp: pkg.partner_reviewed_at as string,
      })
    }
    activity.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    const recentActivity = activity.slice(0, RECENT_ACTIVITY_LIMIT)

    // ── Recent projects - "last activity" is the freshest timestamp among this
    // project's own events in the union above (falls back to created_at, which is
    // always present, so every project has a real timestamp - never a placeholder).
    const lastActivityByProject = new Map<string, string>()
    for (const item of activity) {
      const match = item.href.match(/^\/agency\/projects\/([^/?]+)/) || item.href.match(/projectId=([^&]+)/)
      const projectId = match ? decodeURIComponent(match[1]) : null
      if (!projectId) continue
      const current = lastActivityByProject.get(projectId)
      if (!current || item.timestamp > current) lastActivityByProject.set(projectId, item.timestamp)
    }
    const spendByProject = new Map<string, number>()
    for (const r of responses) {
      if (r.status !== "awarded") continue
      const inbox = r.inbox_item_id ? inboxById.get(r.inbox_item_id as string) : null
      const projectId = inbox?.project_id as string | undefined
      if (!projectId) continue
      const amount = parsePartnerBudgetProposal((r as { budget_proposal?: unknown }).budget_proposal)
      if (amount != null) spendByProject.set(projectId, (spendByProject.get(projectId) || 0) + amount)
    }

    const awardedProjectIds = new Set(
      assignments.filter((a) => a.status === "awarded").map((a) => a.project_id as string)
    )
    const bidProjectIds = new Set<string>()
    for (const r of responses) {
      if (r.status === "draft") continue
      const inbox = r.inbox_item_id ? inboxById.get(r.inbox_item_id as string) : null
      const projectId = inbox?.project_id as string | undefined
      if (projectId) bidProjectIds.add(projectId)
    }
    const inboxProjectIds = new Set(inboxRows.map((r) => r.project_id as string).filter(Boolean))

    // Full list, sorted newest-activity-first - there is no separate "all projects" page
    // in this app (checked: app/agency/projects only has a [id] detail route, no list
    // page), so "View all projects" on the dashboard expands this same array client-side
    // rather than linking anywhere; the dashboard shows the first 5 by default.
    const projectsByActivity = [...projects]
      .map((p) => {
        const stage = workflowStageForProject(p.id as string, awardedProjectIds, bidProjectIds, inboxProjectIds)
        return {
          id: p.id as string,
          name: (p.name as string | null) || "Untitled project",
          client: (p.client_name as string | null) || null,
          status: (p.status as string | null) || "draft",
          stage,
          stageLabel: WORKFLOW_STAGE_LABELS[stage],
          committedSpend: spendByProject.get(p.id as string) || 0,
          lastActivityAt: lastActivityByProject.get(p.id as string) || (p.created_at as string),
        }
      })
      .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt))

    return NextResponse.json({
      attention: {
        bidsAwaitingReview,
        rfpsClosingSoon,
        pendingDeliveryEvaluations,
        alerts,
        isBrandNew,
      },
      checklist,
      funnel: {
        activePartners,
        openRfps,
        bidsReceivedThisMonth,
        awardedThisQuarter,
        committedPartnerSpend,
        totalClientBudget,
      },
      projects: projectsByActivity,
      activity: recentActivity,
    })
  } catch (error) {
    console.error("[api] failure", {
      route,
      method: "GET",
      code: 500,
      message: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: "Failed to load dashboard data" }, { status: 500 })
  }
}
