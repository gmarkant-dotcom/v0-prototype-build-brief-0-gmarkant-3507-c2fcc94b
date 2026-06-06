"use client"

import { useState, useMemo, useCallback, Suspense } from "react"
import { AgencyLayout } from "@/components/agency-layout"
import { InlineProjectSelector } from "@/components/agency-project-selector"
import { useSelectedProject } from "@/contexts/selected-project-context"
import { GlassCard } from "@/components/glass-card"
import { cn } from "@/lib/utils"
import { useFetch } from "@/hooks/useFetch"
import { AgencyMsaContent } from "@/app/agency/msa/page"
import { UtilizationContent } from "@/app/agency/utilization/page"
import {
  AlertTriangle, CheckCircle, Clock, Loader2, Users,
  TrendingUp, Activity, X, ChevronDown, ChevronRight,
  Shield, Building2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { formatBudgetForDisplay } from "@/lib/rfp-response-fields"

// ── Types from active-engagements API ────────────────────────────────────────

type LatestAlert = {
  id: string; status: string; budget_status: string
  completion_pct: number; notes: string | null; created_at: string
}

type PartnerRow = {
  assignmentId: string
  awardedResponseId?: string | null
  partnershipId: string
  awardedAt: string | null
  partner: { companyName: string | null; fullName: string | null; email: string | null }
  scopeItemName: string | null
  budgetProposal: string
  current_status: string | null
  completion_pct: number
  alert_count: number
  latest_alert: LatestAlert | null
  latest_partner_update: { status: string; budget_status: string; completion_pct: number; notes: string | null; created_at: string } | null
}

type ProjectEngagement = {
  id: string; title: string
  clientName?: string | null; budgetRange?: string | null
  startDate?: string | null; endDate?: string | null
  status?: string | null
  dashboardWorkflowStage?: string | null; dashboardWorkflowLabel?: string | null
  partners: PartnerRow[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, string> = {
  on_track:   "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
  at_risk:    "bg-amber-500/15 text-amber-200 border-amber-500/40",
  delayed:    "bg-red-500/15 text-red-300 border-red-500/40",
  blocked:    "bg-red-500/15 text-red-300 border-red-500/40",
  complete:   "bg-cyan-500/15 text-cyan-200 border-cyan-500/40",
}

const STATUS_LABEL: Record<string, string> = {
  on_track: "On Track", at_risk: "At Risk", delayed: "Delayed",
  blocked: "Blocked", complete: "Complete",
}

function partnerDisplayName(p: PartnerRow) {
  return p.partner.companyName || p.partner.fullName || p.partner.email || "Partner"
}

function isAgencyOverride(notes: string | null | undefined): boolean {
  return typeof notes === "string" && notes.startsWith("[Agency override]")
}

// ── Section A: Summary Dashboard ─────────────────────────────────────────────

function SummaryDashboard({ partners, loading }: { partners: PartnerRow[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <GlassCard key={i} className="p-4 animate-pulse">
            <div className="h-3 bg-white/10 rounded mb-3 w-2/3" />
            <div className="h-7 bg-white/10 rounded w-1/2" />
          </GlassCard>
        ))}
      </div>
    )
  }

  if (partners.length === 0) return null

  const totalPartners = new Set(partners.map(p => p.partnershipId)).size
  const avgCompletion = partners.length
    ? Math.round(partners.reduce((s, p) => s + p.completion_pct, 0) / partners.length)
    : 0
  const totalAlerts = partners.reduce((s, p) => s + p.alert_count, 0)

  const statusCounts: Record<string, number> = {}
  for (const p of partners) {
    const s = p.current_status || "no_update"
    statusCounts[s] = (statusCounts[s] || 0) + 1
  }

  const lastUpdate = partners
    .map(p => p.latest_partner_update?.created_at)
    .filter(Boolean)
    .sort()
    .reverse()[0]

  const lastUpdateStr = lastUpdate
    ? new Date(lastUpdate).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "—"

  const cards = [
    { label: "Partners", value: String(totalPartners), icon: <Users className="w-4 h-4 text-sky-400" /> },
    { label: "Avg Completion", value: `${avgCompletion}%`, icon: <Activity className="w-4 h-4 text-accent" /> },
    { label: "Open Alerts", value: String(totalAlerts), icon: <AlertTriangle className={cn("w-4 h-4", totalAlerts > 0 ? "text-amber-400" : "text-foreground-muted")} /> },
    { label: "On Track", value: String(statusCounts["on_track"] || 0), icon: <CheckCircle className="w-4 h-4 text-emerald-400" /> },
    { label: "At Risk / Delayed", value: String((statusCounts["at_risk"] || 0) + (statusCounts["delayed"] || 0) + (statusCounts["blocked"] || 0)), icon: <AlertTriangle className="w-4 h-4 text-red-400" /> },
    { label: "Last Update", value: lastUpdateStr, icon: <Clock className="w-4 h-4 text-foreground-muted" /> },
  ]

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
      {cards.map(c => (
        <GlassCard key={c.label} className="p-4">
          <div className="flex items-center gap-2 mb-2">{c.icon}<span className="font-mono text-[10px] uppercase tracking-wider text-foreground-muted">{c.label}</span></div>
          <div className="font-display font-bold text-xl text-foreground">{c.value}</div>
        </GlassCard>
      ))}
    </div>
  )
}

// ── Override modal ────────────────────────────────────────────────────────────

type OverrideModalProps = {
  row: PartnerRow; projectId: string
  onClose: () => void; onSaved: () => void
}

function OverrideModal({ row, projectId, onClose, onSaved }: OverrideModalProps) {
  const [status, setStatus] = useState(row.current_status || "on_track")
  const [pct, setPct] = useState(row.completion_pct)
  const [note, setNote] = useState("")
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const handleSave = useCallback(async () => {
    setSaving(true); setErr(null)
    try {
      const res = await fetch(`/api/agency/projects/${projectId}/status-updates`, {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          partnershipId: row.partnershipId,
          projectAssignmentId: row.assignmentId,
          status, completionPct: pct, note,
        }),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); setErr(d?.error || "Failed"); return }
      onSaved()
    } catch { setErr("Failed to save") }
    finally { setSaving(false) }
  }, [projectId, row, status, pct, note, onSaved])

  const statuses = ["on_track", "at_risk", "delayed", "blocked", "complete"]

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-md bg-card border border-border rounded-xl p-6 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-display font-bold text-lg text-foreground">Override Partner Status</h3>
          <button type="button" onClick={onClose}><X className="w-4 h-4 text-foreground-muted" /></button>
        </div>
        <p className="text-sm text-foreground-muted">
          Overrides are recorded as agency-set updates. Partners see this reflected in their status history.
        </p>
        <div className="space-y-1">
          <label className="font-mono text-[10px] uppercase tracking-wider text-foreground-muted">Partner</label>
          <p className="text-sm text-foreground">{partnerDisplayName(row)} — {row.scopeItemName || "Scope"}</p>
        </div>
        <div className="space-y-2">
          <label className="font-mono text-[10px] uppercase tracking-wider text-foreground-muted">Status</label>
          <div className="flex flex-wrap gap-2">
            {statuses.map(s => (
              <button key={s} type="button" onClick={() => setStatus(s)}
                className={cn("px-3 py-1.5 rounded-lg font-mono text-[10px] uppercase tracking-wider border transition-colors",
                  status === s ? "bg-accent text-accent-foreground border-accent" : "bg-white/5 text-foreground-muted border-border hover:bg-white/10")}>
                {STATUS_LABEL[s] || s}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <label className="font-mono text-[10px] uppercase tracking-wider text-foreground-muted">Completion % (0–100)</label>
          <div className="flex items-center gap-3">
            <input type="range" min={0} max={100} value={pct} onChange={e => setPct(Number(e.target.value))}
              className="flex-1 accent-accent" />
            <span className="font-mono text-sm text-foreground w-10 text-right">{pct}%</span>
          </div>
        </div>
        <div className="space-y-2">
          <label className="font-mono text-[10px] uppercase tracking-wider text-foreground-muted">Note (optional)</label>
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
            placeholder="Reason for override, context for the partner…"
            className="w-full bg-white/5 border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-foreground-muted/50 resize-none" />
        </div>
        {err && <p className="text-sm text-red-300">{err}</p>}
        <div className="flex gap-3 pt-2">
          <Button variant="outline" className="flex-1 border-border" onClick={onClose}>Cancel</Button>
          <Button className="flex-1 bg-accent text-accent-foreground" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            {saving ? "Saving…" : "Save Override"}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ── Section B: Partner Status Updates ────────────────────────────────────────

function PartnerStatusSection({
  partners, projectId, loading, onRefresh,
}: { partners: PartnerRow[]; projectId: string; loading: boolean; onRefresh: () => void }) {
  const [resolving, setResolving] = useState<string | null>(null)
  const [overrideRow, setOverrideRow] = useState<PartnerRow | null>(null)

  const handleResolve = useCallback(async (updateId: string) => {
    setResolving(updateId)
    try {
      await fetch(`/api/agency/projects/${projectId}/status-updates`, {
        method: "PATCH", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updateId }),
      })
      onRefresh()
    } catch { /* silent */ }
    finally { setResolving(null) }
  }, [projectId, onRefresh])

  if (loading) {
    return <div className="flex items-center gap-2 text-foreground-muted py-8"><Loader2 className="w-5 h-5 animate-spin" /><span className="font-mono text-sm">Loading partner status…</span></div>
  }

  if (partners.length === 0) {
    return (
      <div className="rounded-xl border border-border/40 bg-white/5 p-8 text-center">
        <p className="text-foreground-muted text-sm">No awarded partners yet for this project.</p>
      </div>
    )
  }

  return (
    <>
      {overrideRow && (
        <OverrideModal row={overrideRow} projectId={projectId}
          onClose={() => setOverrideRow(null)} onSaved={() => { setOverrideRow(null); onRefresh() }} />
      )}
      <div className="space-y-3">
        <p className="font-mono text-[10px] text-foreground-muted/70 italic">
          Status and completion data comes from partner-submitted updates via their portal. Partners update via Active Projects in the partner portal.
        </p>
        {partners.map(row => {
          const name = partnerDisplayName(row)
          const badge = row.current_status ? STATUS_BADGE[row.current_status] : null
          const badgeLabel = row.current_status ? (STATUS_LABEL[row.current_status] || row.current_status) : null
          const agencySet = isAgencyOverride(row.latest_partner_update?.notes)
          const alertId = row.latest_alert?.id

          return (
            <div key={`${row.assignmentId}-${row.awardedResponseId ?? ""}`}
              className="rounded-xl border border-border/40 bg-white/5 p-5 space-y-4">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="font-display font-bold text-foreground">{name}</span>
                    {row.scopeItemName && (
                      <span className="font-mono text-[10px] text-foreground-muted px-2 py-0.5 rounded bg-white/5 border border-border/40">{row.scopeItemName}</span>
                    )}
                    {badge && badgeLabel && (
                      <span className={cn("font-mono text-[9px] px-2 py-0.5 rounded-full border uppercase tracking-wider", badge)}>{badgeLabel}</span>
                    )}
                    {agencySet && (
                      <span className="flex items-center gap-1 font-mono text-[9px] px-2 py-0.5 rounded-full border border-sky-500/40 bg-sky-500/15 text-sky-300">
                        <Shield className="w-2.5 h-2.5" />Agency updated
                      </span>
                    )}
                    {row.alert_count > 0 && (
                      <span className="flex items-center gap-1 font-mono text-[9px] px-2 py-0.5 rounded-full border border-amber-500/40 bg-amber-500/15 text-amber-200">
                        <AlertTriangle className="w-2.5 h-2.5" />{row.alert_count} alert{row.alert_count > 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                  {row.latest_partner_update?.notes && !agencySet && (
                    <p className="text-xs text-foreground-muted mt-1 italic line-clamp-2">
                      &ldquo;{row.latest_partner_update.notes}&rdquo;
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {alertId && (
                    <Button size="sm" variant="outline"
                      className="h-7 border-amber-500/40 text-amber-200 hover:bg-amber-500/10"
                      disabled={resolving === alertId}
                      onClick={() => handleResolve(alertId)}>
                      {resolving === alertId ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
                      Resolve
                    </Button>
                  )}
                  <Button size="sm" variant="outline"
                    className="h-7 border-border text-foreground hover:bg-white/10"
                    onClick={() => setOverrideRow(row)}>
                    Override Status
                  </Button>
                </div>
              </div>

              {/* Completion bar */}
              <div>
                <div className="flex justify-between text-[10px] font-mono text-foreground-muted mb-1">
                  <span>Completion</span><span>{row.completion_pct}%</span>
                </div>
                <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                  <div className="h-full bg-accent/80 rounded-full transition-all" style={{ width: `${row.completion_pct}%` }} />
                </div>
              </div>

              {/* Latest alert notes */}
              {row.latest_alert?.notes && (
                <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-foreground-muted">
                  <span className="font-mono text-[10px] text-amber-400 uppercase tracking-wider mr-2">Latest alert</span>
                  {row.latest_alert.notes}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}

// ── Inner content (inside AgencyLayout / SelectedProjectProvider) ─────────────

function ActiveEngagementsContent() {
  const { selectedProject, setSelectedProject, projects, isLoadingProjects } = useSelectedProject()
  const projectId = selectedProject?.id ?? null

  const [refreshKey, setRefreshKey] = useState(0)
  const refresh = useCallback(() => setRefreshKey(k => k + 1), [])

  const engUrl = projectId
    ? `/api/agency/active-engagements?projectId=${encodeURIComponent(projectId)}&_k=${refreshKey}`
    : ""
  const { data: engData, isLoading: engLoading } = useFetch<{ projects: ProjectEngagement[] }>(engUrl)

  // The active-engagements API returns per-project data; we want the selected project's partners
  const partners = useMemo<PartnerRow[]>(() => {
    const proj = engData?.projects?.find(p => p.id === projectId)
    return proj?.partners ?? []
  }, [engData, projectId])

  return (
    <div className="p-8 max-w-6xl space-y-10">
      {/* Project selector */}
      <InlineProjectSelector
        selectedProject={selectedProject}
        projects={projects}
        isLoadingProjects={isLoadingProjects}
        onSelect={setSelectedProject}
        label="Active Engagements for project"
      />

      {!selectedProject && !isLoadingProjects && (
        <div className="rounded-xl border border-border/40 bg-white/5 p-12 text-center">
          <p className="text-foreground-muted">Select a project above to view its engagements.</p>
        </div>
      )}

      {selectedProject && (
        <>
          {/* ─── Section A: Summary ─── */}
          <section className="space-y-4">
            <h2 className="font-mono text-[10px] uppercase tracking-wider text-foreground-muted">Health Overview</h2>
            <SummaryDashboard partners={partners} loading={engLoading} />
          </section>

          {/* ─── Section B: Partner Status Updates ─── */}
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display font-bold text-xl text-foreground">Partner Status Updates</h2>
            </div>
            <PartnerStatusSection
              partners={partners}
              projectId={projectId!}
              loading={engLoading}
              onRefresh={refresh}
            />
          </section>

          {/* ─── Section C: Utilization ─── */}
          <section className="space-y-4">
            <h2 className="font-display font-bold text-xl text-foreground">Utilization &amp; Resource Allocation</h2>
            <Suspense fallback={<div className="flex items-center gap-2 text-foreground-muted py-8"><Loader2 className="w-5 h-5 animate-spin" /><span className="font-mono text-sm">Loading utilization…</span></div>}>
              <UtilizationContent filterProjectId={projectId} />
            </Suspense>
          </section>

          {/* ─── Section D: Cash Flow ─── */}
          <section className="space-y-4">
            <h2 className="font-display font-bold text-xl text-foreground">Cash Flow &amp; Payments</h2>
            <AgencyMsaContent hideProjectHeader />
          </section>
        </>
      )}
    </div>
  )
}

export default function ActiveEngagementsPage() {
  return (
    <AgencyLayout>
      <ActiveEngagementsContent />
    </AgencyLayout>
  )
}
