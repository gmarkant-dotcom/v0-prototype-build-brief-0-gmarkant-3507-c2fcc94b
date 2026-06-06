"use client"

import { useState, useMemo, useCallback, Suspense } from "react"
import Link from "next/link"
import { AgencyLayout } from "@/components/agency-layout"
import { InlineProjectSelector } from "@/components/agency-project-selector"
import { useSelectedProject } from "@/contexts/selected-project-context"
import { GlassCard } from "@/components/glass-card"
import { cn } from "@/lib/utils"
import { useFetch } from "@/hooks/useFetch"
import { UtilizationContent } from "@/app/agency/utilization/page"
import {
  AlertTriangle, CheckCircle, Clock, Loader2, Users, Shield,
  X, ChevronDown, Activity, Building2, DollarSign, ChevronRight,
  Search,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

// ── Types ─────────────────────────────────────────────────────────────────────

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
  alert_summaries: {
    id: string; status: string; budget_status: string
    completion_pct: number; notes_preview: string; notes: string | null; created_at: string
  }[]
  latest_partner_update: {
    status: string; budget_status: string; completion_pct: number
    notes: string | null; created_at: string
  } | null
}

type ProjectEngagement = {
  id: string; title: string
  clientName?: string | null; budgetRange?: string | null
  startDate?: string | null; endDate?: string | null
  status?: string | null
  dashboardWorkflowStage?: string | null; dashboardWorkflowLabel?: string | null
  partners: PartnerRow[]
}

type GroupBy = "partner" | "scope"

// ── Status config ──────────────────────────────────────────────────────────────

const PARTNER_STATUSES = [
  { key: "all",       label: "All" },
  { key: "no_update", label: "No Update" },
  { key: "on_track",  label: "On Track" },
  { key: "at_risk",   label: "At Risk" },
  { key: "delayed",   label: "Delayed" },
  { key: "blocked",   label: "Blocked" },
  { key: "complete",  label: "Complete" },
] as const

type StatusKey = (typeof PARTNER_STATUSES)[number]["key"]

const STATUS_BADGE: Record<string, { bg: string; text: string; border: string }> = {
  on_track:  { bg: "bg-emerald-500/15", text: "text-emerald-300", border: "border-emerald-500/40" },
  at_risk:   { bg: "bg-amber-500/15",   text: "text-amber-200",   border: "border-amber-500/40" },
  delayed:   { bg: "bg-red-500/15",     text: "text-red-300",     border: "border-red-500/40" },
  blocked:   { bg: "bg-red-500/15",     text: "text-red-300",     border: "border-red-500/40" },
  complete:  { bg: "bg-cyan-500/15",    text: "text-cyan-200",    border: "border-cyan-500/40" },
  no_update: { bg: "bg-white/10",       text: "text-foreground-muted", border: "border-border/40" },
}

const STATUS_LABEL: Record<string, string> = {
  on_track: "On Track", at_risk: "At Risk", delayed: "Delayed",
  blocked: "Blocked", complete: "Complete", no_update: "No Update",
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function partnerDisplayName(p: PartnerRow): string {
  return p.partner.companyName || p.partner.fullName || p.partner.email || "Partner"
}

function isAgencyOverride(notes: string | null | undefined): boolean {
  return typeof notes === "string" && notes.startsWith("[Agency override]")
}

function statusKey(row: PartnerRow): StatusKey {
  return (row.current_status as StatusKey) || "no_update"
}

function parseBudgetAmount(raw: string): number | null {
  if (!raw) return null
  try {
    let v: unknown = JSON.parse(raw)
    if (typeof v === "string") v = JSON.parse(v)
    if (v && typeof v === "object" && "amount" in (v as object)) {
      const n = Number((v as { amount?: unknown }).amount)
      return isNaN(n) ? null : n
    }
  } catch {}
  return null
}

function parseBudgetCurrency(raw: string): string {
  if (!raw) return "USD"
  try {
    let v: unknown = JSON.parse(raw)
    if (typeof v === "string") v = JSON.parse(v)
    if (v && typeof v === "object" && "currency" in (v as object)) {
      return String((v as { currency?: unknown }).currency || "USD")
    }
  } catch {}
  return "USD"
}

function formatMoney(n: number, currency = "USD"): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency", currency, maximumFractionDigits: 0,
    }).format(n)
  } catch {
    return `$${n.toLocaleString("en-US")}`
  }
}

function parseProjectBudget(raw: string | null | undefined): number | null {
  if (!raw) return null
  const n = parseFloat(String(raw).replace(/[$,\s]/g, "").trim())
  return isNaN(n) ? null : n
}

// ── Summary Dashboard ──────────────────────────────────────────────────────────

function SummaryDashboard({
  partners, project, loading,
}: {
  partners: PartnerRow[]
  project: ProjectEngagement | null
  loading: boolean
}) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <GlassCard key={i} className="p-4 animate-pulse h-20">
            <div className="h-2 bg-white/10 rounded w-2/3 mb-3" />
            <div className="h-5 bg-white/10 rounded w-1/2" />
          </GlassCard>
        ))}
      </div>
    )
  }

  if (!partners.length) return null

  const totalPartners = new Set(partners.map(p => p.partnershipId)).size
  const avgCompletion = Math.round(partners.reduce((s, p) => s + p.completion_pct, 0) / partners.length)
  const totalAlerts = partners.reduce((s, p) => s + p.alert_count, 0)
  const onTrack = partners.filter(p => p.current_status === "on_track").length
  const atRisk = partners.filter(p => ["at_risk","delayed","blocked"].includes(p.current_status || "")).length

  const totalVendorCommitted = partners.reduce((s, p) => {
    const n = parseBudgetAmount(p.budgetProposal)
    return s + (n ?? 0)
  }, 0)
  const clientBudget = parseProjectBudget(project?.budgetRange)
  const margin = clientBudget != null ? clientBudget - totalVendorCommitted : null

  const cards = [
    { label: "Partners", value: String(totalPartners), icon: <Users className="w-3.5 h-3.5 text-sky-400" /> },
    { label: "Avg Completion", value: `${avgCompletion}%`, icon: <Activity className="w-3.5 h-3.5 text-accent" /> },
    { label: "Open Alerts", value: String(totalAlerts), icon: <AlertTriangle className={cn("w-3.5 h-3.5", totalAlerts > 0 ? "text-amber-400" : "text-foreground-muted")} /> },
    { label: "On Track", value: String(onTrack), icon: <CheckCircle className="w-3.5 h-3.5 text-emerald-400" /> },
    { label: "At Risk", value: String(atRisk), icon: <AlertTriangle className="w-3.5 h-3.5 text-red-400" /> },
    {
      label: "Margin",
      value: margin != null ? formatMoney(margin) : "—",
      icon: <DollarSign className={cn("w-3.5 h-3.5", margin != null ? (margin >= 0 ? "text-emerald-400" : "text-red-400") : "text-foreground-muted")} />,
    },
  ]

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
      {cards.map(c => (
        <GlassCard key={c.label} className="p-4">
          <div className="flex items-center gap-1.5 mb-1.5">
            {c.icon}
            <span className="font-mono text-[9px] uppercase tracking-wider text-foreground-muted">{c.label}</span>
          </div>
          <div className="font-display font-bold text-lg text-foreground">{c.value}</div>
        </GlassCard>
      ))}
    </div>
  )
}

// ── Override Modal (preserved exactly) ────────────────────────────────────────

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

// ── Partner Card ───────────────────────────────────────────────────────────────

function PartnerCard({
  row, projectId, resolving, onResolve, onOverride,
}: {
  row: PartnerRow
  projectId: string
  resolving: string | null
  onResolve: (alertId: string) => void
  onOverride: (row: PartnerRow) => void
}) {
  const name = partnerDisplayName(row)
  const sk = statusKey(row)
  const badge = STATUS_BADGE[sk]
  const badgeLabel = STATUS_LABEL[sk] || sk
  const agencySet = isAgencyOverride(row.latest_partner_update?.notes)
  const alertId = row.latest_alert?.id
  const budgetAmt = parseBudgetAmount(row.budgetProposal)
  const budgetCur = parseBudgetCurrency(row.budgetProposal)
  const notesText = row.latest_partner_update?.notes && !agencySet
    ? row.latest_partner_update.notes
    : null

  return (
    <div className="rounded-lg border border-border/40 bg-white/5 p-4 space-y-3">
      {/* Top row: name + badges + actions */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap flex-1 min-w-0">
          <span className="font-display font-bold text-sm text-foreground">{name}</span>
          {row.scopeItemName && (
            <span className="font-mono text-[9px] text-foreground-muted px-1.5 py-0.5 rounded bg-white/5 border border-border/40 shrink-0">
              {row.scopeItemName}
            </span>
          )}
          <span className={cn("font-mono text-[9px] px-2 py-0.5 rounded-full border uppercase tracking-wider shrink-0", badge.bg, badge.text, badge.border)}>
            {badgeLabel}
          </span>
          {agencySet && (
            <span className="flex items-center gap-1 font-mono text-[9px] px-1.5 py-0.5 rounded-full border border-sky-500/40 bg-sky-500/15 text-sky-300 shrink-0">
              <Shield className="w-2.5 h-2.5" />Agency
            </span>
          )}
          {row.alert_count > 0 && (
            <span className="flex items-center gap-1 font-mono text-[9px] px-1.5 py-0.5 rounded-full border border-amber-500/40 bg-amber-500/15 text-amber-200 shrink-0">
              <AlertTriangle className="w-2.5 h-2.5" />{row.alert_count}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {alertId && (
            <Button size="sm" variant="outline"
              className="h-6 px-2 text-[10px] border-amber-500/40 text-amber-200 hover:bg-amber-500/10"
              disabled={resolving === alertId}
              onClick={() => onResolve(alertId)}>
              {resolving === alertId ? <Loader2 className="w-2.5 h-2.5 animate-spin mr-1" /> : null}
              Resolve
            </Button>
          )}
          <Button size="sm" variant="outline"
            className="h-6 px-2 text-[10px] border-border text-foreground-muted hover:bg-white/10"
            onClick={() => onOverride(row)}>
            Override
          </Button>
        </div>
      </div>

      {/* Completion bar + budget */}
      <div className="flex items-center gap-4">
        <div className="flex-1 space-y-1">
          <div className="flex justify-between text-[9px] font-mono text-foreground-muted">
            <span>Completion</span><span>{row.completion_pct}%</span>
          </div>
          <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
            <div className={cn("h-full rounded-full transition-all", sk === "complete" ? "bg-cyan-400/80" : "bg-accent/80")}
              style={{ width: `${row.completion_pct}%` }} />
          </div>
        </div>
        {budgetAmt != null && (
          <span className="font-mono text-[10px] text-accent shrink-0">
            {formatMoney(budgetAmt, budgetCur)}
          </span>
        )}
      </div>

      {/* Partner notes */}
      {notesText && (
        <p className="text-[11px] text-foreground-muted italic line-clamp-2 leading-relaxed">
          &ldquo;{notesText}&rdquo;
        </p>
      )}

      {/* Latest alert callout */}
      {row.latest_alert?.notes && (
        <div className="rounded border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[11px] text-foreground-muted">
          <span className="font-mono text-[9px] text-amber-400 uppercase tracking-wider mr-2">Alert</span>
          {row.latest_alert.notes}
        </div>
      )}
    </div>
  )
}

// ── Group Section ──────────────────────────────────────────────────────────────

function GroupSection({
  label, rows, projectId, resolving, onResolve, onOverride, defaultOpen,
}: {
  label: string
  rows: PartnerRow[]
  projectId: string
  resolving: string | null
  onResolve: (alertId: string) => void
  onOverride: (row: PartnerRow) => void
  defaultOpen: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const [activeStatus, setActiveStatus] = useState<StatusKey>("all")

  const counts = useMemo(() => {
    const map: Record<string, number> = { all: rows.length }
    for (const r of rows) {
      const k = statusKey(r)
      map[k] = (map[k] || 0) + 1
    }
    return map
  }, [rows])

  const filtered = useMemo(
    () => activeStatus === "all" ? rows : rows.filter(r => statusKey(r) === activeStatus),
    [rows, activeStatus]
  )

  const totalAlerts = rows.reduce((s, r) => s + r.alert_count, 0)

  return (
    <div className="rounded-xl border border-border/40 bg-white/[0.02] overflow-hidden">
      <button type="button" onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-4 p-4 hover:bg-white/5 transition-colors text-left">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-display font-bold text-base text-foreground">{label}</span>
            <span className="font-mono text-[10px] text-foreground-muted">{rows.length} scope{rows.length !== 1 ? "s" : ""}</span>
            {totalAlerts > 0 && (
              <span className="flex items-center gap-1 font-mono text-[9px] px-1.5 py-0.5 rounded-full border border-amber-500/40 bg-amber-500/15 text-amber-200">
                <AlertTriangle className="w-2.5 h-2.5" />{totalAlerts} alert{totalAlerts > 1 ? "s" : ""}
              </span>
            )}
          </div>
        </div>
        <ChevronDown className={cn("w-4 h-4 text-foreground-muted shrink-0 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="border-t border-border/30">
          {/* Status tabs */}
          <div className="flex gap-1 flex-wrap px-4 pt-3 pb-2">
            {PARTNER_STATUSES.map(({ key, label: tl }) => {
              const count = key === "all" ? rows.length : (counts[key] ?? 0)
              return (
                <button key={key} type="button" onClick={() => setActiveStatus(key)}
                  className={cn("shrink-0 px-2.5 py-1 rounded-lg font-mono text-[10px] transition-colors whitespace-nowrap",
                    activeStatus === key ? "bg-accent text-accent-foreground" : "bg-white/5 text-foreground-muted hover:bg-white/10")}>
                  {tl} ({count})
                </button>
              )
            })}
          </div>
          {/* Cards */}
          <div className="px-4 pb-4 space-y-2">
            {filtered.length === 0 ? (
              <p className="text-sm text-foreground-muted py-4 text-center">No partners match this filter.</p>
            ) : (
              filtered.map(row => (
                <PartnerCard
                  key={`${row.assignmentId}-${row.awardedResponseId ?? ""}`}
                  row={row} projectId={projectId}
                  resolving={resolving} onResolve={onResolve} onOverride={onOverride}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Grouped partner list ───────────────────────────────────────────────────────

function GroupedPartnerList({
  partners, projectId, loading, onRefresh,
}: {
  partners: PartnerRow[]
  projectId: string
  loading: boolean
  onRefresh: () => void
}) {
  const [groupBy, setGroupBy] = useState<GroupBy>("partner")
  const [search, setSearch] = useState("")
  const [resolving, setResolving] = useState<string | null>(null)
  const [overrideRow, setOverrideRow] = useState<PartnerRow | null>(null)

  // Resolve: preserved exactly
  const handleResolve = useCallback(async (alertId: string) => {
    setResolving(alertId)
    try {
      await fetch(`/api/agency/projects/${projectId}/status-updates`, {
        method: "PATCH", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updateId: alertId }),
      })
      onRefresh()
    } catch { /* silent */ }
    finally { setResolving(null) }
  }, [projectId, onRefresh])

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = q
      ? partners.filter(r => [partnerDisplayName(r), r.scopeItemName].join(" ").toLowerCase().includes(q))
      : partners

    const map = new Map<string, PartnerRow[]>()
    for (const r of filtered) {
      const key = groupBy === "partner" ? partnerDisplayName(r) : (r.scopeItemName || "No Scope")
      const list = map.get(key) ?? []
      list.push(r)
      map.set(key, list)
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, rows]) => ({ label, rows }))
  }, [partners, groupBy, search])

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-foreground-muted py-8">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span className="font-mono text-sm">Loading partner data…</span>
      </div>
    )
  }

  if (!partners.length) {
    return (
      <div className="rounded-xl border border-border/40 bg-white/5 p-10 text-center">
        <p className="text-foreground-muted text-sm">No awarded partners for this project yet.</p>
      </div>
    )
  }

  return (
    <>
      {overrideRow && (
        <OverrideModal row={overrideRow} projectId={projectId}
          onClose={() => setOverrideRow(null)}
          onSaved={() => { setOverrideRow(null); onRefresh() }} />
      )}

      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground-muted" />
          <Input placeholder="Search partner or scope…" value={search} onChange={e => setSearch(e.target.value)}
            className="pl-9 h-9 bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50 text-sm" />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider">Group by</span>
          <div className="flex rounded-lg overflow-hidden border border-border">
            {(["partner", "scope"] as GroupBy[]).map(g => (
              <button key={g} type="button" onClick={() => setGroupBy(g)}
                className={cn("px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider transition-colors",
                  groupBy === g ? "bg-accent text-accent-foreground" : "bg-white/5 text-foreground-muted hover:bg-white/10")}>
                {g === "partner" ? "Partner" : "Scope"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <p className="font-mono text-[10px] text-foreground-muted/60 italic">
        Status and completion come from partner-submitted updates via their portal.
      </p>

      {/* Groups */}
      {groups.length === 0 ? (
        <p className="text-sm text-foreground-muted text-center py-4">No results match your search.</p>
      ) : (
        <div className="space-y-3">
          {groups.map((g, i) => (
            <GroupSection
              key={g.label} label={g.label} rows={g.rows}
              projectId={projectId} resolving={resolving}
              onResolve={handleResolve} onOverride={setOverrideRow}
              defaultOpen={i === 0}
            />
          ))}
        </div>
      )}
    </>
  )
}

// ── Inner page content ─────────────────────────────────────────────────────────

function ActiveEngagementsContent() {
  const { selectedProject, setSelectedProject, projects, isLoadingProjects } = useSelectedProject()
  const projectId = selectedProject?.id ?? null

  const [refreshKey, setRefreshKey] = useState(0)
  const refresh = useCallback(() => setRefreshKey(k => k + 1), [])

  const engUrl = projectId
    ? `/api/agency/active-engagements?projectId=${encodeURIComponent(projectId)}&_k=${refreshKey}`
    : ""
  const { data: engData, isLoading: engLoading } = useFetch<{ projects: ProjectEngagement[] }>(engUrl)

  const currentProject = useMemo(
    () => engData?.projects?.find(p => p.id === projectId) ?? null,
    [engData, projectId]
  )
  const partners = useMemo(() => currentProject?.partners ?? [], [currentProject])

  return (
    <div className="p-8 max-w-6xl space-y-8">
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
          {/* Summary */}
          <SummaryDashboard partners={partners} project={currentProject} loading={engLoading} />

          {/* Partner Status */}
          <section className="space-y-4">
            <h2 className="font-display font-bold text-xl text-foreground">Partner Status</h2>
            <GroupedPartnerList
              partners={partners}
              projectId={projectId!}
              loading={engLoading}
              onRefresh={refresh}
            />
          </section>

          {/* Utilization */}
          <section className="space-y-4">
            <h2 className="font-display font-bold text-xl text-foreground">Utilization</h2>
            <Suspense fallback={
              <div className="flex items-center gap-2 text-foreground-muted py-6">
                <Loader2 className="w-5 h-5 animate-spin" /><span className="font-mono text-sm">Loading…</span>
              </div>
            }>
              <UtilizationContent filterProjectId={projectId} />
            </Suspense>
          </section>

          {/* Cash Flow link */}
          <section>
            <Link href="/agency/cashflow"
              className="flex items-center justify-between p-5 rounded-xl border border-border/40 bg-white/5 hover:bg-white/10 transition-colors group">
              <div>
                <h2 className="font-display font-bold text-xl text-foreground">Cash Flow &amp; Payments</h2>
                <p className="text-sm text-foreground-muted mt-1">MSA agreements, payment milestones, and AI-generated schedules.</p>
              </div>
              <ChevronRight className="w-5 h-5 text-foreground-muted group-hover:text-accent transition-colors shrink-0" />
            </Link>
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
