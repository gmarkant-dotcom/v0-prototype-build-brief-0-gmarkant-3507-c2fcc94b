"use client"

import { Suspense, useEffect, useState, useCallback, useRef } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useSWRConfig } from "swr"
import { AgencyLayout } from "@/components/agency-layout"
import { SelectedProjectHeader } from "@/components/selected-project-header"
import { GlassCard } from "@/components/glass-card"
import { isDemoMode } from "@/lib/demo-data"
import { formatEngagementBudget, formatEngagementTimeline } from "@/lib/active-engagement-parse"
import { cn, formatDateTime, normalizeMeetingUrlForHref } from "@/lib/utils"
import { useSelectedProject } from "@/contexts/selected-project-context"
import { useFetch } from "@/hooks/useFetch"
import {
  budgetStatusLabel,
  workflowStatusLabel,
} from "@/lib/partner-status"
import { Loader2, ExternalLink, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
type OnboardingDoc = { label: string; url: string }

type LatestAlert = {
  id: string
  status: string
  budget_status: string
  completion_pct: number
  notes: string | null
  created_at: string
}

type AlertSummaryLine = {
  id: string
  status: string
  budget_status: string
  completion_pct: number
  notes_preview: string
  notes: string | null
  created_at: string
}

type LatestPartnerUpdate = {
  status: string
  budget_status: string
  completion_pct: number
  notes: string | null
  created_at: string
}

type PartnerEngagementRow = {
  assignmentId: string
  /** Distinguishes multiple awarded bids per assignment (active-engagements API) */
  awardedResponseId?: string | null
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
  onboardingDocuments: OnboardingDoc[]
  current_status: string | null
  completion_pct: number
  alert_count: number
  latest_alert: LatestAlert | null
  /** One line per unresolved alert (tooltip when alert_count > 1) */
  alert_summaries?: AlertSummaryLine[]
  /** Latest partner status row for status column tooltip */
  latest_partner_update?: LatestPartnerUpdate | null
}

type ProjectGroup = {
  id: string
  title: string
  partners: PartnerEngagementRow[]
}

/** Stable DOM id / React key when one assignment has multiple awarded bid rows */
function engagementRowDomId(row: PartnerEngagementRow): string {
  return row.awardedResponseId ? `${row.assignmentId}-${row.awardedResponseId}` : row.assignmentId
}

const DEMO_ALERT_2: LatestAlert = {
  id: "demo-status-alert-2",
  status: "delayed",
  budget_status: "over_budget",
  completion_pct: 38,
  notes: "Vendor slipped on B-roll delivery by four days; revised dates shared with lead agency.",
  created_at: new Date(Date.now() - 86400000).toISOString(),
}

function statusBadgeClass(status: string | null): string {
  if (!status) return "bg-white/10 text-foreground/90 border-border/60"
  if (status === "on_track") return "bg-emerald-500/15 text-emerald-300 border-emerald-500/40"
  if (status === "at_risk") return "bg-amber-500/15 text-amber-200 border-amber-500/40"
  if (status === "complete") return "bg-cyan-500/15 text-cyan-200 border-cyan-500/40"
  if (status === "delayed" || status === "blocked") return "bg-red-500/15 text-red-200 border-red-500/40"
  return "bg-white/10 text-foreground/90 border-border/60"
}

const ENGAGEMENT_TOOLTIP_CONTENT =
  "max-w-sm bg-background border border-border text-foreground p-3 shadow-lg"

function CompletionBar({ pct }: { pct: number }) {
  const safe = Math.min(100, Math.max(0, pct))
  return (
    <div className="mt-1">
      <div className="flex justify-between text-[10px] font-mono text-foreground-muted mb-0.5">
        <span>Completion</span>
        <span>{safe}%</span>
      </div>
      <div className="h-2 rounded-full bg-white/10 overflow-hidden">
        <div className="h-full bg-accent/80 rounded-full transition-all" style={{ width: `${safe}%` }} />
      </div>
    </div>
  )
}

function AlertTooltipBody({ row }: { row: PartnerEngagementRow }) {
  if (row.alert_count > 1 && (row.alert_summaries?.length ?? 0) > 0) {
    return (
      <div className="space-y-3 text-xs max-w-xs">
        {(row.alert_summaries ?? []).map((s) => (
          <div key={s.id} className="border-b border-border/40 pb-2 last:border-0 last:pb-0 space-y-1">
            <div>
              <span className="font-mono text-[10px] text-foreground-muted">Status: </span>
              <span className="text-foreground">{workflowStatusLabel(s.status)}</span>
            </div>
            <div>
              <span className="font-mono text-[10px] text-foreground-muted">Budget: </span>
              <span className="text-foreground">{budgetStatusLabel(s.budget_status)}</span>
            </div>
            <CompletionBar pct={s.completion_pct} />
            {(s.notes || "").trim() ? (
              <p className="text-foreground/95 whitespace-pre-wrap leading-snug">{(s.notes || "").trim()}</p>
            ) : (
              <p className="text-foreground-muted text-[10px] font-mono">No partner notes for this update.</p>
            )}
            <div className="font-mono text-[10px] text-foreground-muted">
              Submitted {formatDateTime(s.created_at)}
            </div>
          </div>
        ))}
      </div>
    )
  }
  if (!row.latest_alert) return <p className="text-xs text-foreground-muted">No alert details.</p>
  const a = row.latest_alert
  return (
    <div className="space-y-2 text-xs max-w-xs">
      <div>
        <span className="font-mono text-[10px] text-foreground-muted">Status: </span>
        <span className="text-foreground">{workflowStatusLabel(a.status)}</span>
      </div>
      <div>
        <span className="font-mono text-[10px] text-foreground-muted">Budget: </span>
        <span className="text-foreground">{budgetStatusLabel(a.budget_status)}</span>
      </div>
      <CompletionBar pct={a.completion_pct} />
      {(a.notes || "").trim() ? (
        <p className="text-foreground/95 whitespace-pre-wrap leading-snug">{(a.notes || "").trim()}</p>
      ) : (
        <p className="text-foreground-muted text-[10px] font-mono">No partner notes for this update.</p>
      )}
      <div className="font-mono text-[10px] text-foreground-muted">Submitted {formatDateTime(a.created_at)}</div>
    </div>
  )
}

function StatusTooltipBody({ row }: { row: PartnerEngagementRow }) {
  const u = row.latest_partner_update
  if (!u) {
    return <p className="text-xs text-foreground-muted">No partner status updates yet.</p>
  }
  return (
    <div className="space-y-2 text-xs max-w-xs">
      <div>
        <span className="font-mono text-[10px] text-foreground-muted">Workflow: </span>
        <span className="text-foreground">{workflowStatusLabel(u.status)}</span>
      </div>
      <div>
        <span className="font-mono text-[10px] text-foreground-muted">Budget: </span>
        <span className="text-foreground">{budgetStatusLabel(u.budget_status)}</span>
      </div>
      <CompletionBar pct={u.completion_pct} />
      {(u.notes || "").trim() ? (
        <p className="text-foreground/95 whitespace-pre-wrap leading-snug">{(u.notes || "").trim()}</p>
      ) : (
        <p className="text-foreground-muted text-[10px] font-mono">No partner notes on the latest update.</p>
      )}
      <div className="font-mono text-[10px] text-foreground-muted">Last update {formatDateTime(u.created_at)}</div>
    </div>
  )
}

function formatTableDate(value: string | null): string {
  if (!value) return "—"
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return "—"
  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function ActiveEngagementsInner() {
  const searchParams = useSearchParams()
  const { selectedProject, setSelectedProject, projects, isLoadingProjects } = useSelectedProject()
  const isDemo = isDemoMode()
  const [projectsData, setProjectsData] = useState<ProjectGroup[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resolvingUpdateId, setResolvingUpdateId] = useState<string | null>(null)
  const [resolveMessage, setResolveMessage] = useState<{ type: "error" | "ok"; text: string } | null>(null)
  const { mutate } = useSWRConfig()
  const projectsDataRef = useRef<ProjectGroup[]>([])
  useEffect(() => {
    projectsDataRef.current = projectsData
  }, [projectsData])

  const qProjectId = searchParams.get("projectId")
  const highlightId = searchParams.get("highlight")

  useEffect(() => {
    if (isDemo || !qProjectId) return
    const match = projects.find((p) => p.id === qProjectId)
    if (match && selectedProject?.id !== match.id) {
      setSelectedProject(match)
    }
  }, [qProjectId, projects, selectedProject?.id, setSelectedProject, isDemo])

  useEffect(() => {
    if (!highlightId || loading || projectsData.length === 0) return
    const t = requestAnimationFrame(() => {
      const el = document.getElementById(`engagement-row-${highlightId}`)
      el?.scrollIntoView({ behavior: "smooth", block: "center" })
      el?.classList.add("ring-2", "ring-amber-400/60", "rounded-lg")
      setTimeout(() => el?.classList.remove("ring-2", "ring-amber-400/60", "rounded-lg"), 2800)
    })
    return () => cancelAnimationFrame(t)
  }, [highlightId, loading, projectsData])

  useEffect(() => {
    if (isDemo) {
      if (!selectedProject) {
        setProjectsData([])
        setLoading(false)
        return
      }
      if (selectedProject.id !== "1") {
        setProjectsData([])
        setLoading(false)
        return
      }
      setProjectsData([
        {
          id: "1",
          title: selectedProject.name || "NWSL Creator Content Series",
          partners: [
            {
              assignmentId: "demo-a1",
              partnershipId: "demo-ph1",
              awardedAt: new Date().toISOString(),
              partner: {
                companyName: "Sample Production Studio",
                fullName: "Alex Rivera",
                email: "contact@demo.withligament.com",
              },
              scopeItemName: "Video production",
              proposalText: "Modular production with dedicated showrunner and B-cam for creator days.",
              budgetProposal: JSON.stringify({ amount: 98000, currency: "USD" }),
              timelineProposal: JSON.stringify({ duration: 10, unit: "weeks" }),
              kickoffUrl: "https://calendly.com/demo/kickoff",
              kickoffType: "calendly",
              onboardingDocuments: [
                { label: "Mutual NDA", url: "https://demo.withligament.com/sample-assets/nda" },
                { label: "Master Service Agreement", url: "https://demo.withligament.com/sample-assets/msa" },
              ],
              current_status: "at_risk",
              completion_pct: 45,
              alert_count: 2,
              latest_alert: {
                id: "demo-status-alert-1",
                status: "at_risk",
                budget_status: "incremental_needed",
                completion_pct: 45,
                notes: "Waiting on revised scope from client.",
                created_at: new Date().toISOString(),
              },
              alert_summaries: [
                {
                  id: "demo-status-alert-1",
                  status: "at_risk",
                  budget_status: "incremental_needed",
                  completion_pct: 45,
                  notes_preview: "Waiting on revised scope from client.",
                  notes: "Waiting on revised scope from client.",
                  created_at: new Date().toISOString(),
                },
                {
                  id: DEMO_ALERT_2.id,
                  status: "delayed",
                  budget_status: "over_budget",
                  completion_pct: DEMO_ALERT_2.completion_pct,
                  notes_preview:
                    "Vendor slipped on B-roll delivery by four days; revised da…",
                  notes: DEMO_ALERT_2.notes,
                  created_at: DEMO_ALERT_2.created_at,
                },
              ],
              latest_partner_update: {
                status: "at_risk",
                budget_status: "incremental_needed",
                completion_pct: 45,
                notes: "Waiting on revised scope from client.",
                created_at: new Date().toISOString(),
              },
            },
          ],
        },
      ])
      setLoading(false)
      return
    }

    if (!selectedProject?.id) {
      setProjectsData([])
      setError(null)
      return
    }
  }, [isDemo, selectedProject?.id, selectedProject?.name])

  const engagementUrl = !isDemo && selectedProject?.id
    ? `/api/agency/active-engagements?${new URLSearchParams({ projectId: selectedProject.id }).toString()}`
    : ""
  const {
    data: engagementsResponse,
    error: engagementsError,
    isLoading: swrLoading,
  } = useFetch(engagementUrl)

  useEffect(() => {
    if (isDemo) return
    if (!selectedProject?.id) return
    setLoading(swrLoading)
    if (engagementsError) {
      setError("Failed to load")
      return
    }
    if (!engagementsResponse) return
    const data = engagementsResponse as { projects?: ProjectGroup[]; error?: string }
    if (typeof data.error === "string" && data.error) {
      setError(data.error || "Failed to load")
      setProjectsData([])
      return
    }
    setError(null)
    const raw = data.projects || []
    setProjectsData(
      raw.map((proj) => ({
        ...proj,
        partners: proj.partners.map((p) => ({
          ...p,
          latest_partner_update: p.latest_partner_update ?? null,
        })),
      }))
    )
  }, [isDemo, selectedProject?.id, engagementsResponse, engagementsError, swrLoading])

  const partnerDisplayName = (p: PartnerEngagementRow["partner"]) =>
    p.companyName?.trim() || p.fullName?.trim() || "Partner"

  const reloadEngagements = useCallback(async () => {
    if (!selectedProject?.id || isDemo) return
    const q = new URLSearchParams({ projectId: selectedProject.id })
    const res = await fetch(`/api/agency/active-engagements?${q.toString()}`, {
      credentials: "same-origin",
    })
    const data = await res.json().catch(() => ({}))
    if (res.ok) {
      setProjectsData((data as { projects?: ProjectGroup[] }).projects || [])
    }
  }, [selectedProject?.id, isDemo])

  useEffect(() => {
    if (!resolveMessage) return
    const t = window.setTimeout(() => setResolveMessage(null), 5000)
    return () => window.clearTimeout(t)
  }, [resolveMessage])

  const resolveAlert = useCallback(
    async (projectId: string, partnershipId: string, updateId: string, alertCount: number) => {
      // Use the row's project id first: it must match the status update's project_id. Preferring
      // selectedProject caused 404s when the sidebar selection changed before engagements refetched.
      const patchProjectId = (projectId.trim() || selectedProject?.id?.trim() || "").trim()
      if (!patchProjectId || !updateId.trim()) {
        setResolveMessage({ type: "error", text: "Could not resolve alert, missing project or update." })
        return
      }

      const snapshot = projectsDataRef.current.map((p) => ({
        ...p,
        partners: p.partners.map((r) => ({ ...r })),
      }))

      const applyOptimistic = () => {
        setProjectsData((prev) =>
          prev.map((proj) => {
            if (proj.id !== patchProjectId) return proj
            return {
              ...proj,
              partners: proj.partners.map((row) => {
                if (row.partnershipId !== partnershipId || row.latest_alert?.id !== updateId) return row
                if (alertCount <= 1) {
                  return {
                    ...row,
                    alert_count: 0,
                    latest_alert: null,
                    alert_summaries: [],
                    ...(isDemo
                      ? {
                          latest_partner_update: {
                            status: DEMO_ALERT_2.status,
                            budget_status: DEMO_ALERT_2.budget_status,
                            completion_pct: DEMO_ALERT_2.completion_pct,
                            notes: DEMO_ALERT_2.notes,
                            created_at: DEMO_ALERT_2.created_at,
                          },
                        }
                      : {}),
                  }
                }
                const nextSummaries = (row.alert_summaries ?? []).filter((s) => s.id !== updateId)
                const head = nextSummaries[0]
                const nextLatest = head
                  ? {
                      id: head.id,
                      status: head.status,
                      budget_status: head.budget_status,
                      completion_pct: head.completion_pct,
                      notes: head.notes,
                      created_at: head.created_at,
                    }
                  : null
                const nextLatestPartner = head
                  ? {
                      status: head.status,
                      budget_status: head.budget_status,
                      completion_pct: head.completion_pct,
                      notes: head.notes,
                      created_at: head.created_at,
                    }
                  : row.latest_partner_update
                return {
                  ...row,
                  alert_count: nextSummaries.length,
                  alert_summaries: nextSummaries,
                  latest_alert: nextLatest,
                  latest_partner_update: nextLatestPartner,
                }
              }),
            }
          })
        )
      }

      if (isDemo) {
        applyOptimistic()
        setResolveMessage({ type: "ok", text: "Alert marked as resolved." })
        return
      }

      applyOptimistic()
      setResolvingUpdateId(updateId)
      try {
        const patchUrl = `/api/agency/projects/${encodeURIComponent(patchProjectId)}/status-updates`
        const res = await fetch(patchUrl, {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ updateId }),
        })
        if (!res.ok) {
          const errText = await res.text().catch(() => "")
          console.warn("[active-engagements] PATCH resolve failed", res.status, errText)
          setProjectsData(snapshot)
          let message = errText.trim()
          if (message) {
            try {
              const parsed = JSON.parse(message) as { error?: unknown }
              if (typeof parsed.error === "string" && parsed.error.trim()) {
                message = parsed.error.trim()
              }
            } catch {
              // keep raw body
            }
          }
          setResolveMessage({
            type: "error",
            text: message || `Could not resolve alert (${res.status}).`,
          })
          return
        }
        setResolveMessage({ type: "ok", text: "Alert marked as resolved." })
        await reloadEngagements()
        if (engagementUrl) {
          await mutate(engagementUrl)
        }
      } catch (e) {
        setProjectsData(snapshot)
        const msg = e instanceof Error ? e.message.trim() : ""
        setResolveMessage({
          type: "error",
          text: msg || "Could not resolve alert (network error).",
        })
      } finally {
        setResolvingUpdateId(null)
      }
    },
    [isDemo, reloadEngagements, mutate, engagementUrl, selectedProject?.id]
  )

  return (
    <div className="p-8 max-w-6xl">
      <SelectedProjectHeader />
      {resolveMessage ? (
        <div
          className={cn(
            "mb-4 rounded-lg border px-4 py-2 text-sm font-mono",
            resolveMessage.type === "error"
              ? "border-red-400/50 bg-red-500/10 text-red-100"
              : "border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
          )}
          role="status"
        >
          {resolveMessage.text}
        </div>
      ) : null}
      <div className="mb-8">
        <h1 className="font-display font-bold text-3xl text-foreground">Active Engagements</h1>
        <p className="text-sm text-foreground-muted font-mono mt-2 max-w-2xl">
          {selectedProject
            ? `Awarded partners for ${selectedProject.name}: scope, budget, timeline, contacts, kickoff, and onboarding documents.`
            : "Select a project to see awarded partners and onboarding for that engagement."}
        </p>
      </div>

      {!isLoadingProjects && !selectedProject && projects.length === 0 && (
        <GlassCard className="p-8 text-center text-foreground-muted text-sm">
          Select a project to view its active engagements.
        </GlassCard>
      )}

      {selectedProject && loading && !isDemo && (
        <div className="flex items-center gap-2 text-foreground-muted py-12">
          <Loader2 className="w-5 h-5 animate-spin" />
          Loading engagements…
        </div>
      )}

      {selectedProject && error && !loading && (
        <div className="rounded-xl border border-red-400/40 bg-red-500/10 p-4 text-sm text-red-200">{error}</div>
      )}

      {selectedProject && !loading && !error && projectsData.length === 0 && (
        <GlassCard className="p-8 text-center text-foreground-muted text-sm">
          No awarded engagements for this project yet. Award a bid in Bid Management to create a project assignment.
        </GlassCard>
      )}

      {!loading && !error && selectedProject && projectsData.length > 0 && (
        <TooltipProvider delayDuration={200}>
          <div className="space-y-8">
            {projectsData.map((proj) => (
              <GlassCard key={proj.id} className="p-6 overflow-hidden">
                <h2 className="font-display font-bold text-xl text-foreground border-b border-border/60 pb-3 mb-4">
                  {proj.title}
                </h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[900px]">
                    <thead>
                      <tr className="font-mono text-[10px] uppercase text-foreground-muted text-left border-b border-border/40">
                        <th className="py-2 pr-3 font-medium">Partner</th>
                        <th className="py-2 pr-3 font-medium">Status</th>
                        <th className="py-2 pr-3 font-medium">Awarded</th>
                        <th className="py-2 pr-3 font-medium">Progress</th>
                        <th className="py-2 pr-3 font-medium">Scope</th>
                        <th className="py-2 pr-3 font-medium">Budget</th>
                        <th className="py-2 pr-3 font-medium">Timeline</th>
                        <th className="py-2 pr-3 font-medium">Contact</th>
                        <th className="py-2 pr-3 font-medium">Schedule Meeting</th>
                        <th className="py-2 font-medium">Documents</th>
                      </tr>
                    </thead>
                    <tbody>
                      {proj.partners.map((row) => (
                        <tr
                          key={engagementRowDomId(row)}
                          id={`engagement-row-${engagementRowDomId(row)}`}
                          className="border-b border-border/30 align-top transition-shadow"
                        >
                          <td className="py-3 pr-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-foreground font-medium">{partnerDisplayName(row.partner)}</span>
                              {row.alert_count > 0 && row.latest_alert && (
                                <>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span
                                        tabIndex={0}
                                        className="inline-flex items-center gap-1 font-mono text-[9px] px-2 py-0.5 rounded-full border border-amber-500/50 bg-amber-500/15 text-amber-200 hover:bg-amber-500/25 shrink-0 cursor-default outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
                                      >
                                        <AlertTriangle className="w-3 h-3" />
                                        {row.alert_count} Alert{row.alert_count > 1 ? "s" : ""}
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent side="bottom" className={ENGAGEMENT_TOOLTIP_CONTENT}>
                                      <AlertTooltipBody row={row} />
                                    </TooltipContent>
                                  </Tooltip>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={resolvingUpdateId === row.latest_alert.id}
                                    className="h-7 font-mono text-[9px] px-2 border-amber-500/40 text-amber-100 hover:bg-amber-500/10"
                                    onClick={() =>
                                      void resolveAlert(
                                        proj.id,
                                        row.partnershipId,
                                        row.latest_alert!.id,
                                        row.alert_count
                                      )
                                    }
                                  >
                                    {resolvingUpdateId === row.latest_alert.id ? (
                                      <Loader2 className="w-3 h-3 animate-spin" />
                                    ) : (
                                      "Resolve"
                                    )}
                                  </Button>
                                </>
                              )}
                            </div>
                          </td>
                          <td className="py-3 pr-3">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span
                                  tabIndex={0}
                                  className="inline-block rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60 cursor-default"
                                >
                                  <span
                                    className={cn(
                                      "font-mono text-[9px] px-2 py-0.5 rounded-full border uppercase tracking-wide inline-block hover:opacity-90",
                                      statusBadgeClass(row.current_status)
                                    )}
                                  >
                                    {row.current_status
                                      ? workflowStatusLabel(row.current_status)
                                      : "No updates"}
                                  </span>
                                </span>
                              </TooltipTrigger>
                              <TooltipContent side="bottom" className={ENGAGEMENT_TOOLTIP_CONTENT}>
                                <StatusTooltipBody row={row} />
                              </TooltipContent>
                            </Tooltip>
                          </td>
                          <td className="py-3 pr-3 text-foreground/90 whitespace-nowrap">
                            {formatTableDate(row.awardedAt)}
                          </td>
                          <td className="py-3 pr-3 w-[100px]">
                            <div className="flex flex-col gap-1">
                              <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                                <div
                                  className="h-full bg-accent/80 rounded-full transition-all"
                                  style={{ width: `${Math.min(100, Math.max(0, row.completion_pct))}%` }}
                                />
                              </div>
                              <span className="font-mono text-[9px] text-foreground-muted">{row.completion_pct}%</span>
                            </div>
                          </td>
                          <td className="py-3 pr-3 text-foreground/90">{row.scopeItemName || "—"}</td>
                          <td className="py-3 pr-3 text-foreground/90 whitespace-nowrap">
                            {formatEngagementBudget(row.budgetProposal)}
                          </td>
                          <td className="py-3 pr-3 text-foreground/90 whitespace-nowrap">
                            {formatEngagementTimeline(row.timelineProposal)}
                          </td>
                          <td className="py-3 pr-3">
                            <div className="text-foreground/90">{row.partner.fullName || "—"}</div>
                            {row.partner.email ? (
                              <a
                                href={`mailto:${row.partner.email}`}
                                className="font-mono text-[10px] text-accent hover:underline break-all"
                              >
                                {row.partner.email}
                              </a>
                            ) : (
                              <span className="text-foreground-muted">—</span>
                            )}
                          </td>
                          <td className="py-3 pr-3">
                            {row.kickoffUrl ? (
                              <a
                                href={normalizeMeetingUrlForHref(row.kickoffUrl)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-accent hover:underline font-mono text-[10px]"
                              >
                                <ExternalLink className="w-3 h-3 shrink-0" />
                                {row.kickoffType === "calendly" ? "Schedule Meeting" : "Link"}
                              </a>
                            ) : (
                              <span className="text-foreground-muted">—</span>
                            )}
                          </td>
                          <td className="py-3">
                            {row.onboardingDocuments.length === 0 ? (
                              <span className="text-foreground-muted">—</span>
                            ) : (
                              <ul className="space-y-1">
                                {row.onboardingDocuments.map((d, i) => (
                                  <li key={`${d.url}-${i}`}>
                                    <a
                                      href={d.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="font-mono text-[10px] text-accent hover:underline"
                                    >
                                      {d.label}
                                    </a>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {isDemo && (
                  <p className="font-mono text-[10px] text-foreground-muted mt-4">
                    Demo preview — production data loads from{" "}
                    <Link href="/agency/bids" className="text-accent underline">
                      awarded bids
                    </Link>
                    .
                  </p>
                )}
              </GlassCard>
            ))}
          </div>
        </TooltipProvider>
      )}

    </div>
  )
}

export default function AgencyActiveEngagementsPage() {
  return (
    <AgencyLayout>
      <Suspense
        fallback={
          <div className="p-8 flex items-center gap-2 text-foreground-muted">
            <Loader2 className="w-5 h-5 animate-spin" />
            Loading…
          </div>
        }
      >
        <ActiveEngagementsInner />
      </Suspense>
    </AgencyLayout>
  )
}
