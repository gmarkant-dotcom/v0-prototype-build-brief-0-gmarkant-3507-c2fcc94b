"use client"

import { Suspense, useEffect, useState, useCallback, useRef } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { AgencyLayout } from "@/components/agency-layout"
import { SelectedProjectHeader } from "@/components/selected-project-header"
import { GlassCard } from "@/components/glass-card"
import { isDemoMode } from "@/lib/demo-data"
import { formatEngagementBudget, formatEngagementTimeline } from "@/lib/active-engagement-parse"
import { normalizeMeetingUrlForHref } from "@/lib/utils"
import { useSelectedProject } from "@/contexts/selected-project-context"
import { useFetch } from "@/hooks/useFetch"
import {
  budgetStatusLabel,
  workflowStatusLabel,
} from "@/lib/partner-status"
import { Loader2, ExternalLink, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

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
  status: string
  budget_status: string
  notes_preview: string
}

type PanelStatusUpdate = {
  id: string
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

function demoPanelAlerts(): PanelStatusUpdate[] {
  return [
    {
      id: "demo-status-alert-1",
      status: "at_risk",
      budget_status: "incremental_needed",
      completion_pct: 45,
      notes: "Waiting on revised scope from client.",
      created_at: new Date().toISOString(),
    },
    {
      id: DEMO_ALERT_2.id,
      status: DEMO_ALERT_2.status,
      budget_status: DEMO_ALERT_2.budget_status,
      completion_pct: DEMO_ALERT_2.completion_pct,
      notes: DEMO_ALERT_2.notes,
      created_at: DEMO_ALERT_2.created_at,
    },
  ]
}

function statusBadgeClass(status: string | null): string {
  if (!status) return "bg-white/10 text-foreground-muted border-border/60"
  if (status === "on_track") return "bg-emerald-500/15 text-emerald-300 border-emerald-500/40"
  if (status === "at_risk") return "bg-amber-500/15 text-amber-200 border-amber-500/40"
  if (status === "complete") return "bg-cyan-500/15 text-cyan-200 border-cyan-500/40"
  if (status === "delayed" || status === "blocked") return "bg-red-500/15 text-red-200 border-red-500/40"
  return "bg-white/10 text-foreground-muted border-border/60"
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
  const [alertSheetOpen, setAlertSheetOpen] = useState(false)
  const [alertSheetCtx, setAlertSheetCtx] = useState<{
    projectId: string
    partnershipId: string
    partnerName: string
  } | null>(null)
  const [panelAlerts, setPanelAlerts] = useState<PanelStatusUpdate[]>([])
  const [panelLoading, setPanelLoading] = useState(false)
  const [resolvingPanelId, setResolvingPanelId] = useState<string | null>(null)
  const alertSheetCtxRef = useRef<{
    projectId: string
    partnershipId: string
    partnerName: string
  } | null>(null)

  useEffect(() => {
    alertSheetCtxRef.current = alertSheetCtx
  }, [alertSheetCtx])

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
    setPanelAlerts([])
    setAlertSheetCtx(null)
  }, [selectedProject?.id])

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
                  status: "at_risk",
                  budget_status: "incremental_needed",
                  notes_preview: "Waiting on revised scope from client.",
                },
                {
                  status: "delayed",
                  budget_status: "over_budget",
                  notes_preview:
                    "Vendor slipped on B-roll delivery by four days; revised da…",
                },
              ],
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
    setProjectsData(data.projects || [])
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

  const openAlertPanel = useCallback(
    async (projectId: string, partnershipId: string, partnerName: string) => {
      setAlertSheetCtx({ projectId, partnershipId, partnerName })
      setAlertSheetOpen(true)
      setPanelLoading(true)
      setPanelAlerts([])
      if (isDemo) {
        setPanelAlerts(demoPanelAlerts())
        setPanelLoading(false)
        return
      }
      try {
        const path = `/api/agency/projects/${encodeURIComponent(projectId)}/status-updates?partnershipId=${encodeURIComponent(partnershipId)}`
        const absolute =
          typeof window !== "undefined" ? new URL(path, window.location.origin).href : path
        console.log("[active-engagements] open alert panel GET status-updates", {
          fetchUrl: absolute,
          rowProjectId: projectId,
          partnershipId,
          selectedSidebarProjectId: selectedProject?.id ?? null,
        })
        const res = await fetch(path, { credentials: "same-origin" })
        const data = await res.json().catch(() => ({}))
        if (res.ok) {
          const raw = (data as { updates?: Record<string, unknown>[] }).updates || []
          setPanelAlerts(
            raw.map((r) => ({
              id: String(r.id),
              status: String(r.status),
              budget_status: String(r.budget_status),
              completion_pct: Number(r.completion_pct),
              notes: (r.notes as string | null) ?? null,
              created_at: String(r.created_at),
            }))
          )
        } else {
          console.warn("[active-engagements] status-updates GET failed", res.status, data)
        }
      } finally {
        setPanelLoading(false)
      }
    },
    [isDemo, selectedProject?.id]
  )

  const openAlertsForRow = useCallback((proj: ProjectGroup, row: PartnerEngagementRow) => {
    const name =
      row.partner.companyName?.trim() || row.partner.fullName?.trim() || "Partner"
    const rowProjectId = proj.id
    console.log("[active-engagements] openAlertsForRow", {
      rowProjectId,
      partnershipId: row.partnershipId,
      selectedSidebarProjectId: selectedProject?.id ?? null,
    })
    void openAlertPanel(rowProjectId, row.partnershipId, name)
  }, [openAlertPanel, selectedProject?.id])

  const resolveFromPanel = useCallback(
    async (updateId: string) => {
      const ctx = alertSheetCtxRef.current
      if (!ctx) return
      const { projectId, partnershipId } = ctx

      const syncDemoTable = (next: PanelStatusUpdate[]) => {
        setProjectsData((projectsPrev) =>
          projectsPrev.map((proj) =>
            proj.id !== projectId
              ? proj
              : {
                  ...proj,
                  partners: proj.partners.map((row) =>
                    row.partnershipId !== partnershipId
                      ? row
                      : next.length === 0
                        ? { ...row, alert_count: 0, latest_alert: null, alert_summaries: [] }
                        : {
                            ...row,
                            alert_count: next.length,
                            latest_alert: {
                              id: next[0].id,
                              status: next[0].status,
                              budget_status: next[0].budget_status,
                              completion_pct: next[0].completion_pct,
                              notes: next[0].notes,
                              created_at: next[0].created_at,
                            },
                            alert_summaries: next.map((r) => {
                              const t = (r.notes || "").trim()
                              return {
                                status: r.status,
                                budget_status: r.budget_status,
                                notes_preview: t.length <= 60 ? t : `${t.slice(0, 60)}…`,
                              }
                            }),
                          }
                  ),
                }
          )
        )
      }

      if (isDemo) {
        setPanelAlerts((prev) => {
          const next = prev.filter((a) => a.id !== updateId)
          syncDemoTable(next)
          if (next.length === 0) {
            setAlertSheetOpen(false)
            setAlertSheetCtx(null)
          }
          return next
        })
        return
      }

      setResolvingPanelId(updateId)
      try {
        const patchUrl = `/api/agency/projects/${encodeURIComponent(projectId)}/status-updates`
        const patchBody = { updateId }
        console.log("[active-engagements] PATCH partner status resolve", {
          url: patchUrl,
          body: patchBody,
          panelProjectId: projectId,
          panelPartnershipId: partnershipId,
        })
        const res = await fetch(patchUrl, {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patchBody),
        })
        if (!res.ok) {
          const errText = await res.text().catch(() => "")
          console.warn("[active-engagements] PATCH failed", res.status, errText)
        }
        if (res.ok) {
          setPanelAlerts((prev) => {
            const next = prev.filter((a) => a.id !== updateId)
            if (next.length === 0) {
              setAlertSheetOpen(false)
              setAlertSheetCtx(null)
            }
            return next
          })
          await reloadEngagements()
        }
      } finally {
        setResolvingPanelId(null)
      }
    },
    [isDemo, reloadEngagements]
  )

  const resolveAlert = useCallback(
    async (projectId: string, updateId: string) => {
      if (isDemo) {
        setProjectsData((prev) =>
          prev.map((proj) =>
            proj.id !== projectId
              ? proj
              : {
                  ...proj,
                  partners: proj.partners.map((row) => {
                    if (row.latest_alert?.id !== updateId) return row
                    if ((row.alert_count ?? 0) <= 1) {
                      return { ...row, alert_count: 0, latest_alert: null, alert_summaries: [] }
                    }
                    return {
                      ...row,
                      alert_count: row.alert_count - 1,
                      latest_alert: {
                        id: DEMO_ALERT_2.id,
                        status: DEMO_ALERT_2.status,
                        budget_status: DEMO_ALERT_2.budget_status,
                        completion_pct: DEMO_ALERT_2.completion_pct,
                        notes: DEMO_ALERT_2.notes,
                        created_at: DEMO_ALERT_2.created_at,
                      },
                      alert_summaries: (row.alert_summaries ?? []).slice(1),
                    }
                  }),
                }
          )
        )
        return
      }
      setResolvingUpdateId(updateId)
      try {
        const res = await fetch(`/api/agency/projects/${encodeURIComponent(projectId)}/status-updates`, {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ updateId }),
        })
        if (res.ok) {
          await reloadEngagements()
        }
      } finally {
        setResolvingUpdateId(null)
      }
    },
    [isDemo, reloadEngagements]
  )

  return (
    <div className="p-8 max-w-6xl">
      <SelectedProjectHeader />
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
                              <button
                                type="button"
                                className="text-foreground font-medium text-left hover:underline rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
                                onClick={() => openAlertsForRow(proj, row)}
                              >
                                {partnerDisplayName(row.partner)}
                              </button>
                              {row.alert_count > 0 && row.latest_alert && (
                                <>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <button
                                        type="button"
                                        className="inline-flex items-center gap-1 font-mono text-[9px] px-2 py-0.5 rounded-full border border-amber-500/50 bg-amber-500/15 text-amber-200 hover:bg-amber-500/25 shrink-0 cursor-pointer"
                                        onClick={() => openAlertsForRow(proj, row)}
                                      >
                                        <AlertTriangle className="w-3 h-3" />
                                        {row.alert_count} Alert{row.alert_count > 1 ? "s" : ""}
                                      </button>
                                    </TooltipTrigger>
                                    <TooltipContent
                                      side="bottom"
                                      className="max-w-sm bg-background border border-border text-foreground p-3"
                                    >
                                      {row.alert_count > 1 && (row.alert_summaries?.length ?? 0) > 0 ? (
                                        <div className="space-y-2 text-xs">
                                          {(row.alert_summaries ?? []).map((s, idx) => (
                                            <div
                                              key={`${s.status}-${idx}`}
                                              className={cn(
                                                "border-b border-border/40 pb-2 last:border-0 last:pb-0"
                                              )}
                                            >
                                              <span className="font-medium text-foreground">
                                                {workflowStatusLabel(s.status)}
                                              </span>
                                              <span className="text-foreground-muted"> · </span>
                                              <span>{budgetStatusLabel(s.budget_status)}</span>
                                              {s.notes_preview ? (
                                                <p className="text-foreground-muted mt-1 line-clamp-2">
                                                  {s.notes_preview}
                                                </p>
                                              ) : null}
                                            </div>
                                          ))}
                                        </div>
                                      ) : (
                                        <div className="space-y-1 text-xs max-w-xs">
                                          <div>
                                            <span className="font-mono text-[10px] text-foreground-muted">
                                              Status:{" "}
                                            </span>
                                            {workflowStatusLabel(row.latest_alert.status)}
                                          </div>
                                          <div>
                                            <span className="font-mono text-[10px] text-foreground-muted">
                                              Budget:{" "}
                                            </span>
                                            {budgetStatusLabel(row.latest_alert.budget_status)}
                                          </div>
                                          <div>
                                            <span className="font-mono text-[10px] text-foreground-muted">
                                              Completion:{" "}
                                            </span>
                                            {row.latest_alert.completion_pct}%
                                          </div>
                                          {row.latest_alert.notes && (
                                            <p className="text-foreground-muted line-clamp-4 mt-1 whitespace-pre-wrap">
                                              {row.latest_alert.notes}
                                            </p>
                                          )}
                                        </div>
                                      )}
                                    </TooltipContent>
                                  </Tooltip>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={resolvingUpdateId === row.latest_alert.id}
                                    className="h-7 font-mono text-[9px] px-2 border-amber-500/40 text-amber-100 hover:bg-amber-500/10"
                                    onClick={() => void resolveAlert(proj.id, row.latest_alert!.id)}
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
                            <button
                              type="button"
                              className="text-left text-foreground rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
                              onClick={() => openAlertsForRow(proj, row)}
                            >
                              <span
                                className={cn(
                                  "font-mono text-[9px] px-2 py-0.5 rounded-full border uppercase tracking-wide inline-block cursor-pointer hover:opacity-90",
                                  statusBadgeClass(row.current_status)
                                )}
                              >
                                {row.current_status
                                  ? workflowStatusLabel(row.current_status)
                                  : "No updates"}
                              </span>
                            </button>
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

      <Sheet
        open={alertSheetOpen}
        onOpenChange={(open) => {
          setAlertSheetOpen(open)
          if (!open) {
            setAlertSheetCtx(null)
            setPanelAlerts([])
            setPanelLoading(false)
          }
        }}
      >
        <SheetContent
          side="right"
          className="w-full sm:max-w-lg flex flex-col gap-0 border-border bg-background p-0 [&>button]:text-foreground"
        >
          <SheetHeader className="p-6 pb-4 border-b border-border/60 shrink-0 text-left">
            <SheetTitle className="font-display text-xl text-foreground pr-8">
              Partner status alerts
            </SheetTitle>
            <SheetDescription className="text-foreground-muted text-sm">
              {alertSheetCtx?.partnerName}
              {alertSheetCtx && selectedProject ? ` · ${selectedProject.name}` : null}
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 space-y-4">
            {panelLoading ? (
              <div className="flex items-center gap-2 text-foreground-muted py-8">
                <Loader2 className="w-5 h-5 animate-spin shrink-0" />
                Loading alerts…
              </div>
            ) : panelAlerts.length === 0 ? (
              <p className="text-sm text-foreground-muted">No unresolved status updates.</p>
            ) : (
              panelAlerts.map((a) => (
                <div
                  key={a.id}
                  className="rounded-lg border border-border/60 bg-white/5 p-4 space-y-3"
                >
                  <div className="font-mono text-[10px] text-foreground-muted">
                    {new Date(a.created_at).toLocaleString()}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span
                      className={cn(
                        "font-mono text-[9px] px-2 py-0.5 rounded-full border uppercase tracking-wide",
                        statusBadgeClass(a.status)
                      )}
                    >
                      {workflowStatusLabel(a.status)}
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full border border-amber-500/40 bg-amber-500/10 text-amber-100">
                      {budgetStatusLabel(a.budget_status)}
                    </span>
                  </div>
                  <div>
                    <div className="flex justify-between text-xs text-foreground-muted mb-1">
                      <span>Completion</span>
                      <span>{a.completion_pct}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                      <div
                        className="h-full bg-accent/80 rounded-full"
                        style={{ width: `${Math.min(100, Math.max(0, a.completion_pct))}%` }}
                      />
                    </div>
                  </div>
                  <div>
                    <div className="font-mono text-[10px] uppercase text-foreground-muted mb-1">Notes</div>
                    <p className="text-sm text-foreground/90 whitespace-pre-wrap">
                      {(a.notes || "").trim() || "—"}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full border-border text-foreground hover:bg-white/10"
                    disabled={resolvingPanelId === a.id}
                    onClick={() => void resolveFromPanel(a.id)}
                  >
                    {resolvingPanelId === a.id ? (
                      <span className="inline-flex items-center justify-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                        Resolving…
                      </span>
                    ) : (
                      "Mark resolved"
                    )}
                  </Button>
                </div>
              ))
            )}
          </div>
        </SheetContent>
      </Sheet>
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
