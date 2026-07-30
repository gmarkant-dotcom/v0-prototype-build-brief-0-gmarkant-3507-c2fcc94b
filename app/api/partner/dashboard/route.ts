import { NextResponse } from "next/server"
import { requirePartnerRole } from "@/lib/api-auth"

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

export async function GET() {
  const route = "/api/partner/dashboard"
  try {
    const auth = await requirePartnerRole()
    if (!auth.authorized) return auth.response
    const { user, supabase } = auth
    const partnerId = user.id

    const [inboxRes, responsesRes, partnershipsRes] = await Promise.all([
      supabase
        .from("partner_rfp_inbox")
        .select(
          "id, agency_id, project_id, scope_item_name, status, response_deadline, nda_gate_enforced, nda_confirmed_at, created_at"
        ),
      supabase.from("partner_rfp_responses").select("id, inbox_item_id, status").eq("partner_id", partnerId),
      supabase.from("partnerships").select("id, agency_id, status, reliability_summary, reliability_summary_generated_at").eq("partner_id", partnerId),
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

    const inboxRows = inboxRes.data || []
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
    for (const row of inboxRows) if (row.agency_id) agencyIds.add(row.agency_id as string)
    for (const row of partnerships) if (row.agency_id) agencyIds.add(row.agency_id as string)

    const projectIds = new Set<string>()
    for (const row of inboxRows) if (row.project_id) projectIds.add(row.project_id as string)

    const [agenciesRes, projectsRes] = await Promise.all([
      agencyIds.size > 0
        ? supabase.from("profiles").select("id, company_name, full_name").in("id", Array.from(agencyIds))
        : Promise.resolve({ data: [] as { id: string; company_name: string | null; full_name: string | null }[], error: null }),
      projectIds.size > 0
        ? supabase.from("projects").select("id, client_name").in("id", Array.from(projectIds))
        : Promise.resolve({ data: [] as { id: string; client_name: string | null }[], error: null }),
    ])

    const agencyNameById = new Map<string, string>()
    for (const a of agenciesRes.data || []) {
      const name = ((a.company_name as string | null) || (a.full_name as string | null) || "").trim()
      agencyNameById.set(a.id as string, name || "Lead agency")
    }
    const clientNameByProjectId = new Map<string, string | null>()
    for (const p of projectsRes.data || []) {
      clientNameByProjectId.set(p.id as string, (p.client_name as string | null) ?? null)
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
        agencyName: agencyNameById.get(row.agency_id as string) || "Lead agency",
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
    const partnershipIds = partnerships.map((p) => p.id as string)
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
        const partnershipAgencyById = new Map(partnerships.map((p) => [p.id as string, p.agency_id as string | null]))
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

    const agencyRelationships = partnerships.filter((p) => p.status === "active").length

    // ── Reliability ──────────────────────────────────────────────────────────────
    let reliability: {
      hasCompletedReviews: boolean
      avgCompositeScore: number | null
      reviewCount: number
      reliabilitySummary: string | null
      reliabilitySummaryAgencyName: string | null
    } = {
      hasCompletedReviews: false,
      avgCompositeScore: null,
      reviewCount: 0,
      reliabilitySummary: null,
      reliabilitySummaryAgencyName: null,
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
          reliabilitySummary: null,
          reliabilitySummaryAgencyName: null,
        }
      }

      const withSummary = partnerships
        .filter((p) => p.reliability_summary)
        .sort((a, b) =>
          String(b.reliability_summary_generated_at || "").localeCompare(String(a.reliability_summary_generated_at || ""))
        )
      if (withSummary.length > 0) {
        const latest = withSummary[0]
        reliability.reliabilitySummary = latest.reliability_summary as string
        reliability.reliabilitySummaryAgencyName =
          (latest.agency_id && agencyNameById.get(latest.agency_id as string)) || "Lead agency"
      }
    }

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
      },
      { headers: noStoreHeaders }
    )
  } catch (e) {
    console.error("[api] failure", { route, method: "GET", message: e instanceof Error ? e.message : String(e) })
    return NextResponse.json({ error: "Failed to load dashboard data" }, { status: 500, headers: noStoreHeaders })
  }
}
