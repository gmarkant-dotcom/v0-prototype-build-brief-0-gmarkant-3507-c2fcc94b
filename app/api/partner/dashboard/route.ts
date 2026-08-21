import { resolveCallerOrgIds } from "@/lib/entitlements"
import { resolveActingOrgId } from "@/lib/acting-org"
import { vendorOwnsPartnerRfpInboxRow } from "@/lib/partner-inbox-access"
import { NextResponse } from "next/server"
import { requirePartnerRole } from "@/lib/api-auth"
import { isActivePartnership } from "@/lib/partnership-state"
import { ORG_CONTACT_SELECT, resolveOrgContact, type OrgEmbed } from "@/lib/org-contact"

export const dynamic = "force-dynamic"

const noStoreHeaders = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
} as const

// Effective statuses that mean "the partner has already responded" - anything else
// (new/viewed/draft/absent) still needs their action. Mirrors the same set
// app/partner/rfps/page.tsx and app/api/partner/rfps/route.ts already treat as responded.
const RESPONDED_STATUSES = new Set([
  "submitted",
  "bid_submitted",
  "revision_submitted",
  "under_review",
  "feedback_received",
  "shortlisted",
  "meeting_requested",
  "awarded",
  "declined",
])

type NeedsResponseItem = {
  id: string
  scopeItemName: string
  agencyName: string
  clientName: string | null
  deadline: string | null
  daysLeft: number | null
  ndaPending: boolean
}

type OnboardingItem = {
  id: string
  projectName: string
  agencyName: string
}

type ActivityItem = { id: string; text: string; href: string; timestamp: string }
const ACTIVITY_LIMIT = 15

export async function GET() {
  const route = "/api/partner/dashboard"
  try {
    const auth = await requirePartnerRole()
    if (!auth.authorized) return auth.response
    const { user, supabase } = auth
    // 079: this used to be `const partnerId = user.id`, and every filter below compared an
    // ORGANIZATION column to it. The alias is why this file appears in neither the
    // 188-site measurement of 2026-08-17 nor the 230-site one of 2026-08-18 - both
    // matched the literal token `user.id`. scripts/check-org-id-reads.mjs now resolves
    // one level of local aliasing, which is how it was found.
    const callerOrgIds = await resolveCallerOrgIds(user.id, supabase)

    // THE SAME READ-SCOPE DEFECT AS /api/partner/rfps, ON THE SAME TABLE, ON THE VENDOR
    // DASHBOARD. `partner_rfp_inbox` has an agency SELECT arm on `lead_org_id` and two vendor
    // SELECT arms, and permissive policies OR together, so an unqualified select hands a
    // dual-role caller their own OUTBOUND broadcasts as inbound bid opportunities.
    //
    // ITS OWN TWO SIBLINGS IN THIS Promise.all ALREADY CARRIED `.in("vendor_org_id",
    // callerOrgIds)` AND THE INBOX READ DID NOT. `callerOrgIds` was resolved on the line
    // above and simply not applied here. That is the shape of the whole class: the 079 rename
    // sweep rewrote every read that HAD a company filter, and a read with no filter to
    // rewrite was never visited.
    //
    // The email arm is applied in application code below rather than as a PostgREST filter,
    // because it compares lower(btrim()) on both sides and the nearest available operator,
    // ilike, would treat % and _ in a stored address as wildcards.
    //
    // RLS RELIANCE IS KEPT. The policy is still the wall. This decides which portal the row
    // belongs in, which no policy on this table can know.
    const actingOrg = await resolveActingOrgId(user.id, supabase)
    const actingOrgIds = actingOrg.orgId ? [actingOrg.orgId] : []
    if (!actingOrg.orgId) {
      console.error("[partner/dashboard] no acting organization, inbox narrows to the email arm only", {
        userId: user.id,
        reason: actingOrg.reason,
      })
    }
    const { data: emailProfile } = await supabase
      .from("profiles")
      .select("email")
      .eq("id", user.id)
      .maybeSingle<{ email: string | null }>()
    const vendorEmail = (emailProfile?.email || user.email || "").trim().toLowerCase()

    const [inboxRes, responsesRes, partnershipsRes] = await Promise.all([
      supabase
        .from("partner_rfp_inbox")
        .select(
          "id, lead_org_id, vendor_org_id, recipient_email, project_id, scope_item_name, status, response_deadline, nda_gate_enforced, nda_confirmed_at, created_at"
        ),
      supabase
        .from("partner_rfp_responses")
        .select("id, inbox_item_id, status, submitted_at, shortlisted_at, meeting_requested_at, declined_at")
        .in("vendor_org_id", callerOrgIds),
      // F3: no reliability_summary/reliability_summary_generated_at here - see the note above
      // the reliability computation below, this route must never carry that column at all.
      supabase.from("partnerships").select("id, lead_org_id, status").in("vendor_org_id", callerOrgIds),
    ])

    for (const [label, res] of [
      ["partner_rfp_inbox", inboxRes],
      ["partner_rfp_responses", responsesRes],
      ["partnerships", partnershipsRes],
    ] as const) {
      if (res.error) {
        console.error("[api] failure", { route, method: "GET", table: label, message: res.error.message })
        return NextResponse.json({ error: "Failed to load dashboard data" }, { status: 500, headers: noStoreHeaders })
      }
    }

    // Same comparison as /api/partner/rfps and /api/partner/rfps/[id], reached through the
    // one exported definition rather than restated. NDA-gated rows are KEPT - the dashboard's
    // "needs response" list is where a vendor learns an NDA is outstanding.
    const unscopedInboxRows = inboxRes.data || []
    const inboxRows = unscopedInboxRows.filter((row) =>
      vendorOwnsPartnerRfpInboxRow(
        {
          vendor_org_id: (row.vendor_org_id as string | null) ?? null,
          recipient_email: (row.recipient_email as string | null) ?? null,
        },
        actingOrgIds,
        vendorEmail
      )
    )
    if (unscopedInboxRows.length !== inboxRows.length) {
      console.log("[partner/dashboard] acting-role filter dropped rows the caller sees as the lead agency", {
        userId: user.id,
        returnedByRls: unscopedInboxRows.length,
        keptForVendorPortal: inboxRows.length,
        actingOrgResolution: actingOrg.reason,
      })
    }
    const responses = responsesRes.data || []
    const partnerships = partnershipsRes.data || []

    // Latest response per inbox item (an inbox row can have at most one live response in
    // practice, but guard the same way app/api/partner/rfps/route.ts does).
    const responseByInboxId = new Map<string, { status: string }>()
    for (const r of responses) {
      const key = r.inbox_item_id as string | null
      if (!key) continue
      responseByInboxId.set(key, { status: (r.status as string) || "" })
    }

    const agencyIds = new Set<string>()
    for (const row of inboxRows) if (row.lead_org_id) agencyIds.add(row.lead_org_id as string)
    for (const row of partnerships) if (row.lead_org_id) agencyIds.add(row.lead_org_id as string)

    const partnershipIds = partnerships.map((p) => p.id as string)

    // Activity feed sources with real timestamps, attributable to this partner - see
    // report for which event types were and weren't derivable this way.
    const [assignmentsRes, paidMilestonesRes, statusUpdatesRes] = await Promise.all([
      partnershipIds.length > 0
        ? supabase
            .from("project_assignments")
            .select("id, project_id, partnership_id, status, awarded_at")
            .in("partnership_id", partnershipIds)
            .eq("status", "awarded")
        : Promise.resolve({ data: [], error: null }),
      partnershipIds.length > 0
        ? supabase
            .from("payment_milestones")
            .select("id, project_id, title, paid_at")
            .in("partnership_id", partnershipIds)
            .not("paid_at", "is", null)
        : Promise.resolve({ data: [], error: null }),
      partnershipIds.length > 0
        ? supabase
            .from("partner_status_updates")
            .select("id, project_id, status, created_at")
            .in("partnership_id", partnershipIds)
        : Promise.resolve({ data: [], error: null }),
    ])

    for (const [label, res] of [
      ["project_assignments", assignmentsRes],
      ["payment_milestones", paidMilestonesRes],
      ["partner_status_updates", statusUpdatesRes],
    ] as const) {
      if (res.error) {
        console.error("[api] failure", { route, method: "GET", table: label, message: (res.error as { message: string }).message })
      }
    }

    const awardedAssignments = assignmentsRes.data || []
    const paidMilestones = paidMilestonesRes.data || []
    const statusUpdates = statusUpdatesRes.data || []

    const projectIds = new Set<string>()
    for (const row of inboxRows) if (row.project_id) projectIds.add(row.project_id as string)
    for (const row of awardedAssignments) if (row.project_id) projectIds.add(row.project_id as string)
    for (const row of paidMilestones) if (row.project_id) projectIds.add(row.project_id as string)
    for (const row of statusUpdates) if (row.project_id) projectIds.add(row.project_id as string)

    const [agenciesRes, projectsRes] = await Promise.all([
      // 079-ORG-ID-READ. Was `.from("profiles").in("id", <lead org ids>)` - invisible to
      // both guards (post-079 column name, no embed hint) and correct today only because
      // every backfilled organization id equals its founding user's id. A lead agency
      // organization created after 079 has a gen_random_uuid() id, matches no profiles
      // row, and every "Lead agency" label on this dashboard silently loses its name.
      agencyIds.size > 0
        ? supabase.from("organizations").select(ORG_CONTACT_SELECT).in("id", Array.from(agencyIds))
        : Promise.resolve({ data: [] as unknown[], error: null }),
      projectIds.size > 0
        ? supabase.from("projects").select("id, name, client_name").in("id", Array.from(projectIds))
        : Promise.resolve({ data: [] as { id: string; name: string | null; client_name: string | null }[], error: null }),
    ])

    const agencyNameById = new Map<string, string>()
    for (const a of (agenciesRes.data || []) as { id?: string | null }[]) {
      const contact = resolveOrgContact(a as OrgEmbed, null)
      // Same precedence the profiles read had: company, then the person. The literal
      // "Lead agency" fallback is unchanged - it fires when the row resolves with no name.
      const name = (contact.orgName || contact.contactFullName || "").trim()
      if (a.id) agencyNameById.set(a.id as string, name || "Lead agency")
    }
    const clientNameByProjectId = new Map<string, string | null>()
    const projectNameById = new Map<string, string>()
    for (const p of projectsRes.data || []) {
      clientNameByProjectId.set(p.id as string, (p.client_name as string | null) ?? null)
      projectNameById.set(p.id as string, (p.name as string | null) || "Project")
    }

    // ── Needs Your Response ──────────────────────────────────────────────────────
    const now = Date.now()
    const needsResponse: NeedsResponseItem[] = []
    let expiredCount = 0

    for (const row of inboxRows) {
      const resp = responseByInboxId.get(row.id as string)
      const effectiveStatus = resp?.status || (row.status as string) || "new"
      if (RESPONDED_STATUSES.has(effectiveStatus)) continue

      const deadline = (row.response_deadline as string | null) || null
      const deadlineMs = deadline ? new Date(deadline).getTime() : NaN
      const isExpired = deadline != null && Number.isFinite(deadlineMs) && deadlineMs < now

      if (isExpired) {
        expiredCount += 1
        continue
      }

      const daysLeft =
        deadline && Number.isFinite(deadlineMs) ? Math.ceil((deadlineMs - now) / (24 * 60 * 60 * 1000)) : null

      needsResponse.push({
        id: row.id as string,
        scopeItemName: (row.scope_item_name as string | null) || "Scope",
        agencyName: agencyNameById.get(row.lead_org_id as string) || "Lead agency",
        clientName: clientNameByProjectId.get((row.project_id as string | null) ?? "") ?? null,
        deadline,
        daysLeft,
        ndaPending: row.nda_gate_enforced === true && !row.nda_confirmed_at,
      })
    }

    needsResponse.sort((a, b) => {
      if (a.deadline == null && b.deadline == null) return 0
      if (a.deadline == null) return 1
      if (b.deadline == null) return -1
      return a.deadline.localeCompare(b.deadline)
    })

    // ── Onboarding steps pending on the partner's side ───────────────────────────
    let onboardingPending: OnboardingItem[] = []
    if (partnershipIds.length > 0) {
      const { data: packages, error: pkgErr } = await supabase
        .from("onboarding_packages")
        .select("id, project_id, partnership_id, partner_reviewed_at")
        .in("partnership_id", partnershipIds)
        .is("partner_reviewed_at", null)
      if (pkgErr) {
        console.error("[api] failure", { route, method: "GET", table: "onboarding_packages", message: pkgErr.message })
      } else if (packages && packages.length > 0) {
        const pkgProjectIds = [...new Set(packages.map((p) => p.project_id as string).filter(Boolean))]
        const partnershipAgencyById = new Map(partnerships.map((p) => [p.id as string, p.lead_org_id as string | null]))
        let pkgProjectNameById = new Map<string, string>()
        if (pkgProjectIds.length > 0) {
          const { data: pkgProjects } = await supabase.from("projects").select("id, name").in("id", pkgProjectIds)
          pkgProjectNameById = new Map((pkgProjects || []).map((p) => [p.id as string, (p.name as string | null) || "Project"]))
        }
        onboardingPending = packages.map((pkg) => {
          const agencyId = partnershipAgencyById.get(pkg.partnership_id as string) || null
          return {
            id: pkg.id as string,
            projectName: pkgProjectNameById.get(pkg.project_id as string) || "Project",
            agencyName: (agencyId && agencyNameById.get(agencyId)) || "Lead agency",
          }
        })
      }
    }

    // ── Funnel metrics ────────────────────────────────────────────────────────────
    const bidsByStatus = {
      submitted: 0,
      under_review: 0,
      shortlisted: 0,
      meeting_requested: 0,
      awarded: 0,
      declined: 0,
    }
    let bidsSubmitted = 0
    for (const r of responses) {
      const status = (r.status as string) || ""
      if (status === "draft") continue
      bidsSubmitted += 1
      if (status === "bid_submitted" || status === "submitted") bidsByStatus.submitted += 1
      else if (status === "under_review") bidsByStatus.under_review += 1
      else if (status === "shortlisted") bidsByStatus.shortlisted += 1
      else if (status === "meeting_requested") bidsByStatus.meeting_requested += 1
      else if (status === "awarded") bidsByStatus.awarded += 1
      else if (status === "declined") bidsByStatus.declined += 1
    }
    const terminalCount = bidsByStatus.awarded + bidsByStatus.declined
    const winRate = terminalCount > 0 ? bidsByStatus.awarded / terminalCount : null

    const agencyRelationships = partnerships.filter((p) => isActivePartnership(p)).length

    // ── Reliability ──────────────────────────────────────────────────────────────
    // F3 stopgap: reliability_summary (agency-facing AI text) is not selected or returned
    // here at all - a vendor-reachable payload must not carry it, not just hide it in the
    // UI. Structured metrics (avgCompositeScore, reviewCount) are unaffected. The real
    // per-review sharing gate ships later as migration 073.
    let reliability: {
      hasCompletedReviews: boolean
      avgCompositeScore: number | null
      reviewCount: number
    } = {
      hasCompletedReviews: false,
      avgCompositeScore: null,
      reviewCount: 0,
    }

    if (partnershipIds.length > 0) {
      const { data: reviews, error: reviewsErr } = await supabase
        .from("delivery_reviews")
        .select("id, composite_score")
        .in("partnership_id", partnershipIds)
        .eq("status", "complete")
      if (reviewsErr) {
        console.error("[api] failure", { route, method: "GET", table: "delivery_reviews", message: reviewsErr.message })
      } else {
        const scored = (reviews || []).filter((r) => r.composite_score != null)
        const avg =
          scored.length > 0
            ? scored.reduce((sum, r) => sum + Number(r.composite_score), 0) / scored.length
            : null
        reliability = {
          hasCompletedReviews: (reviews || []).length > 0,
          avgCompositeScore: avg,
          reviewCount: (reviews || []).length,
        }
      }
    }

    // ── Recent activity - union of every partner-attributable event with a real
    // timestamp. shortlisted_at/meeting_requested_at/declined_at (migration 069) are only
    // ever set going forward from the transition that produced them - see
    // app/api/agency/rfp-responses/[id]/route.ts - so older bids that transitioned before
    // this migration simply have no such event, not a wrong one. Awarded is included via
    // project_assignments.awarded_at, which predates this and already had a real timestamp.
    const activity: ActivityItem[] = []

    for (const row of inboxRows) {
      if (!row.created_at) continue
      const agencyName = agencyNameById.get(row.lead_org_id as string) || "A lead agency"
      activity.push({
        id: `rfp:${row.id}`,
        text: `${agencyName} sent an RFP for ${(row.scope_item_name as string | null) || "a scope item"}`,
        href: `/partner/rfps/${row.id}`,
        timestamp: row.created_at as string,
      })
      if (row.nda_confirmed_at) {
        activity.push({
          id: `nda:${row.id}`,
          text: `NDA confirmed for ${(row.scope_item_name as string | null) || "a scope item"}`,
          href: `/partner/rfps/${row.id}`,
          timestamp: row.nda_confirmed_at as string,
        })
      }
    }
    for (const r of responses) {
      const inbox = inboxRows.find((row) => row.id === r.inbox_item_id)
      const scopeName = (inbox?.scope_item_name as string | null) || "a scope item"
      const href = inbox ? `/partner/rfps/${inbox.id}` : "/partner/rfps"

      if (r.submitted_at) {
        activity.push({
          id: `bid:${r.id}`,
          text: `You submitted a bid for ${scopeName}`,
          href,
          timestamp: r.submitted_at as string,
        })
      }
      if (r.shortlisted_at) {
        activity.push({
          id: `shortlisted:${r.id}`,
          text: `Your bid for ${scopeName} was shortlisted`,
          href,
          timestamp: r.shortlisted_at as string,
        })
      }
      if (r.meeting_requested_at) {
        activity.push({
          id: `meeting:${r.id}`,
          text: `A meeting was requested for your bid on ${scopeName}`,
          href,
          timestamp: r.meeting_requested_at as string,
        })
      }
      if (r.declined_at) {
        activity.push({
          id: `declined:${r.id}`,
          text: `Your bid for ${scopeName} was declined`,
          href,
          timestamp: r.declined_at as string,
        })
      }
    }
    for (const a of awardedAssignments) {
      if (!a.awarded_at) continue
      const projectId = a.project_id as string
      activity.push({
        id: `awarded:${a.id}`,
        text: `You were awarded ${projectNameById.get(projectId) || "a project"}`,
        href: `/partner/projects/${encodeURIComponent(projectId)}`,
        timestamp: a.awarded_at as string,
      })
    }
    for (const m of paidMilestones) {
      if (!m.paid_at) continue
      const projectId = m.project_id as string
      activity.push({
        id: `paid:${m.id}`,
        text: `Payment received for ${(m.title as string | null) || "a milestone"} on ${projectNameById.get(projectId) || "a project"}`,
        href: "/partner/payments",
        timestamp: m.paid_at as string,
      })
    }
    for (const s of statusUpdates) {
      if (!s.created_at) continue
      const projectId = s.project_id as string
      activity.push({
        id: `status:${s.id}`,
        text: `You submitted a status update on ${projectNameById.get(projectId) || "a project"}`,
        href: `/partner/projects/${encodeURIComponent(projectId)}`,
        timestamp: s.created_at as string,
      })
    }

    activity.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    const recentActivity = activity.slice(0, ACTIVITY_LIMIT)

    return NextResponse.json(
      {
        needsResponse: { items: needsResponse, expiredCount, onboardingPending },
        funnel: {
          openRfps: needsResponse.length,
          bidsSubmitted,
          bidsByStatus,
          winRate: { awarded: bidsByStatus.awarded, declined: bidsByStatus.declined, rate: winRate },
          agencyRelationships,
        },
        reliability,
        activity: recentActivity,
      },
      { headers: noStoreHeaders }
    )
  } catch (e) {
    console.error("[api] failure", { route, method: "GET", message: e instanceof Error ? e.message : String(e) })
    return NextResponse.json({ error: "Failed to load dashboard data" }, { status: 500, headers: noStoreHeaders })
  }
}
