"use client"

import { Suspense, useCallback, useEffect, useMemo, useState } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import { PartnerLayout } from "@/components/partner-layout"
import { LeadAgencyFilter } from "@/components/lead-agency-filter"
import { isDemoMode } from "@/lib/demo-data"
import { formatEngagementBudget, formatEngagementTimeline } from "@/lib/active-engagement-parse"
import { normalizeMeetingUrlForHref } from "@/lib/utils"
import {
  PARTNER_BUDGET_STATUSES,
  PARTNER_WORKFLOW_STATUSES,
  budgetStatusLabel,
  workflowStatusLabel,
} from "@/lib/partner-status"
import { Loader2, ExternalLink, ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Slider } from "@/components/ui/slider"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"

const btnOutlineLight =
  "border-vendor-border !bg-vendor-surface text-vendor-foreground shadow-sm hover:!bg-vendor-background hover:text-vendor-foreground"
const btnPrimaryDark = "bg-vendor-foreground text-white hover:bg-vendor-foreground/90"
const fieldClass = "border-vendor-border bg-vendor-surface text-vendor-foreground"

type EngagementItem = {
  assignmentId: string
  partnershipId: string
  awardedResponseId: string | null
  scopeItemName: string | null
  proposalText: string
  budgetProposal: string
  timelineProposal: string
  kickoffUrl: string | null
  kickoffType: string | null
  onboardingDocuments: { label: string; url: string }[]
}

type PagePayload = {
  found: boolean
  project?: { id: string; title: string }
  leadAgency?: {
    email: string | null
    fullName: string | null
    companyName: string | null
  } | null
  engagements: EngagementItem[]
}

type StatusUpdateRow = {
  id: string
  status: string
  budget_status: string
  completion_pct: number
  notes: string | null
  created_at: string
}

type AssignmentUiState = {
  latest: StatusUpdateRow | null
  updates: StatusUpdateRow[]
  loading: boolean
  saving: boolean
  error: string | null
  formStatus: string
  formBudget: string
  formPct: number
  formNotes: string
  historyOpen: boolean
  historyCardOpen: Record<string, boolean>
}

function engagementCardKey(e: EngagementItem): string {
  return e.awardedResponseId ? `${e.assignmentId}-${e.awardedResponseId}` : e.assignmentId
}

function defaultAssignmentUi(): AssignmentUiState {
  return {
    latest: null,
    updates: [],
    loading: false,
    saving: false,
    error: null,
    formStatus: "on_track",
    formBudget: "on_budget",
    formPct: 50,
    formNotes: "",
    historyOpen: false,
    historyCardOpen: {},
  }
}

function PartnerActiveEngagementInner() {
  const params = useParams()
  const projectId = params.projectId as string
  const isDemo = isDemoMode()

  const [pageData, setPageData] = useState<PagePayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(!isDemo)
  const [expandedCard, setExpandedCard] = useState<Record<string, boolean>>({})
  const [assignmentUi, setAssignmentUi] = useState<Record<string, AssignmentUiState>>({})

  const refreshAssignmentStatus = useCallback(
    async (assignmentId: string) => {
      if (isDemo) {
        const t = Date.now()
        const list: StatusUpdateRow[] = [
          {
            id: "demo-su",
            status: "on_track",
            budget_status: "on_budget",
            completion_pct: 62,
            notes: "All deliverables on schedule for this week.",
            created_at: new Date(t).toISOString(),
          },
          {
            id: "demo-su-prev-1",
            status: "at_risk",
            budget_status: "incremental_needed",
            completion_pct: 48,
            notes: "Waiting on client feedback before locking the cut list.",
            created_at: new Date(t - 3 * 86400000).toISOString(),
          },
          {
            id: "demo-su-prev-2",
            status: "on_track",
            budget_status: "on_budget",
            completion_pct: 35,
            notes: "Kickoff complete; production calendar shared with lead agency.",
            created_at: new Date(t - 10 * 86400000).toISOString(),
          },
        ]
        setAssignmentUi((prev) => ({
          ...prev,
          [assignmentId]: {
            ...(prev[assignmentId] ?? defaultAssignmentUi()),
            latest: list[0] ?? null,
            updates: list,
            loading: false,
            formStatus: list[0]?.status ?? prev[assignmentId]?.formStatus ?? "on_track",
            formBudget: list[0]?.budget_status ?? prev[assignmentId]?.formBudget ?? "on_budget",
            formPct: list[0]?.completion_pct ?? prev[assignmentId]?.formPct ?? 50,
          },
        }))
        return
      }
      setAssignmentUi((prev) => ({
        ...prev,
        [assignmentId]: { ...(prev[assignmentId] ?? defaultAssignmentUi()), loading: true },
      }))
      try {
        const q = new URLSearchParams({ assignmentId })
        const res = await fetch(`/api/partner/projects/${projectId}/status-update?${q}`, {
          credentials: "same-origin",
        })
        const json = await res.json().catch(() => ({}))
        if (res.ok) {
          const payload = json as { latest?: StatusUpdateRow | null; updates?: StatusUpdateRow[] }
          const latest = payload.latest ?? null
          const updates = Array.isArray(payload.updates) ? payload.updates : []
          setAssignmentUi((prev) => {
            const cur = prev[assignmentId] ?? defaultAssignmentUi()
            return {
              ...prev,
              [assignmentId]: {
                ...cur,
                latest,
                updates,
                loading: false,
                formStatus: latest?.status ?? cur.formStatus,
                formBudget: latest?.budget_status ?? cur.formBudget,
                formPct: latest?.completion_pct ?? cur.formPct,
              },
            }
          })
        } else {
          setAssignmentUi((prev) => ({
            ...prev,
            [assignmentId]: { ...(prev[assignmentId] ?? defaultAssignmentUi()), loading: false },
          }))
        }
      } catch {
        setAssignmentUi((prev) => ({
          ...prev,
          [assignmentId]: { ...(prev[assignmentId] ?? defaultAssignmentUi()), loading: false },
        }))
      }
    },
    [isDemo, projectId]
  )

  useEffect(() => {
    if (isDemo) {
      const sharedDocs = [
        { label: "Mutual NDA", url: "https://demo.withligament.com/sample-assets/nda" },
        { label: "MSA", url: "https://demo.withligament.com/sample-assets/msa" },
      ]
      setPageData({
        found: true,
        project: { id: projectId, title: "NWSL Creator Content Series" },
        leadAgency: {
          companyName: "Electric Animal",
          fullName: "Sarah Chen",
          email: "hello@demo.withligament.com",
        },
        engagements: [
          {
            assignmentId: "demo",
            partnershipId: "demo-ph",
            awardedResponseId: "demo-r1",
            scopeItemName: "Video production",
            proposalText:
              "We’d staff a modular production pod with a showrunner, DP, and post lead. Weekly cuts for review each Friday.",
            budgetProposal: JSON.stringify({ amount: 98000, currency: "USD" }),
            timelineProposal: JSON.stringify({ duration: 10, unit: "weeks" }),
            kickoffUrl: "https://calendly.com/demo/kickoff",
            kickoffType: "calendly",
            onboardingDocuments: sharedDocs,
          },
          {
            assignmentId: "demo",
            partnershipId: "demo-ph",
            awardedResponseId: "demo-r2",
            scopeItemName: "Social cutdowns",
            proposalText:
              "15–30s cutdowns per episode, platform-native captions, and a 4-week paid test plan.",
            budgetProposal: JSON.stringify({ amount: 24000, currency: "USD" }),
            timelineProposal: JSON.stringify({ duration: 4, unit: "weeks" }),
            kickoffUrl: "https://calendly.com/demo/kickoff",
            kickoffType: "calendly",
            onboardingDocuments: sharedDocs,
          },
        ],
      })
      void refreshAssignmentStatus("demo")
      setLoading(false)
      return
    }

    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/partner/projects/${projectId}/active-engagement`, {
          credentials: "same-origin",
        })
        const json = (await res.json().catch(() => ({}))) as PagePayload & { error?: string }
        if (!res.ok) {
          if (!cancelled) setError(json.error || "Failed to load")
          return
        }
        if (!cancelled) {
          setPageData({
            found: json.found,
            project: json.project,
            leadAgency: json.leadAgency ?? null,
            engagements: Array.isArray(json.engagements) ? json.engagements : [],
          })
        }
      } catch {
        if (!cancelled) setError("Failed to load")
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectId, isDemo, refreshAssignmentStatus])

  useEffect(() => {
    if (isDemo || !pageData?.engagements?.length) return
    const ids = [...new Set(pageData.engagements.map((e) => e.assignmentId))]
    setAssignmentUi((prev) => {
      const next = { ...prev }
      for (const id of ids) {
        if (!next[id]) next[id] = defaultAssignmentUi()
      }
      return next
    })
    for (const id of ids) {
      void refreshAssignmentStatus(id)
    }
  }, [pageData?.engagements, isDemo, refreshAssignmentStatus])

  const agencyName =
    pageData?.leadAgency?.companyName?.trim() ||
    pageData?.leadAgency?.fullName?.trim() ||
    "Lead agency"

  const kickoffFromFirst = pageData?.engagements?.[0]

  const uniqueAssignmentIds = useMemo(
    () => [...new Set(pageData?.engagements?.map((e) => e.assignmentId) ?? [])],
    [pageData?.engagements]
  )

  return (
    <PartnerLayout>
      <div className="p-8 max-w-3xl mx-auto space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <Link
              href="/partner/projects"
              className="font-mono text-xs text-vendor-foreground/70 hover:underline mb-2 inline-block"
            >
              ← All projects
            </Link>
            <h1 className="font-display font-bold text-3xl text-vendor-foreground">Active engagements</h1>
            {pageData?.found && pageData.project && (
              <p className="text-lg text-vendor-foreground mt-2 font-display font-semibold">{pageData.project.title}</p>
            )}
          </div>
          <LeadAgencyFilter />
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-vendor-muted py-12">
            <Loader2 className="w-5 h-5 animate-spin" />
            Loading…
          </div>
        )}

        {error && !loading && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-800">{error}</div>
        )}

        {!loading && !error && pageData && !pageData.found && (
          <div className="rounded-xl border border-vendor-border bg-vendor-background p-8 text-center text-vendor-foreground">
            No active engagement found for this project. You&apos;ll see details here after the lead agency awards your
            bid.
          </div>
        )}

        {!loading && !error && pageData?.found && pageData.engagements.length === 0 && (
          <div className="rounded-xl border border-vendor-border bg-vendor-background p-8 text-center text-vendor-foreground">
            No awarded scope items were found for this project yet.
          </div>
        )}

        {!loading && !error && pageData?.found && pageData.engagements.length > 0 && (
          <div className="space-y-6">
            <section className="bg-vendor-surface rounded-xl border border-vendor-border p-6 shadow-sm">
              <h2 className="font-display font-bold text-lg text-vendor-foreground mb-4">Lead agency contact</h2>
              <dl className="space-y-2 text-sm">
                <div>
                  <dt className="font-mono text-2xs uppercase text-vendor-muted">Company</dt>
                  <dd className="text-vendor-foreground">{pageData.leadAgency?.companyName || "-"}</dd>
                </div>
                <div>
                  <dt className="font-mono text-2xs uppercase text-vendor-muted">Contact name</dt>
                  <dd className="text-vendor-foreground">{pageData.leadAgency?.fullName || "-"}</dd>
                </div>
                <div>
                  <dt className="font-mono text-2xs uppercase text-vendor-muted">Email</dt>
                  <dd>
                    {pageData.leadAgency?.email ? (
                      <a
                        href={`mailto:${pageData.leadAgency.email}`}
                        className="text-vendor-foreground underline font-mono text-xs"
                      >
                        {pageData.leadAgency.email}
                      </a>
                    ) : (
                      "-"
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="font-mono text-2xs uppercase text-vendor-muted">Schedule Meeting</dt>
                  <dd>
                    {kickoffFromFirst?.kickoffUrl ? (
                      <a
                        href={normalizeMeetingUrlForHref(kickoffFromFirst.kickoffUrl)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-vendor-foreground font-medium hover:underline"
                      >
                        <ExternalLink className="w-4 h-4" />
                        {kickoffFromFirst.kickoffType === "calendly"
                          ? "Schedule a meeting"
                          : "Open scheduling link"}
                      </a>
                    ) : (
                      <span className="text-vendor-muted">Not provided yet</span>
                    )}
                  </dd>
                </div>
              </dl>
            </section>

            <div className="space-y-4">
              <h2 className="font-display font-bold text-lg text-vendor-foreground">Awarded scope items</h2>
              {pageData.engagements.map((eng) => {
                const ckey = engagementCardKey(eng)
                const open = expandedCard[ckey] ?? false
                const ui = assignmentUi[eng.assignmentId] ?? defaultAssignmentUi()
                const previousStatusUpdates = ui.updates.slice(1)

                return (
                  <Collapsible
                    key={ckey}
                    open={open}
                    onOpenChange={(v) => setExpandedCard((prev) => ({ ...prev, [ckey]: v }))}
                    className="bg-vendor-surface rounded-xl border border-vendor-border shadow-sm overflow-hidden"
                  >
                    <div className="p-5 border-b border-vendor-border/50">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <h3 className="font-display font-bold text-base text-vendor-foreground">
                            {eng.scopeItemName?.trim() || "Scope item"}
                          </h3>
                          <div className="mt-2 grid sm:grid-cols-2 gap-3 text-sm">
                            <div>
                              <div className="font-mono text-2xs uppercase text-vendor-muted">Proposed budget</div>
                              <div className="text-vendor-foreground">{formatEngagementBudget(eng.budgetProposal)}</div>
                            </div>
                            <div>
                              <div className="font-mono text-2xs uppercase text-vendor-muted">Proposed timeline</div>
                              <div className="text-vendor-foreground">{formatEngagementTimeline(eng.timelineProposal)}</div>
                            </div>
                          </div>
                        </div>
                        <CollapsibleTrigger asChild>
                          <Button type="button" variant="outline" size="sm" className={cn(btnOutlineLight, "shrink-0")}>
                            <span className="mr-1">{open ? "Collapse" : "Details & status"}</span>
                            <ChevronDown
                              className={cn("w-4 h-4 transition-transform", open && "rotate-180")}
                            />
                          </Button>
                        </CollapsibleTrigger>
                      </div>
                    </div>

                    <CollapsibleContent>
                      <div className="p-5 space-y-6 border-t border-vendor-border/50">
                        <div>
                          <h4 className="font-mono text-2xs uppercase text-vendor-muted mb-2">Proposal</h4>
                          <p className="text-sm text-vendor-foreground whitespace-pre-wrap leading-relaxed">
                            {(eng.proposalText || "").trim() || "-"}
                          </p>
                        </div>

                        <div>
                          <h4 className="font-display font-bold text-sm text-vendor-foreground mb-3">Documents</h4>
                          {(eng.onboardingDocuments || []).length === 0 ? (
                            <p className="text-sm text-vendor-muted">No onboarding documents have been shared yet.</p>
                          ) : (
                            <ul className="space-y-2">
                              {(eng.onboardingDocuments || []).map((d, i) => (
                                <li key={`${d.url}-${i}`}>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className={cn(btnOutlineLight, "justify-start h-auto py-2")}
                                    asChild
                                  >
                                    <a href={d.url} target="_blank" rel="noopener noreferrer">
                                      <ExternalLink className="w-3.5 h-3.5 mr-2 shrink-0" />
                                      {d.label}
                                    </a>
                                  </Button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>

                        <div className="rounded-xl border border-vendor-border bg-vendor-background/80 p-5 space-y-4">
                          <h4 className="font-display font-bold text-lg text-vendor-foreground">Project status</h4>
                          <p className="text-xs text-vendor-muted font-mono">
                            Updates apply to assignment{" "}
                            <span className="text-vendor-foreground">{eng.assignmentId.slice(0, 8)}…</span>
                            {uniqueAssignmentIds.length > 1 ? (
                              <span> (shared if you have multiple scopes on the same assignment)</span>
                            ) : null}
                          </p>
                          {ui.loading ? (
                            <div className="flex items-center gap-2 text-vendor-muted text-sm py-4">
                              <Loader2 className="w-4 h-4 animate-spin" />
                              Loading status…
                            </div>
                          ) : ui.latest ? (
                            <div className="space-y-3 mb-6 pb-6 border-b border-vendor-border">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-mono text-2xs uppercase text-vendor-muted">Latest update</span>
                                <span className="text-xs px-2 py-0.5 rounded-full bg-vendor-foreground/10 text-vendor-foreground font-medium">
                                  {workflowStatusLabel(ui.latest.status)}
                                </span>
                                <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-900 border border-amber-200">
                                  {budgetStatusLabel(ui.latest.budget_status)}
                                </span>
                              </div>
                              <div>
                                <div className="flex justify-between text-xs text-vendor-muted mb-1">
                                  <span>Completion</span>
                                  <span>{ui.latest.completion_pct}%</span>
                                </div>
                                <div className="h-2 rounded-full bg-vendor-track overflow-hidden">
                                  <div
                                    className="h-full bg-vendor-foreground/80 rounded-full"
                                    style={{ width: `${ui.latest.completion_pct}%` }}
                                  />
                                </div>
                              </div>
                              {ui.latest.notes && (
                                <p className="text-sm text-vendor-foreground whitespace-pre-wrap">{ui.latest.notes}</p>
                              )}
                              <p className="font-mono text-2xs text-vendor-muted/70">
                                {new Date(ui.latest.created_at).toLocaleString()}
                              </p>
                            </div>
                          ) : (
                            <p className="text-sm text-vendor-muted mb-6">No status updates yet. Submit your first update below.</p>
                          )}

                          <div className="bg-vendor-surface rounded-xl border border-vendor-border p-4 mb-6">
                            <button
                              type="button"
                              className="w-full flex items-center justify-between gap-3 text-left text-vendor-foreground"
                              onClick={() =>
                                setAssignmentUi((prev) => {
                                  const cur = prev[eng.assignmentId] ?? defaultAssignmentUi()
                                  return {
                                    ...prev,
                                    [eng.assignmentId]: { ...cur, historyOpen: !cur.historyOpen },
                                  }
                                })
                              }
                            >
                              <h5 className="font-display font-bold text-base text-vendor-foreground">Update history</h5>
                              <span className="text-sm text-vendor-muted-strong shrink-0">
                                {ui.historyOpen ? "Hide" : "Show"}
                              </span>
                            </button>
                            {ui.historyOpen && (
                              <div className="mt-4 space-y-3">
                                {ui.loading ? (
                                  <div className="flex items-center gap-2 text-vendor-muted text-sm py-2">
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    Loading history…
                                  </div>
                                ) : previousStatusUpdates.length === 0 ? (
                                  <p className="text-sm text-vendor-muted-strong">No earlier updates.</p>
                                ) : (
                                  previousStatusUpdates.map((u) => {
                                    const cardOpen = ui.historyCardOpen[u.id] ?? false
                                    return (
                                      <div key={u.id} className="rounded-lg border border-vendor-border bg-vendor-background p-4">
                                        <button
                                          type="button"
                                          className="w-full flex items-start justify-between gap-3 text-left text-vendor-foreground"
                                          onClick={() =>
                                            setAssignmentUi((prev) => {
                                              const cur = prev[eng.assignmentId] ?? defaultAssignmentUi()
                                              return {
                                                ...prev,
                                                [eng.assignmentId]: {
                                                  ...cur,
                                                  historyCardOpen: {
                                                    ...cur.historyCardOpen,
                                                    [u.id]: !cardOpen,
                                                  },
                                                },
                                              }
                                            })
                                          }
                                        >
                                          <div className="min-w-0 flex-1 space-y-2">
                                            <div className="flex flex-wrap items-center gap-2">
                                              <span className="text-xs px-2 py-0.5 rounded-full bg-vendor-foreground/10 text-vendor-foreground font-medium">
                                                {workflowStatusLabel(u.status)}
                                              </span>
                                              <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-900 border border-amber-200">
                                                {budgetStatusLabel(u.budget_status)}
                                              </span>
                                              <span className="font-mono text-2xs text-vendor-muted-strong">{u.completion_pct}%</span>
                                            </div>
                                            <div className="font-mono text-2xs text-vendor-muted">
                                              {new Date(u.created_at).toLocaleString()}
                                            </div>
                                            {!cardOpen && (
                                              <p className="text-sm text-vendor-foreground line-clamp-3 whitespace-pre-wrap">
                                                {(u.notes || "").trim() || "-"}
                                              </p>
                                            )}
                                          </div>
                                          <span className="text-sm text-vendor-muted-strong shrink-0">{cardOpen ? "Hide" : "Show"}</span>
                                        </button>
                                        {cardOpen && (
                                          <div className="mt-3 pt-3 border-t border-vendor-border space-y-3">
                                            <div>
                                              <div className="flex justify-between text-xs text-vendor-muted mb-1">
                                                <span>Completion</span>
                                                <span>{u.completion_pct}%</span>
                                              </div>
                                              <div className="h-2 rounded-full bg-vendor-track overflow-hidden">
                                                <div
                                                  className="h-full bg-vendor-foreground/80 rounded-full"
                                                  style={{ width: `${u.completion_pct}%` }}
                                                />
                                              </div>
                                            </div>
                                            <div>
                                              <div className="font-mono text-2xs uppercase text-vendor-muted mb-1">Notes</div>
                                              <p className="text-sm text-vendor-foreground whitespace-pre-wrap">
                                                {(u.notes || "").trim() || "-"}
                                              </p>
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    )
                                  })
                                )}
                              </div>
                            )}
                          </div>

                          <form
                            className="space-y-4"
                            onSubmit={async (e) => {
                              e.preventDefault()
                              if (isDemo) {
                                const created: StatusUpdateRow = {
                                  id: `demo-new-${Date.now()}`,
                                  status: ui.formStatus,
                                  budget_status: ui.formBudget,
                                  completion_pct: ui.formPct,
                                  notes: ui.formNotes.trim() || null,
                                  created_at: new Date().toISOString(),
                                }
                                setAssignmentUi((prev) => {
                                  const cur = prev[eng.assignmentId] ?? defaultAssignmentUi()
                                  return {
                                    ...prev,
                                    [eng.assignmentId]: {
                                      ...cur,
                                      latest: created,
                                      updates: [created, ...cur.updates.filter((r) => r.id !== created.id)],
                                      formNotes: "",
                                    },
                                  }
                                })
                                return
                              }
                              setAssignmentUi((prev) => ({
                                ...prev,
                                [eng.assignmentId]: {
                                  ...(prev[eng.assignmentId] ?? defaultAssignmentUi()),
                                  saving: true,
                                  error: null,
                                },
                              }))
                              try {
                                const res = await fetch(`/api/partner/projects/${projectId}/status-update`, {
                                  method: "POST",
                                  credentials: "same-origin",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({
                                    project_assignment_id: eng.assignmentId,
                                    status: ui.formStatus,
                                    budget_status: ui.formBudget,
                                    completion_pct: ui.formPct,
                                    notes: ui.formNotes.trim() || undefined,
                                  }),
                                })
                                const json = await res.json().catch(() => ({}))
                                if (!res.ok) {
                                  setAssignmentUi((prev) => ({
                                    ...prev,
                                    [eng.assignmentId]: {
                                      ...(prev[eng.assignmentId] ?? defaultAssignmentUi()),
                                      saving: false,
                                      error: (json as { error?: string }).error || "Save failed",
                                    },
                                  }))
                                  return
                                }
                                const created = (json as { update?: StatusUpdateRow }).update
                                if (created) {
                                  setAssignmentUi((prev) => {
                                    const cur = prev[eng.assignmentId] ?? defaultAssignmentUi()
                                    return {
                                      ...prev,
                                      [eng.assignmentId]: {
                                        ...cur,
                                        saving: false,
                                        error: null,
                                        latest: created,
                                        updates: [created, ...cur.updates.filter((r) => r.id !== created.id)],
                                        formNotes: "",
                                      },
                                    }
                                  })
                                } else {
                                  await refreshAssignmentStatus(eng.assignmentId)
                                  setAssignmentUi((prev) => ({
                                    ...prev,
                                    [eng.assignmentId]: {
                                      ...(prev[eng.assignmentId] ?? defaultAssignmentUi()),
                                      saving: false,
                                      error: null,
                                      formNotes: "",
                                    },
                                  }))
                                }
                              } catch {
                                setAssignmentUi((prev) => ({
                                  ...prev,
                                  [eng.assignmentId]: {
                                    ...(prev[eng.assignmentId] ?? defaultAssignmentUi()),
                                    saving: false,
                                    error: "Save failed",
                                  },
                                }))
                              }
                            }}
                          >
                            <div className="grid sm:grid-cols-2 gap-4">
                              <div>
                                <Label className="font-mono text-2xs text-vendor-muted uppercase">Workflow status</Label>
                                <select
                                  value={ui.formStatus}
                                  onChange={(e) =>
                                    setAssignmentUi((prev) => ({
                                      ...prev,
                                      [eng.assignmentId]: {
                                        ...(prev[eng.assignmentId] ?? defaultAssignmentUi()),
                                        formStatus: e.target.value,
                                      },
                                    }))
                                  }
                                  className="mt-1 w-full rounded-md border border-vendor-border bg-vendor-surface px-3 py-2 text-sm text-vendor-foreground"
                                >
                                  {PARTNER_WORKFLOW_STATUSES.map((s) => (
                                    <option key={s} value={s}>
                                      {workflowStatusLabel(s)}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div>
                                <Label className="font-mono text-2xs text-vendor-muted uppercase">Budget status</Label>
                                <select
                                  value={ui.formBudget}
                                  onChange={(e) =>
                                    setAssignmentUi((prev) => ({
                                      ...prev,
                                      [eng.assignmentId]: {
                                        ...(prev[eng.assignmentId] ?? defaultAssignmentUi()),
                                        formBudget: e.target.value,
                                      },
                                    }))
                                  }
                                  className="mt-1 w-full rounded-md border border-vendor-border bg-vendor-surface px-3 py-2 text-sm text-vendor-foreground"
                                >
                                  {PARTNER_BUDGET_STATUSES.map((s) => (
                                    <option key={s} value={s}>
                                      {budgetStatusLabel(s)}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </div>
                            <div>
                              <Label className="font-mono text-2xs text-vendor-muted uppercase">
                                Completion ({ui.formPct}%)
                              </Label>
                              <Slider
                                value={[ui.formPct]}
                                min={0}
                                max={100}
                                step={1}
                                onValueChange={(v) =>
                                  setAssignmentUi((prev) => ({
                                    ...prev,
                                    [eng.assignmentId]: {
                                      ...(prev[eng.assignmentId] ?? defaultAssignmentUi()),
                                      formPct: v[0] ?? 0,
                                    },
                                  }))
                                }
                                className="mt-3 w-full"
                              />
                            </div>
                            <div>
                              <Label className="font-mono text-2xs text-vendor-muted uppercase">Notes</Label>
                              <Textarea
                                value={ui.formNotes}
                                onChange={(e) =>
                                  setAssignmentUi((prev) => ({
                                    ...prev,
                                    [eng.assignmentId]: {
                                      ...(prev[eng.assignmentId] ?? defaultAssignmentUi()),
                                      formNotes: e.target.value,
                                    },
                                  }))
                                }
                                placeholder="What changed since last update?"
                                className={cn("mt-1 min-h-[100px]", fieldClass)}
                              />
                            </div>
                            {ui.error && <p className="text-sm text-red-600">{ui.error}</p>}
                            <Button
                              type="submit"
                              disabled={ui.saving}
                              className={cn(btnPrimaryDark, "w-full sm:w-auto")}
                            >
                              {ui.saving ? (
                                <>
                                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                  Submitting…
                                </>
                              ) : (
                                "Submit status update"
                              )}
                            </Button>
                          </form>
                        </div>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                )
              })}
            </div>

            {isDemo && (
              <p className="font-mono text-2xs text-vendor-muted">
                Demo preview for {agencyName}. Production data loads from your awarded assignments.
              </p>
            )}
          </div>
        )}
      </div>
    </PartnerLayout>
  )
}

export default function PartnerProjectActiveEngagementPage() {
  return (
    <Suspense
      fallback={
        <PartnerLayout>
          <div className="p-8 flex items-center gap-2 text-vendor-muted">
            <Loader2 className="w-5 h-5 animate-spin" />
            Loading…
          </div>
        </PartnerLayout>
      }
    >
      <PartnerActiveEngagementInner />
    </Suspense>
  )
}
