"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { PartnerLayout } from "@/components/partner-layout"
import { Button } from "@/components/ui/button"
import { cn, formatRelativeTime } from "@/lib/utils"
import { useFetch } from "@/hooks/useFetch"
import {
  isDemoMode,
  demoNeedsResponseItems,
  demoExpiredUnansweredCount,
  demoOnboardingPending,
  demoFunnelMetrics,
  demoReliability,
  demoPartnerActivity,
} from "@/lib/demo-data"
import { summarizePartnerMilestones } from "@/lib/partner-payments"
import { useLeadAgencyFilter } from "@/contexts/lead-agency-filter-context"
import { createClient } from "@/lib/supabase/client"
import { useSectionCollapse, useCappedList } from "@/lib/dashboard-section-state"
import { DashboardShowMoreToggle } from "@/components/dashboard-show-more"
import { HelpTerm } from "@/components/help-term"
import {
  AlertTriangle,
  Clock,
  ChevronRight,
  ChevronDown,
  Building2,
  Check,
  X,
  Clock3,
  Send,
  Award,
  Briefcase,
} from "lucide-react"

const SECTION_LIST_CAP = 5

function formatUsdWhole(amount: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(amount)
}

function formatDueDate(raw: string | null): string {
  if (!raw) return "No date set"
  const d = new Date(`${raw}T12:00:00`)
  if (isNaN(d.getTime())) return "No date set"
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

function formatDeadline(raw: string | null): string {
  if (!raw) return ""
  const d = new Date(raw)
  if (isNaN(d.getTime())) return ""
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

// ── Types ─────────────────────────────────────────────────────────────────────

type NeedsResponseItem = {
  id: string
  scopeItemName: string
  agencyName: string
  clientName: string | null
  deadline: string | null
  daysLeft: number | null
  ndaPending: boolean
}

type OnboardingPendingItem = { id: string; projectName: string; agencyName: string }

type BidsByStatus = {
  submitted: number
  under_review: number
  shortlisted: number
  meeting_requested: number
  awarded: number
  declined: number
}

type ActivityItem = { id: string; text: string; href: string; timestamp: string }

type DashboardData = {
  needsResponse: {
    items: NeedsResponseItem[]
    expiredCount: number
    onboardingPending: OnboardingPendingItem[]
  }
  funnel: {
    openRfps: number
    bidsSubmitted: number
    bidsByStatus: BidsByStatus
    winRate: { awarded: number; declined: number; rate: number | null }
    agencyRelationships: number
  }
  reliability: {
    hasCompletedReviews: boolean
    avgCompositeScore: number | null
    reviewCount: number
    reliabilitySummary: string | null
    reliabilitySummaryAgencyName: string | null
  }
  activity: ActivityItem[]
}

/** Needs Your Response renders two row kinds (RFP queue items and onboarding steps) as one
 *  capped list - this discriminated union lets useCappedList treat them uniformly while
 *  keeping each row's own render branch. */
type QueueRow =
  | { kind: "rfp"; key: string; item: NeedsResponseItem }
  | { kind: "onboarding"; key: string; item: OnboardingPendingItem }

type DashboardActiveProject = {
  id: string
  name: string
  client: string
  agencyName: string
}

type ProfileChecklist = {
  capabilities: boolean
  credentials: boolean
  reel: boolean
  legal: boolean
  payments: boolean
}

type MilestoneApiRow = {
  id: string
  title: string
  amount: number
  status: string
  due_date: string | null
  project_name: string
}

const PROFILE_NEXT_STEP: Record<keyof ProfileChecklist, { label: string; href: string }> = {
  capabilities: { label: "Add your capabilities", href: "/partner/profile" },
  credentials: { label: "Add your credentials", href: "/partner/profile" },
  reel: { label: "Add a reel or portfolio link", href: "/partner/profile" },
  legal: { label: "Complete your legal & compliance details", href: "/partner/legal" },
  payments: { label: "Add your rate information", href: "/partner/payments" },
}

function SectionSkeleton({ className }: { className?: string }) {
  return <div className={cn("bg-gray-100 rounded-xl animate-pulse", className)} />
}

export default function PartnerDashboardPage() {
  const isDemo = isDemoMode()
  const { connections, acceptInvitation, declineInvitation } = useLeadAgencyFilter()

  const { data: dashboardData, isLoading: dashboardLoading } = useFetch<DashboardData>(
    isDemo ? "" : "/api/partner/dashboard"
  )

  const [fetchedActiveProjects, setFetchedActiveProjects] = useState<DashboardActiveProject[]>([])
  const [activeProjectsLoading, setActiveProjectsLoading] = useState(!isDemo)
  const [paymentSummary, setPaymentSummary] = useState<{ paid: number; pending: number; count: number } | null>(null)
  const [paymentMilestones, setPaymentMilestones] = useState<MilestoneApiRow[]>([])
  const [paymentsLoading, setPaymentsLoading] = useState(!isDemo)
  const [profileChecklist, setProfileChecklist] = useState<ProfileChecklist>({
    capabilities: false,
    credentials: false,
    reel: false,
    legal: false,
    payments: false,
  })

  useEffect(() => {
    if (isDemo) {
      setProfileChecklist({ capabilities: true, credentials: true, reel: true, legal: true, payments: true })
      return
    }

    let cancelled = false
    ;(async () => {
      try {
        const supabase = createClient()
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (!user || cancelled) return

        const profileQuery = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle()
        const profileData = (profileQuery.data || {}) as {
          capabilities?: unknown
          credentials?: unknown
          reel_url?: string | null
          legal_entity_name?: string | null
          legal_entity_type?: string | null
          legal_ein?: string | null
          legal_address?: string | null
          legal_state_of_incorporation?: string | null
        }

        const partnershipsRes = await fetch("/api/partnerships", { credentials: "same-origin" })
        const partnershipsPayload = (await partnershipsRes.json().catch(() => ({}))) as {
          partnerships?: Array<{ id?: string; status?: string | null }>
        }
        const partnerships = Array.isArray(partnershipsPayload.partnerships) ? partnershipsPayload.partnerships : []
        const activePartnership = partnerships.find((p) => String(p.status || "").toLowerCase() === "active")

        let paymentInfoComplete = false
        if (activePartnership?.id) {
          const riRes = await fetch(
            `/api/partner/rate-info?partnershipId=${encodeURIComponent(String(activePartnership.id))}`,
            { credentials: "same-origin" },
          )
          const riData = (await riRes.json().catch(() => ({}))) as {
            rate_info?: { hourly_rate?: string; project_minimum?: string; payment_terms_custom?: string; notes?: string }
          }
          const ri = riData.rate_info || {}
          paymentInfoComplete = Boolean(
            String(ri.hourly_rate || "").trim() ||
              String(ri.project_minimum || "").trim() ||
              String(ri.payment_terms_custom || "").trim() ||
              String(ri.notes || "").trim(),
          )
        }

        const capabilities = Array.isArray(profileData.capabilities) ? profileData.capabilities : []
        const credentials = Array.isArray(profileData.credentials) ? profileData.credentials : []
        const reel = String(profileData.reel_url || "").trim()
        const legalComplete = Boolean(
          String(profileData.legal_entity_name || "").trim() &&
            String(profileData.legal_entity_type || "").trim() &&
            String(profileData.legal_ein || "").trim() &&
            String(profileData.legal_address || "").trim() &&
            String(profileData.legal_state_of_incorporation || "").trim(),
        )

        if (!cancelled) {
          setProfileChecklist({
            capabilities: capabilities.length > 0,
            credentials: credentials.length > 0,
            reel: reel.length > 0,
            legal: legalComplete,
            payments: paymentInfoComplete,
          })
        }
      } catch {
        if (!cancelled) {
          setProfileChecklist({ capabilities: false, credentials: false, reel: false, legal: false, payments: false })
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [isDemo])

  useEffect(() => {
    if (isDemo) {
      setFetchedActiveProjects([
        { id: "demo-project-nwsl", name: "NWSL Creator Content Series", client: "NWSL", agencyName: "Electric Animal" },
      ])
      setActiveProjectsLoading(false)
      return
    }
    let cancelled = false
    ;(async () => {
      setActiveProjectsLoading(true)
      try {
        const res = await fetch("/api/partner/projects", { credentials: "same-origin", cache: "no-store" })
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
        const raw = data?.projects
        const list = Array.isArray(raw) ? raw : []
        if (!cancelled && res.ok) {
          const mapped: DashboardActiveProject[] = []
          const seenProjectIds = new Set<string>()
          for (const item of list) {
            if (!item || typeof item !== "object") continue
            const p = item as Record<string, unknown>
            const id = p.project_id != null ? String(p.project_id).trim() : p.id != null ? String(p.id).trim() : ""
            if (!id || seenProjectIds.has(id)) continue
            seenProjectIds.add(id)
            const nameRaw = p.project_name != null ? String(p.project_name).trim() : ""
            const clientRaw = typeof p.client_name === "string" ? p.client_name.trim() : ""
            const agencyRaw = typeof p.agency_name === "string" ? p.agency_name.trim() : ""
            mapped.push({
              id,
              name: nameRaw || "Project",
              client: clientRaw || "Client TBD",
              agencyName: agencyRaw || "Lead agency",
            })
          }
          setFetchedActiveProjects(mapped)
        } else if (!cancelled) {
          setFetchedActiveProjects([])
        }
      } catch (e) {
        console.error("[partner/dashboard] /api/partner/projects", e)
        if (!cancelled) setFetchedActiveProjects([])
      } finally {
        if (!cancelled) setActiveProjectsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isDemo])

  // Paid to Date / Pending tiles AND the Upcoming Payments table both derive from this
  // single fetch + summarizePartnerMilestones (lib/partner-payments.ts) - the same
  // derivation the payments page uses - so the two surfaces can never disagree.
  useEffect(() => {
    if (isDemo) {
      setPaymentSummary(null)
      setPaymentMilestones([])
      setPaymentsLoading(false)
      return
    }
    let cancelled = false
    ;(async () => {
      setPaymentsLoading(true)
      try {
        const res = await fetch("/api/partner/payments", { credentials: "same-origin", cache: "no-store" })
        const data = (await res.json().catch(() => ({}))) as { milestones?: unknown }
        const list = Array.isArray(data.milestones) ? (data.milestones as MilestoneApiRow[]) : []
        if (!cancelled && res.ok) {
          const summary = summarizePartnerMilestones(
            list.map((m) => ({ amount: Number(m.amount) || 0, status: String(m.status || "") }))
          )
          setPaymentSummary({ ...summary, count: list.length })
          setPaymentMilestones(list)
        } else if (!cancelled) {
          setPaymentSummary({ paid: 0, pending: 0, count: 0 })
          setPaymentMilestones([])
        }
      } catch (e) {
        console.error("[partner/dashboard] /api/partner/payments", e)
        if (!cancelled) {
          setPaymentSummary({ paid: 0, pending: 0, count: 0 })
          setPaymentMilestones([])
        }
      } finally {
        if (!cancelled) setPaymentsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isDemo])

  const profileCompletion = {
    capabilities: profileChecklist.capabilities ? 100 : 0,
    credentials: profileChecklist.credentials ? 100 : 0,
    reel: profileChecklist.reel ? 100 : 0,
    legal: profileChecklist.legal ? 100 : 0,
    payments: profileChecklist.payments ? 100 : 0,
  }
  const totalCompletion = Math.round(
    Object.values(profileCompletion).reduce((a, b) => a + b, 0) / Object.keys(profileCompletion).length
  )
  const nextIncompleteKey = (Object.keys(profileChecklist) as (keyof ProfileChecklist)[]).find(
    (k) => !profileChecklist[k]
  )

  const profileCompletionBar = totalCompletion < 100 && (
    <div className="flex items-center justify-between gap-3 bg-[#0C3535]/5 border border-[#0C3535]/20 rounded-xl px-4 py-2.5">
      <div className="flex items-center gap-3 min-w-0">
        <span className="font-display font-bold text-sm text-[#0C3535] shrink-0">{totalCompletion}% Complete</span>
        <span className="text-sm text-gray-600 truncate">
          {nextIncompleteKey ? PROFILE_NEXT_STEP[nextIncompleteKey].label : "Finish setting up your profile"}
        </span>
      </div>
      <Link
        href={nextIncompleteKey ? PROFILE_NEXT_STEP[nextIncompleteKey].href : "/partner/profile"}
        className="shrink-0 font-mono text-xs text-[#0C3535] hover:underline whitespace-nowrap"
      >
        Complete Profile →
      </Link>
    </div>
  )

  const needsResponseItems: NeedsResponseItem[] = isDemo ? demoNeedsResponseItems : dashboardData?.needsResponse.items ?? []
  const expiredCount = isDemo ? demoExpiredUnansweredCount : dashboardData?.needsResponse.expiredCount ?? 0
  const onboardingPending: OnboardingPendingItem[] = isDemo
    ? demoOnboardingPending
    : dashboardData?.needsResponse.onboardingPending ?? []

  const funnel = isDemo ? demoFunnelMetrics : dashboardData?.funnel
  const reliability = isDemo ? demoReliability : dashboardData?.reliability
  const activityItems: ActivityItem[] = isDemo ? demoPartnerActivity : dashboardData?.activity ?? []

  const { collapsed: needsResponseCollapsed, toggle: toggleNeedsResponse } = useSectionCollapse(
    "partner",
    "needs-response"
  )
  const { collapsed: activityCollapsed, toggle: toggleActivity } = useSectionCollapse("partner", "recent-activity")

  const queueRows: QueueRow[] = useMemo(
    () => [
      ...needsResponseItems.map((item): QueueRow => ({ kind: "rfp", key: `rfp:${item.id}`, item })),
      ...onboardingPending.map((item): QueueRow => ({ kind: "onboarding", key: `onboarding:${item.id}`, item })),
    ],
    [needsResponseItems, onboardingPending]
  )
  const queueIsUrgent = (row: QueueRow) =>
    row.kind === "rfp" && ((row.item.daysLeft != null && row.item.daysLeft <= 7) || row.item.ndaPending)
  const {
    visible: visibleQueueRows,
    hasMore: queueHasMore,
    expanded: queueExpanded,
    toggle: toggleQueueExpanded,
    total: queueTotal,
  } = useCappedList(queueRows, SECTION_LIST_CAP, queueIsUrgent)

  const {
    visible: visibleActivity,
    hasMore: activityHasMore,
    expanded: activityExpanded,
    toggle: toggleActivityExpanded,
    total: activityTotal,
  } = useCappedList(activityItems, SECTION_LIST_CAP)

  const hasNoPayments = !isDemo && !paymentsLoading && (paymentSummary?.count ?? 0) === 0
  const paidTileValue = isDemo ? "$58,200" : paymentsLoading ? "-" : formatUsdWhole(paymentSummary?.paid ?? 0)
  const pendingTileValue = isDemo ? "$29,100" : paymentsLoading ? "-" : formatUsdWhole(paymentSummary?.pending ?? 0)

  const upcomingPaymentRows = useMemo(() => {
    if (isDemo) return []
    return paymentMilestones
      .filter((m) => String(m.status || "").toLowerCase() !== "paid")
      .sort((a, b) => String(a.due_date || "").localeCompare(String(b.due_date || "")))
  }, [isDemo, paymentMilestones])

  const bidsBreakdownParts: string[] = []
  if (funnel) {
    const b = funnel.bidsByStatus
    if (b.submitted > 0) bidsBreakdownParts.push(`${b.submitted} in review`)
    if (b.shortlisted > 0) bidsBreakdownParts.push(`${b.shortlisted} shortlisted`)
    if (b.meeting_requested > 0) bidsBreakdownParts.push(`${b.meeting_requested} meeting requested`)
  }

  const showEmptyState =
    !isDemo &&
    !dashboardLoading &&
    !activeProjectsLoading &&
    fetchedActiveProjects.length === 0 &&
    needsResponseItems.length === 0 &&
    (funnel?.bidsSubmitted ?? 0) === 0

  if (showEmptyState) {
    return (
      <PartnerLayout>
        <div className="space-y-6">
          {profileCompletionBar}
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center max-w-xl">
            <Briefcase className="w-12 h-12 mx-auto mb-4 text-gray-300" aria-hidden />
            <h3 className="font-display font-bold text-xl text-[#0C3535] mb-2">Welcome to Ligament</h3>
            <p className="text-gray-600">
              You don&apos;t have any open requests or active projects yet. Open RFPs from your lead agency partners
              will appear here as soon as they send them.
            </p>
            <Button asChild variant="outline" className="mt-6 border-[#0C3535]/30 text-[#0C3535] hover:bg-[#0C3535]/5">
              <Link href="/partner/rfps">Go to Open RFPs</Link>
            </Button>
          </div>
        </div>
      </PartnerLayout>
    )
  }

  return (
    <PartnerLayout>
      <div className="space-y-6">
        {profileCompletionBar}

        {/* Needs Your Response */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4 gap-3">
            <button type="button" onClick={toggleNeedsResponse} className="flex items-center gap-2 min-w-0 group">
              <ChevronDown
                className={cn(
                  "w-4 h-4 text-gray-400 shrink-0 transition-transform",
                  needsResponseCollapsed && "-rotate-90"
                )}
              />
              <h2 className="font-display font-bold text-lg text-[#0C3535] truncate group-hover:text-[#0C3535]/80">
                Needs Your Response ({queueRows.length})
              </h2>
            </button>
            <Link href="/partner/rfps" className="font-mono text-xs text-[#0C3535] hover:underline shrink-0">
              View All RFPs →
            </Link>
          </div>

          {needsResponseCollapsed ? null : !isDemo && dashboardLoading ? (
            <div className="space-y-2">
              <SectionSkeleton className="h-16" />
              <SectionSkeleton className="h-16" />
            </div>
          ) : needsResponseItems.length === 0 && onboardingPending.length === 0 ? (
            <p className="text-sm text-gray-500 py-2">
              No open requests right now - agencies you work with will appear here when they send RFPs.
            </p>
          ) : (
            <div className="space-y-2">
              {visibleQueueRows.map((row) => {
                if (row.kind === "onboarding") {
                  const item = row.item
                  return (
                    <Link
                      key={row.key}
                      href="/partner/onboarding"
                      className="flex items-center justify-between gap-4 p-4 rounded-lg border border-gray-200 hover:border-[#0C3535]/40 hover:shadow-sm transition-all"
                    >
                      <div className="min-w-0">
                        <div className="font-display font-bold text-sm text-[#0C3535] truncate">
                          Onboarding step pending - {item.projectName}
                        </div>
                        <div className="font-mono text-[10px] text-gray-500 mt-1">{item.agencyName}</div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
                    </Link>
                  )
                }

                const item = row.item
                const soon = item.daysLeft != null && item.daysLeft <= 7
                return (
                  <Link
                    key={row.key}
                    href={`/partner/rfps/${item.id}`}
                    className="flex items-start justify-between gap-4 p-4 rounded-lg border border-gray-200 hover:border-[#0C3535]/40 hover:shadow-sm transition-all"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-display font-bold text-sm text-[#0C3535] truncate">{item.scopeItemName}</span>
                        {item.ndaPending && (
                          <span className="flex items-center gap-1 font-mono text-[9px] px-2 py-0.5 rounded-full border border-amber-300 bg-amber-50 text-amber-700 shrink-0">
                            <AlertTriangle className="w-2.5 h-2.5" />
                            NDA required
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 font-mono text-[10px] text-gray-500 mt-1 flex-wrap">
                        <span className="flex items-center gap-1">
                          <Building2 className="w-3 h-3" />
                          {item.agencyName}
                        </span>
                        {item.clientName && (
                          <>
                            <span className="text-gray-300">·</span>
                            <span>{item.clientName}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      {item.deadline ? (
                        <span
                          className={cn(
                            "flex items-center gap-1 font-mono text-xs",
                            soon ? "text-red-600 font-bold" : "text-gray-500"
                          )}
                        >
                          <Clock className="w-3 h-3" />
                          {item.daysLeft != null && item.daysLeft >= 0
                            ? `${item.daysLeft} day${item.daysLeft === 1 ? "" : "s"} left`
                            : formatDeadline(item.deadline)}
                        </span>
                      ) : (
                        <span className="font-mono text-xs text-gray-400">No deadline set</span>
                      )}
                    </div>
                  </Link>
                )
              })}

              {queueHasMore && (
                <DashboardShowMoreToggle
                  hasMore={queueHasMore}
                  expanded={queueExpanded}
                  total={queueTotal}
                  onToggle={toggleQueueExpanded}
                  className="text-[#0C3535] pt-1"
                />
              )}
            </div>
          )}

          {!needsResponseCollapsed && expiredCount > 0 && (
            <div className="mt-3 pt-3 border-t border-gray-100">
              <Link href="/partner/rfps" className="text-xs text-gray-400 hover:text-gray-600 hover:underline">
                {expiredCount} request{expiredCount === 1 ? "" : "s"} expired unanswered
              </Link>
            </div>
          )}
        </div>

        {/* Funnel metrics + payments pair */}
        {!isDemo && dashboardLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <SectionSkeleton className="h-24" />
            <SectionSkeleton className="h-24" />
            <SectionSkeleton className="h-24" />
            <SectionSkeleton className="h-24" />
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Link href="/partner/rfps" className="bg-white rounded-xl border border-gray-200 p-5 text-center hover:border-[#0C3535]/30 transition-colors">
              <div className="font-display font-bold text-3xl text-[#0C3535]">{funnel?.openRfps ?? 0}</div>
              <div className="font-mono text-[10px] text-gray-500 uppercase tracking-wider mt-1">Open RFPs</div>
            </Link>
            <Link href="/partner/rfps" className="bg-white rounded-xl border border-gray-200 p-5 text-center hover:border-[#0C3535]/30 transition-colors">
              <div className="font-display font-bold text-3xl text-[#0C3535]">{funnel?.bidsSubmitted ?? 0}</div>
              <div className="font-mono text-[10px] text-gray-500 uppercase tracking-wider mt-1">Bids Submitted</div>
              {bidsBreakdownParts.length > 0 && (
                <div className="text-[10px] text-gray-400 mt-1 truncate">{bidsBreakdownParts.join(" · ")}</div>
              )}
            </Link>
            <Link href="/partner/rfps" className="bg-white rounded-xl border border-gray-200 p-5 text-center hover:border-[#0C3535]/30 transition-colors">
              <div className="font-display font-bold text-3xl text-[#0C3535]">
                {funnel?.winRate.rate != null ? `${Math.round(funnel.winRate.rate * 100)}%` : "-"}
              </div>
              <div className="font-mono text-[10px] text-gray-500 uppercase tracking-wider mt-1">Win Rate</div>
              <div className="text-[10px] text-gray-400 mt-1">
                {funnel && funnel.winRate.awarded + funnel.winRate.declined > 0
                  ? `${funnel.winRate.awarded} of ${funnel.winRate.awarded + funnel.winRate.declined} awarded`
                  : "No decided bids yet"}
              </div>
            </Link>
            <Link href="/partner/projects" className="bg-white rounded-xl border border-gray-200 p-5 text-center hover:border-[#0C3535]/30 transition-colors">
              <div className="font-display font-bold text-3xl text-[#0C3535]">
                {activeProjectsLoading ? "-" : fetchedActiveProjects.length}
              </div>
              <div className="font-mono text-[10px] text-gray-500 uppercase tracking-wider mt-1">Active Engagements</div>
            </Link>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4 max-w-2xl">
          <div
            className={cn(
              "rounded-xl p-5 text-center border",
              hasNoPayments ? "border-gray-200 bg-white" : "border-green-200 bg-green-50"
            )}
          >
            <div className={cn("font-display font-bold text-3xl", hasNoPayments ? "text-gray-400" : "text-green-600")}>
              {paidTileValue}
            </div>
            <Link
              href="/partner/payments"
              className={cn(
                "font-mono text-[10px] uppercase tracking-wider mt-1 hover:underline block",
                hasNoPayments ? "text-gray-400" : "text-green-600"
              )}
            >
              Paid to Date
            </Link>
            {hasNoPayments && <div className="text-[10px] text-gray-400 mt-0.5">No payments yet</div>}
          </div>
          <div
            className={cn(
              "rounded-xl p-5 text-center border",
              hasNoPayments ? "border-gray-200 bg-white" : "border-yellow-200 bg-yellow-50"
            )}
          >
            <div className={cn("font-display font-bold text-3xl", hasNoPayments ? "text-gray-400" : "text-yellow-600")}>
              {pendingTileValue}
            </div>
            <Link
              href="/partner/payments"
              className={cn(
                "font-mono text-[10px] uppercase tracking-wider mt-1 hover:underline block",
                hasNoPayments ? "text-gray-400" : "text-yellow-600"
              )}
            >
              Pending
            </Link>
            {hasNoPayments && <div className="text-[10px] text-gray-400 mt-0.5">No payments yet</div>}
          </div>
        </div>

        {/* Reliability / Performance */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Award className="w-5 h-5 text-[#0C3535]" />
              <HelpTerm term="delivery_performance" theme="light" className="font-display font-bold text-lg text-[#0C3535]">
                Your Performance
              </HelpTerm>
            </div>
            {!isDemo && (funnel?.agencyRelationships ?? 0) > 0 && (
              <span className="font-mono text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                {funnel?.agencyRelationships} agency relationship{funnel?.agencyRelationships === 1 ? "" : "s"}
              </span>
            )}
            {isDemo && (
              <span className="font-mono text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                {demoFunnelMetrics.agencyRelationships} agency relationships
              </span>
            )}
          </div>

          {!isDemo && dashboardLoading ? (
            <SectionSkeleton className="h-20" />
          ) : !reliability?.hasCompletedReviews ? (
            <p className="text-sm text-gray-500">
              Your delivery performance scores will appear here after your first completed project review.
            </p>
          ) : (
            <div className="flex items-start gap-4 flex-wrap">
              {reliability.avgCompositeScore != null && (
                <div className="flex items-center justify-center w-16 h-16 rounded-full border-4 border-[#0C3535]/20 shrink-0">
                  <span className="font-display font-bold text-2xl text-[#0C3535]">
                    {Math.round(reliability.avgCompositeScore * 10) / 10}
                  </span>
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="text-sm text-gray-600">
                  Average score across {reliability.reviewCount} completed review{reliability.reviewCount === 1 ? "" : "s"}
                </div>
                {reliability.reliabilitySummary && (
                  <p className="text-sm text-gray-700 mt-2 italic">
                    &quot;{reliability.reliabilitySummary}&quot;
                    {reliability.reliabilitySummaryAgencyName && (
                      <span className="not-italic text-gray-400"> - {reliability.reliabilitySummaryAgencyName}</span>
                    )}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Upcoming Payments */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display font-bold text-lg text-[#0C3535]">Upcoming Payments</h2>
            <Link href="/partner/payments" className="font-mono text-xs text-[#0C3535] hover:underline">
              Payment Settings →
            </Link>
          </div>
          {!isDemo && paymentsLoading ? (
            <SectionSkeleton className="h-24" />
          ) : upcomingPaymentRows.length === 0 ? (
            <p className="text-sm text-gray-500 py-2">No payments currently pending.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left font-mono text-[10px] text-gray-500 uppercase tracking-wider py-3">Project</th>
                    <th className="text-left font-mono text-[10px] text-gray-500 uppercase tracking-wider py-3">Milestone</th>
                    <th className="text-right font-mono text-[10px] text-gray-500 uppercase tracking-wider py-3">Amount</th>
                    <th className="text-right font-mono text-[10px] text-gray-500 uppercase tracking-wider py-3">Due Date</th>
                    <th className="text-right font-mono text-[10px] text-gray-500 uppercase tracking-wider py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {upcomingPaymentRows.map((payment) => (
                    <tr key={payment.id} className="border-b border-gray-100">
                      <td className="py-4 font-display font-bold text-sm text-[#0C3535]">{payment.project_name}</td>
                      <td className="py-4 text-sm text-gray-600">{payment.title}</td>
                      <td className="py-4 text-right font-mono text-sm text-[#0C3535]">{formatUsdWhole(payment.amount)}</td>
                      <td className="py-4 text-right font-mono text-xs text-gray-500">{formatDueDate(payment.due_date)}</td>
                      <td className="py-4 text-right">
                        <span className="font-mono text-[10px] px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 capitalize">
                          {payment.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Lead Agency Connections */}
        {connections.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <Building2 className="w-5 h-5 text-[#0C3535]" />
                <h2 className="font-display font-bold text-lg text-[#0C3535]">Lead Agency Connections</h2>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-mono text-[10px] px-2 py-0.5 rounded-full bg-green-100 text-green-600">
                  {connections.filter((c) => c.status === "confirmed").length} Confirmed
                </span>
                {connections.filter((c) => c.status === "pending").length > 0 && (
                  <span className="font-mono text-[10px] px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-600">
                    {connections.filter((c) => c.status === "pending").length} Pending
                  </span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {connections.map((connection) => {
                const getStatusConfig = () => {
                  switch (connection.status) {
                    case "confirmed":
                      return {
                        bg: "bg-green-50",
                        border: "border-green-200",
                        icon: <Check className="w-4 h-4 text-green-600" />,
                        label: "Confirmed",
                        labelBg: "bg-green-100 text-green-700",
                      }
                    case "accepted":
                      return {
                        bg: "bg-blue-50",
                        border: "border-blue-200",
                        icon: <Clock3 className="w-4 h-4 text-blue-600" />,
                        label: "Awaiting Confirmation",
                        labelBg: "bg-blue-100 text-blue-700",
                      }
                    case "pending":
                      return {
                        bg: "bg-yellow-50",
                        border: "border-yellow-200",
                        icon: <Send className="w-4 h-4 text-yellow-600" />,
                        label: "Invitation Pending",
                        labelBg: "bg-yellow-100 text-yellow-700",
                      }
                    case "declined":
                      return {
                        bg: "bg-gray-50",
                        border: "border-gray-200",
                        icon: <X className="w-4 h-4 text-gray-400" />,
                        label: "Declined",
                        labelBg: "bg-gray-100 text-gray-500",
                      }
                    default:
                      return { bg: "bg-gray-50", border: "border-gray-200", icon: null, label: "Unknown", labelBg: "bg-gray-100 text-gray-500" }
                  }
                }

                const statusConfig = getStatusConfig()

                return (
                  <div key={connection.id} className={cn("p-4 rounded-lg border transition-colors", statusConfig.bg, statusConfig.border)}>
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-full bg-[#0C3535] flex items-center justify-center flex-shrink-0">
                        <span className="text-xs font-bold text-white">
                          {connection.agencyName.split(" ").map((w) => w[0]).join("").slice(0, 2)}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-display font-bold text-sm text-[#0C3535] truncate">{connection.agencyName}</h4>
                        <p className="font-mono text-[10px] text-gray-500 mt-0.5">{connection.agencyLocation}</p>
                        <div className="flex items-center gap-1.5 mt-2">
                          {statusConfig.icon}
                          <span className={cn("font-mono text-[10px] px-1.5 py-0.5 rounded", statusConfig.labelBg)}>
                            {statusConfig.label}
                          </span>
                        </div>
                      </div>
                    </div>

                    {connection.invitationMessage && connection.status === "pending" && (
                      <p className="text-xs text-gray-600 mt-3 italic border-t border-gray-200/50 pt-3">
                        &quot;{connection.invitationMessage}&quot;
                      </p>
                    )}

                    {connection.status === "pending" && (
                      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-200/50">
                        <Button size="sm" onClick={() => acceptInvitation(connection.id)} className="flex-1 bg-[#0C3535] hover:bg-[#0C3535]/90 text-white text-xs">
                          Accept
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => declineInvitation(connection.id)} className="flex-1 text-xs text-gray-900 border-gray-300">
                          Decline
                        </Button>
                      </div>
                    )}

                    {connection.status === "confirmed" && (
                      <div className="mt-3 pt-3 border-t border-green-200/50">
                        <p className="font-mono text-[10px] text-green-600">
                          Connected since{" "}
                          {connection.confirmedAt
                            ? new Date(connection.confirmedAt).toLocaleDateString("en-US", { month: "short", year: "numeric" })
                            : "N/A"}
                        </p>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Active Projects */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display font-bold text-lg text-[#0C3535]">Active Projects</h2>
            <Link href="/partner/projects" className="font-mono text-xs text-[#0C3535] hover:underline">
              View All →
            </Link>
          </div>
          {activeProjectsLoading && !isDemo ? (
            <SectionSkeleton className="h-16" />
          ) : fetchedActiveProjects.length === 0 ? (
            <p className="text-sm text-gray-500 py-2">No active projects yet.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {fetchedActiveProjects.map((project) => (
                <Link
                  key={project.id}
                  href={`/partner/projects/${encodeURIComponent(project.id)}`}
                  className="block p-4 rounded-lg border border-gray-200 hover:border-[#0C3535]/30 transition-colors"
                >
                  <h4 className="font-display font-bold text-sm text-[#0C3535]">{project.name}</h4>
                  <div className="font-mono text-[10px] text-gray-500 mt-0.5">
                    {project.client} · {project.agencyName}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Recent Activity */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <button type="button" onClick={toggleActivity} className="flex items-center gap-2 min-w-0 group">
              <ChevronDown
                className={cn(
                  "w-4 h-4 text-gray-400 shrink-0 transition-transform",
                  activityCollapsed && "-rotate-90"
                )}
              />
              <h2 className="font-display font-bold text-lg text-[#0C3535] truncate group-hover:text-[#0C3535]/80">
                Recent Activity ({activityItems.length})
              </h2>
            </button>
          </div>

          {activityCollapsed ? null : !isDemo && dashboardLoading ? (
            <SectionSkeleton className="h-24" />
          ) : activityItems.length === 0 ? (
            <p className="text-sm text-gray-500 py-2">No activity yet.</p>
          ) : (
            <div className="space-y-1">
              {visibleActivity.map((item) => (
                <Link
                  key={item.id}
                  href={item.href}
                  className="flex items-center justify-between gap-3 py-2 border-b border-gray-100 last:border-0 hover:bg-gray-50/60 -mx-2 px-2 rounded"
                >
                  <span className="text-sm text-gray-700 min-w-0 truncate">{item.text}</span>
                  <span className="font-mono text-[10px] text-gray-400 shrink-0">{formatRelativeTime(item.timestamp)}</span>
                </Link>
              ))}
              {activityHasMore && (
                <DashboardShowMoreToggle
                  hasMore={activityHasMore}
                  expanded={activityExpanded}
                  total={activityTotal}
                  onToggle={toggleActivityExpanded}
                  className="text-[#0C3535] pt-2"
                />
              )}
            </div>
          )}
        </div>
      </div>
    </PartnerLayout>
  )
}
