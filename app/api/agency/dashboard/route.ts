import { resolveCallerOrgIds } from "@/lib/entitlements"
import { NextResponse } from "next/server"
import { requireAgencyRole } from "@/lib/api-auth"
import { ORG_CONTACT_SELECT, resolveOrgContact, type OrgEmbed } from "@/lib/org-contact"
import { isActivePartnership } from "@/lib/partnership-state"
import { parseDoubleJson } from "@/lib/active-engagement-parse"
import {
  groupMilestoneRows,
  guestDisplayName,
  mapMilestoneGroup,
  mergeActivityEntries,
  milestoneDedupeKey,
  type ActivityActor,
  type ActivityEntry,
  type ActivityItem,
  type MilestoneFeedRow,
} from "@/lib/activity-feed"

export const dynamic = "force-dynamic"

// Alerts are unresolved partner_status_updates rows outside these statuses - same set
// app/api/projects/route.ts already uses for the (currently broken - see below) alert
// count on the old dashboard.
const ALERT_EXCLUDED_STATUSES = new Set(["on_track", "complete"])
const RFP_CLOSING_WINDOW_DAYS = 7
// Two different numbers that used to be one, and the coincidence was load-bearing in a way
// that stops being safe the moment anything groups. Design section 1.3.
//
// ACTIVITY_FETCH_LIMIT is a per-source SQL ceiling. RECENT_ACTIVITY_LIMIT is the number of
// LINES the caller is sent, applied last, strictly after grouping. A .limit(15) on the
// milestone query would return 15 rows, all 15 could belong to one broadcast, and the feed
// would render exactly ONE line and claim that is all the activity there is.
//
// 200 is chosen against live volume - the whole feed is ~25 lines all time and the largest
// single batch ever written is 49 - so it is roughly 4x the worst observed batch and still
// one page of rows. It is a ceiling, not a target, and hitting it is logged below.
//
// The arithmetic the user actually sees, since it is three caps and not two: the dashboard
// shows 5 (SECTION_LIST_CAP in app/agency/dashboard/page.tsx), "Show all" expands to the 15
// sent here, and those 15 are what grouping made of up to 200 fetched rows per source.
const ACTIVITY_FETCH_LIMIT = 200
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

/**
 * The agency feed's actor. Identical to the shared union except that a GUEST may also carry
 * the raw email address.
 *
 * Greg's ruling: the line shows the company name, falling back to the domain and then to
 * "A guest"; the raw email is also available to the agency, but only on the item detail or
 * hover, NEVER in the line itself. So the address is supplied by THIS resolver and is not a
 * member of the shared item shape - the vendor feed's resolver returns a bare
 * `ActivityActor` and never selects `actor_email` at all. Hidden is not absent: anyone
 * reading the vendor feed's JSON response would see whatever the shape allows.
 */
type AgencyActivityActor =
  | Exclude<ActivityActor, { kind: "guest" }>
  | { kind: "guest"; name: string; email: string | null }

type AgencyActivityItem = ActivityItem<AgencyActivityActor>

export async function GET() {
  const route = "/api/agency/dashboard"
  try {
    const auth = await requireAgencyRole()
    if (!auth.authorized) return auth.response
    const { user, supabase } = auth
    // 079: this used to be `const agencyId = user.id`, and every filter below compared an
    // ORGANIZATION column to it. The alias is why this file appears in neither the
    // 188-site measurement of 2026-08-17 nor the 230-site one of 2026-08-18 - both
    // matched the literal token `user.id`. scripts/check-org-id-reads.mjs now resolves
    // one level of local aliasing, which is how it was found.
    const callerOrgIds = await resolveCallerOrgIds(user.id, supabase)

    const [
      projectsRes,
      partnershipsRes,
      inboxRes,
      responsesRes,
      deliveryReviewsRes,
      magicTokenExistsRes,
      milestoneRes,
    ] = await Promise.all([
      supabase
        .from("projects")
        .select("id, name, client_name, status, budget_range, created_at")
        .in("org_id", callerOrgIds),
      supabase.from("partnerships").select("id, status, vendor_org_id, partner_email, created_at").in("lead_org_id", callerOrgIds),
      supabase
        .from("partner_rfp_inbox")
        .select("id, project_id, scope_item_id, scope_item_name, response_deadline, vendor_org_id, recipient_email, viewed_at, created_at")
        .in("lead_org_id", callerOrgIds),
      supabase
        .from("partner_rfp_responses")
        .select("id, inbox_item_id, vendor_org_id, partner_display_name, status, submitted_at, created_at, updated_at, budget_proposal")
        .in("lead_org_id", callerOrgIds)
        .order("created_at", { ascending: false })
        .limit(500),
      supabase
        .from("delivery_reviews")
        .select("id, project_id, partnership_id, assignment_id, status, updated_at")
        .in("org_id", callerOrgIds),
      // Existence-only check for the Getting Started checklist's "Broadcast an RFP" step -
      // the only one of the four checks not already covered by a table this route fetches
      // anyway (partner_rfp_inbox is, but a magic-link RFP with no portal recipient never
      // creates an inbox row, so that alone would under-count).
      supabase.from("rfp_magic_tokens").select("id").in("org_id", callerOrgIds).limit(1),
      // ── The fifth activity source. Design section 2: milestone_events JOINS the union,
      // it does not replace it. Three of the four union sources record a VENDOR act and
      // migration 080 ships no vendor-side INSERT policy, so they cannot be replaced until
      // that policy is designed; the fourth (project.create) waits only on an emitter.
      // What this adds is the agency half - who on THIS team did what - which the union
      // cannot express at all, because every one of its four sources is a counterparty
      // timestamp.
      //
      // THE SELECT LIST IS THE ACCESS CONTROL. `actor_email` is selected here because the
      // agency-side resolver may attach it to a guest actor for a hover; the vendor feed
      // must leave it out of its own select list rather than filter it later. `payload` is
      // selected but is NEVER passed through - lib/activity-feed.ts reads exactly one key
      // out of it. `rfp.broadcast` is whitelisted and RLS is row level, so its payload is
      // counterparty-readable in full and already carries `recipient_email`.
      //
      // ORDER BY created_at DESC LIMIT ACTIVITY_FETCH_LIMIT is what groupMilestoneRows()
      // assumes; it is what makes a batch a contiguous run and the ceiling handling sound.
      supabase
        .from("milestone_events")
        .select(
          "id, event_type, actor_id, actor_email, actor_side, vendor_org_id, partnership_id, subject_type, subject_id, payload, created_at"
        )
        .in("org_id", callerOrgIds)
        .order("created_at", { ascending: false })
        .limit(ACTIVITY_FETCH_LIMIT),
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

    // milestone_events is DELIBERATELY NOT in the loop above. A breadcrumb is strictly less
    // important than the dashboard it decorates - the same rule lib/milestone-events.ts
    // applies on the write side, where a failed insert never rolls back the award it
    // describes. A missing table (42P01 / PGRST205, migration 080 unapplied in some
    // environment) or a policy change must degrade this feed to its four derived sources,
    // not 500 the whole page.
    if (milestoneRes.error) {
      console.warn("[dashboard] milestone_events unreadable; feed degraded to derived sources", {
        route,
        code: milestoneRes.error.code,
        message: milestoneRes.error.message,
      })
    }
    const milestoneRows = (milestoneRes.error ? [] : milestoneRes.data || []) as unknown as MilestoneFeedRow[]

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
            // Was RECENT_ACTIVITY_LIMIT. A fetch ceiling and a display cap are two different
            // numbers - see the constant block above.
            .limit(ACTIVITY_FETCH_LIMIT)
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

    // Partner display names - resolved once for every vendor_org_id referenced anywhere
    // below (partnerships, inbox rows, assignments) so activity/attention rows can show a
    // real name instead of an email or raw id.
    //
    // 079-ORG-ID-READ. This read USED TO BE `.from("profiles").in("id", <vendor org ids>)`.
    // Both guards were green on it: the column name is already the post-079 one, so the
    // identity guard saw nothing, and there is no `table!hint(` embed, so the embed guard
    // saw nothing. It works today only because every organization 079 backfills carries
    // its founding user's id, which is the coincidence 079's own table comment warns
    // against relying on. The first vendor organization created after the migration gets
    // gen_random_uuid(), matches no profiles row, and every activity line about that
    // vendor silently reads "A vendor". Read the organization instead.
    const partnerIds = new Set<string>()
    for (const row of partnerships) if (row.vendor_org_id) partnerIds.add(row.vendor_org_id as string)
    for (const row of inboxRows) if (row.vendor_org_id) partnerIds.add(row.vendor_org_id as string)
    // Milestone rows too, so a `vendor.invite` or `msa.confirm` line names the vendor
    // organization instead of falling back to "a vendor". This is also what keeps
    // `payload.partner_email` out of the line: the name comes from the organizations read,
    // never from the payload, even though the payload has an address sitting right there.
    for (const row of milestoneRows) if (row.vendor_org_id) partnerIds.add(row.vendor_org_id)
    const { data: partnerOrgs } = partnerIds.size
      ? await supabase.from("organizations").select(ORG_CONTACT_SELECT).in("id", Array.from(partnerIds))
      : { data: [] as unknown[] }
    const partnerNameById = new Map<string, string>()
    for (const row of (partnerOrgs || []) as { id?: string | null }[]) {
      const contact = resolveOrgContact(row as OrgEmbed, null)
      // Same precedence the profiles read had: company, then the person, then the address.
      const name = (contact.orgName || contact.contactFullName || contact.contactEmail || "").trim()
      if (row.id && name) partnerNameById.set(row.id as string, name)
    }
    const partnershipById = new Map(partnerships.map((p) => [p.id as string, p]))

    // ── ONE identity rule for the whole feed ────────────────────────────────────
    //
    // Design section 7 / Greg's ruling: the line shows the COMPANY NAME. With no company,
    // fall back to the DOMAIN, then to "A guest". Never the local part, never the full
    // address, in the line - on either feed. The address is attached separately, for a
    // hover, and only here on the agency side.
    //
    // The access-control argument would be dishonest: 080's rule is that `actor_email` is
    // never rendered to a COUNTERPARTY, and this is not a counterparty surface. The agency
    // already holds these addresses. The argument is that in a five-word glanceable line
    // `j.tan@acmepost.com` is strictly worse than "Acme Post" at answering "who was that",
    // and that one rule beats two - the formatter with a raw-address branch is the one that
    // eventually ships to a vendor-facing surface with a latent harvest in it.
    //
    // This function REPLACES the old `partnerNameForPartnership`, whose last fallback was
    // `partnership.partner_email`, and it is applied at the same time as the narrowing of
    // the `recipient_email` fallback below, so the feed has one identity rule rather than a
    // new one beside the old one.
    function vendorActorForPartnership(partnershipId: string | null): AgencyActivityActor {
      const partnership = partnershipId ? partnershipById.get(partnershipId) : null
      const orgName = partnership?.vendor_org_id
        ? partnerNameById.get(partnership.vendor_org_id as string) || null
        : null
      if (orgName) return { kind: "counterparty", name: orgName }
      const email = (partnership?.partner_email as string | null | undefined) || null
      if (email) return { kind: "guest", name: guestDisplayName(null, email), email }
      return { kind: "counterparty", name: "A vendor" }
    }

    // ── Teammate names ──────────────────────────────────────────────────────────
    //
    // `self` vs `teammate` is the split that carries the whole ruling, and it is resolved
    // by comparing actor_id to user.id. The name for a teammate comes from profiles, which
    // is readable here because 079's "Users can view profiles of partnership members"
    // policy resolves through current_user_visible_profile_ids(), and that includes
    // colleagues in the caller's own organization. No service-role read is introduced and
    // none should be: this route runs on the cookie-scoped client and RLS is doing real
    // work.
    //
    // Only agency-side rows are looked up. A vendor-side actor_id is a person at another
    // company and their name is not this feed's to render - the counterparty is named by
    // ORGANIZATION, which is what keeps a vendor's whole team out of an agency's feed.
    const teammateIds = Array.from(
      new Set(
        milestoneRows
          .filter((r) => r.actor_side === "agency" && r.actor_id && r.actor_id !== user.id)
          .map((r) => r.actor_id as string)
      )
    )
    const teammateNameById = new Map<string, string>()
    if (teammateIds.length > 0) {
      // 079-ORG-ID-READ, NOT AN INSTANCE OF IT. `teammateIds` are milestone_events.actor_id
      // values. That column is a profiles(id) foreign key and 080's comment states it
      // explicitly - "the acting user, not a company: a profiles.id, and 079 did not rename
      // it". The NEARBY heuristic in scripts/check-org-id-reads.mjs fires only because
      // callerOrgIds is in scope in the same window, which is the milestone_events org
      // filter and not this one.
      const { data: teammates } = await supabase
        .from("profiles")
        .select("id, full_name, display_name")
        .in("id", teammateIds)
      for (const row of (teammates || []) as { id?: string | null; full_name?: string | null; display_name?: string | null }[]) {
        const name = (row.full_name || row.display_name || "").trim()
        if (row.id && name) teammateNameById.set(row.id, name)
      }
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
      const hasRecipient = Boolean(row.vendor_org_id || row.recipient_email)
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
    const activePartners = partnerships.filter((p) => isActivePartnership(p)).length
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
      // Display name only. client_name is kept reconciled with the linked client profile
      // by lib/clients-server.ts, so it is the single source for this and no client_id is
      // ever sent to the browser.
      clientName: (projectById.get(projectId)?.client_name as string | null | undefined) || null,
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
      // Display name only. client_name is kept reconciled with the linked client profile
      // by lib/clients-server.ts, so it is the single source for this and no client_id is
      // ever sent to the browser.
      clientName: (projectById.get(g.projectId)?.client_name as string | null | undefined) || null,
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
      // Display name only. client_name is kept reconciled with the linked client profile
      // by lib/clients-server.ts, so it is the single source for this and no client_id is
      // ever sent to the browser.
      clientName: (projectById.get(projectId)?.client_name as string | null | undefined) || null,
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
      // Display name only. client_name is kept reconciled with the linked client profile
      // by lib/clients-server.ts, so it is the single source for this and no client_id is
      // ever sent to the browser.
      clientName: (projectById.get(projectId)?.client_name as string | null | undefined) || null,
      count,
      href: `/agency/project?projectId=${encodeURIComponent(projectId)}`,
    }))

    const isBrandNew = projects.length === 0 && partnerships.length === 0

    // ── Getting Started checklist - four real state checks, no separate "onboarding
    // progress" table. Discovered partners count for step 1 (any status, not just active -
    // a ghost row from a spreadsheet import still means the step is done). Step 3 checks
    // both RFP delivery mechanisms since a magic-link-only broadcast never touches
    // partner_rfp_inbox. Step 4 covers both delivery mechanisms too - partner_rfp_responses
    // carries lead_org_id directly regardless of whether the bid came through the portal or
    // a guest link.
    const checklist = {
      importPartners: partnerships.length > 0,
      firstProject: projects.length > 0,
      broadcastRfp: inboxRows.length > 0 || hasMagicTokens,
      reviewBid: responses.length > 0,
    }

    // ── Activity feed ───────────────────────────────────────────────────────────
    //
    // FIVE sources: the four derived ones this route has always had, plus milestone_events.
    // Design section 2. The order of operations is fixed and the reason each step sits
    // where it does is the whole of design section 1.3:
    //
    //   fetch (<= ACTIVITY_FETCH_LIMIT per source)
    //     -> GROUP milestone rows        so one broadcast is one line
    //       -> map to ActivityItem
    //         -> merge + dedupe          so a milestone beats the union item it replaces
    //           -> sort
    //             -> CAP at RECENT_ACTIVITY_LIMIT   the only place 15 means "lines seen"
    //
    // Grouping before the cap is the part that is easy to get backwards. A 49-row broadcast
    // that is capped first is 15 identical lines and no room for anything else; grouped
    // first it is one line competing with the other sources on equal terms.
    //
    // `text` on every item below is a PREDICATE, not a sentence - no leading subject. The
    // renderer composes actor + predicate, which is what lets "You awarded the bid" and
    // "Dana Whitfield awarded the bid" be one code path and one string.
    const entries: ActivityEntry<AgencyActivityActor>[] = []

    // ── Source 1 (derived): projects created.
    // Actor is `system`: nothing in the projects table records WHO created the row. This is
    // the union source that section 2 marks as retirable first, and the only one that can
    // retire without a policy decision - a `project.create` emitter converts this line from
    // actor-less to attributed, at which point this loop is deleted and the dedupe below
    // stops it appearing twice in the meantime.
    for (const p of projects) {
      if (!p.created_at) continue
      entries.push({
        dedupeKey: `project:${p.id}`,
        item: {
          id: `project:${p.id}`,
          text: `created project ${p.name || "Untitled project"}`,
          href: `/agency/projects/${p.id}`,
          timestamp: p.created_at as string,
          actor: { kind: "system" },
          projectId: p.id as string,
          source: "derived",
        },
      })
    }

    // ── Source 2 (derived): bids submitted. Canonical key `bid:<response_id>` - a future
    // `bid.submit` emitter MUST set subject_id to the response id, not the inbox id, or the
    // two are undedupeable by anything except timestamp guessing.
    for (const r of responses) {
      if (!r.submitted_at) continue
      const inbox = r.inbox_item_id ? inboxById.get(r.inbox_item_id as string) : null
      const scopeName = (inbox?.scope_item_name as string | null) || "a scope item"
      const partnerName = (r.partner_display_name as string | null) || "A partner"
      entries.push({
        dedupeKey: `bid:${r.id}`,
        item: {
          id: `response:${r.id}`,
          text: `submitted a bid on ${scopeName}`,
          href: "/agency/bids",
          timestamp: r.submitted_at as string,
          actor: { kind: "counterparty", name: partnerName },
          projectId: (inbox?.project_id as string | undefined) || null,
          source: "derived",
        },
      })
    }

    // ── Source 3 (derived): RFPs viewed. Canonical key `rfp_inbox:<inbox_id>`.
    //
    // THIS IS THE LINE THE IDENTITY NARROWING TOUCHES. It used to read
    // `partnerName || row.recipient_email || "A vendor"` and put a raw address in the feed
    // whenever the vendor organization did not resolve. Now: organization name, then the
    // domain, then "A guest" - with the address carried on the actor for a hover only.
    for (const row of inboxRows) {
      if (!row.viewed_at) continue
      const orgName = row.vendor_org_id ? partnerNameById.get(row.vendor_org_id as string) || null : null
      const email = (row.recipient_email as string | null) || null
      const scopeName = (row.scope_item_name as string | null) || "a scope item"
      const actor: AgencyActivityActor = orgName
        ? { kind: "counterparty", name: orgName }
        : email
          ? { kind: "guest", name: guestDisplayName(null, email), email }
          : { kind: "counterparty", name: "A vendor" }
      entries.push({
        dedupeKey: `rfp_inbox:${row.id}`,
        item: {
          id: `viewed:${row.id}`,
          text: `viewed the RFP for ${scopeName}`,
          href: "/agency/bids",
          timestamp: row.viewed_at as string,
          actor,
          projectId: (row.project_id as string | null) || null,
          source: "derived",
        },
      })
    }

    // ── Source 4 (derived): onboarding acknowledgements. Canonical key
    // `onboarding_package:<pkg_id>`. Note MilestoneSubjectType in lib/milestone-events.ts
    // has no `onboarding_package` member yet; adding one is a one-line union-type change
    // and no migration, since subject_type is unconstrained text by design.
    for (const pkg of onboardingAcks) {
      if (!pkg.partner_reviewed_at) continue
      const projectId = pkg.project_id as string
      const projectName = (projectById.get(projectId)?.name as string | undefined) || "a project"
      entries.push({
        dedupeKey: `onboarding_package:${pkg.id}`,
        item: {
          id: `onboarding:${pkg.id}`,
          text: `acknowledged onboarding for ${projectName}`,
          href: `/agency/project?projectId=${encodeURIComponent(projectId)}`,
          timestamp: pkg.partner_reviewed_at as string,
          actor: vendorActorForPartnership(pkg.partnership_id as string | null),
          projectId,
          source: "derived",
        },
      })
    }

    // ── Source 5: milestone_events. The agency half of the feed.
    //
    // Every project id a milestone can name is resolved from ids this route already holds:
    // an `rfp.broadcast` subject IS a project id, and a `bid.*` subject is a response id
    // that reaches a project through the inbox row. Never from `payload.project_id`, which
    // exists on the bid.award payload - the payload is counterparty-readable and is not the
    // source of truth for anything rendered here.
    const projectIdByResponseId = new Map<string, string>()
    for (const r of responses) {
      const inbox = r.inbox_item_id ? inboxById.get(r.inbox_item_id as string) : null
      const projectId = inbox?.project_id as string | undefined
      if (projectId) projectIdByResponseId.set(r.id as string, projectId)
    }

    const unknownEventTypes = new Set<string>()
    const milestoneGroups = groupMilestoneRows(milestoneRows, ACTIVITY_FETCH_LIMIT, (info) => {
      // Design section 1.4. At current volume this never fires. The point is that on the
      // day it does, it reads as a CEILING rather than as a quiet feed - and it now means
      // two things at once: the feed may be incomplete, and a count may be short.
      console.warn("[dashboard] activity source hit the fetch ceiling; feed may be incomplete", {
        route,
        source: "milestone_events",
        limit: info.limit,
        singleBatchOverflow: info.singleBatchOverflow,
        discardedOldestTieGroup: info.discarded,
      })
    })

    for (const group of milestoneGroups) {
      const item = mapMilestoneGroup<AgencyActivityActor>(group, {
        // The injected resolver - the one thing that differs between this feed and the
        // vendor one. Design section 6.2.
        actor: (row) => {
          if (row.actor_side === "agency") {
            if (row.actor_id && row.actor_id === user.id) return { kind: "self" }
            if (row.actor_id) {
              return { kind: "teammate", name: teammateNameById.get(row.actor_id) || "A colleague" }
            }
            // Agency-side with no acting user. No emitter produces this today; a row that
            // named nobody would be a breadcrumb with no breadcrumb in it.
            return { kind: "system" }
          }
          const orgName = row.vendor_org_id ? partnerNameById.get(row.vendor_org_id) || null : null
          if (row.actor_id) return { kind: "counterparty", name: orgName || "A vendor" }
          // No account: a guest / magic-link actor. Organization name, then domain, then
          // "A guest"; the address rides along for a hover and never enters the line.
          return { kind: "guest", name: guestDisplayName(orgName, row.actor_email), email: row.actor_email ?? null }
        },
        counterpartyName: (row) => (row.vendor_org_id ? partnerNameById.get(row.vendor_org_id) || null : null),
        projectId: (row) => {
          if (row.subject_type === "project") return row.subject_id
          if (row.subject_type === "bid" && row.subject_id) {
            return projectIdByResponseId.get(row.subject_id) || null
          }
          return null
        },
        projectName: (projectId) =>
          (projectId ? (projectById.get(projectId)?.name as string | undefined) : undefined) || null,
        href: (row, projectId) => {
          if (row.subject_type === "bid") return "/agency/bids"
          if (projectId) return `/agency/project?projectId=${encodeURIComponent(projectId)}`
          if (row.subject_type === "partnership") return "/agency/pool"
          // A projectless broadcast. The GROUP is still correct; only the label degrades,
          // from "...on Northwind Rebrand" to "...to 49 vendors" with nowhere to point but
          // the bids page. Design section 1.2.
          return "/agency/bids"
        },
        onUnknownEventType: (type) => unknownEventTypes.add(type),
      })
      if (!item) continue
      entries.push({
        dedupeKey: milestoneDedupeKey(group.head, (info) => {
          console.warn("[dashboard] milestone subject_type disagrees with the union source it replaces", {
            route,
            ...info,
          })
        }),
        item,
      })
    }
    if (unknownEventTypes.size > 0) {
      // No line was rendered for these. Copy invented on the fly for an unrecognised event
      // type is worse than a missing line, so the miss is loud instead.
      console.warn("[dashboard] milestone event type has no feed predicate; rows skipped", {
        route,
        eventTypes: Array.from(unknownEventTypes),
      })
    }

    // Merge, dedupe, sort. UNCAPPED - lastActivityByProject below reads this array, and
    // capping first would make "last activity" lie for every project outside the newest 15
    // events. Design section 1.5.
    const activity: AgencyActivityItem[] = mergeActivityEntries(entries)
    const recentActivity = activity.slice(0, RECENT_ACTIVITY_LIMIT)

    // ── Recent projects - "last activity" is the freshest timestamp among this project's
    // own events in the merged, UNCAPPED array (falls back to created_at, which is always
    // present, so every project has a real timestamp - never a placeholder).
    //
    // This used to recover a project id with a regex over item.href, which silently
    // contributed NOTHING for any item whose href was not a project URL - the bids-submitted
    // and RFP-viewed sources both href to /agency/bids, so neither has ever counted as
    // activity on the project it belongs to. Every item now carries an explicit projectId
    // and the regex is deleted in the same change; leaving both is how the two drift.
    const lastActivityByProject = new Map<string, string>()
    for (const item of activity) {
      const projectId = item.projectId
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
