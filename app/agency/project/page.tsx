"use client"

import { useState, useMemo, useCallback, Suspense } from "react"
import { AgencyLayout } from "@/components/agency-layout"
import { InlineProjectSelector } from "@/components/agency-project-selector"
import { useSelectedProject } from "@/contexts/selected-project-context"
import { GlassCard } from "@/components/glass-card"
import { cn } from "@/lib/utils"
import { useFetch } from "@/hooks/useFetch"
import { UtilizationContent } from "@/app/agency/utilization/page"
import { AgencyMsaContent } from "@/app/agency/msa/page"
import {
  AlertTriangle, CheckCircle, Loader2, Users, Shield,
  X, ChevronDown, ChevronRight, DollarSign, Activity,
  Search, TrendingUp, TrendingDown, Building2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

// ── Types ─────────────────────────────────────────────────────────────────────

type LatestAlert = {
  id: string; status: string; budget_status: string
  completion_pct: number; notes: string | null; created_at: string
}

type AlertSummary = {
  id: string; status: string; budget_status: string
  completion_pct: number; notes_preview: string; notes: string | null; created_at: string
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
  alert_summaries: AlertSummary[]
  latest_partner_update: {
    status: string; budget_status: string; completion_pct: number
    notes: string | null; created_at: string
  } | null
}

type ProjectEngagement = {
  id: string; title: string
  clientName?: string | null; budgetRange?: string | null
  startDate?: string | null; endDate?: string | null; status?: string | null
  dashboardWorkflowStage?: string | null; dashboardWorkflowLabel?: string | null
  partners: PartnerRow[]
}

type GroupBy = "client" | "partner"
type SlideTab = "status" | "utilization" | "cashflow"

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

// ── Pure helpers ───────────────────────────────────────────────────────────────

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
    if (v && typeof v === "object" && "currency" in (v as object))
      return String((v as { currency?: unknown }).currency || "USD")
  } catch {}
  return "USD"
}
function formatMoney(n: number, currency = "USD"): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(n)
  } catch { return `$${n.toLocaleString("en-US")}` }
}
function parseProjectBudget(raw: string | null | undefined): number | null {
  if (!raw) return null
  const n = parseFloat(String(raw).replace(/[$,\s]/g, "").trim())
  return isNaN(n) ? null : n
}
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
}

// ── Summary bar ────────────────────────────────────────────────────────────────

function SummaryBar({ partners, project, loading }: {
  partners: PartnerRow[]; project: ProjectEngagement | null; loading: boolean
}) {
  if (loading) {
    return (
      <div className="flex gap-0 rounded-xl border border-border/40 bg-white/5 overflow-hidden animate-pulse">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex-1 p-4 border-r border-border/30 last:border-0">
            <div className="h-2 bg-white/10 rounded w-3/4 mb-2" />
            <div className="h-5 bg-white/10 rounded w-1/2" />
          </div>
        ))}
      </div>
    )
  }

  const totalPartners = new Set(partners.map(p => p.partnershipId)).size
  const avgCompletion = partners.length
    ? Math.round(partners.reduce((s, p) => s + p.completion_pct, 0) / partners.length) : 0
  const totalAlerts = partners.reduce((s, p) => s + p.alert_count, 0)
  const onTrack = partners.filter(p => p.current_status === "on_track").length
  const atRisk = partners.filter(p => ["at_risk","delayed","blocked"].includes(p.current_status || "")).length
  const totalVendorSpend = partners.reduce((s, p) => s + (parseBudgetAmount(p.budgetProposal) ?? 0), 0)
  const clientBudget = parseProjectBudget(project?.budgetRange)
  const margin = clientBudget != null ? clientBudget - totalVendorSpend : null

  const stats = [
    { label: "Client Budget", value: clientBudget != null ? formatMoney(clientBudget) : "—", icon: <TrendingUp className="w-3.5 h-3.5 text-sky-400" />, highlight: false },
    { label: "Vendor Spend",  value: totalVendorSpend > 0 ? formatMoney(totalVendorSpend) : "$0", icon: <TrendingDown className="w-3.5 h-3.5 text-accent" />, highlight: false },
    {
      label: "Margin",
      value: margin != null ? formatMoney(margin) : "—",
      icon: <DollarSign className={cn("w-3.5 h-3.5", margin == null ? "text-foreground-muted" : margin >= 0 ? "text-emerald-400" : "text-red-400")} />,
      highlight: false,
    },
    { label: "Partners",      value: String(totalPartners), icon: <Users className="w-3.5 h-3.5 text-sky-400" />, highlight: false },
    { label: "Avg Completion",value: `${avgCompletion}%`,  icon: <Activity className="w-3.5 h-3.5 text-accent" />, highlight: false },
    { label: "Open Alerts",   value: String(totalAlerts),  icon: <AlertTriangle className={cn("w-3.5 h-3.5", totalAlerts > 0 ? "text-amber-400" : "text-foreground-muted")} />, highlight: totalAlerts > 0 },
    { label: "On Track",      value: String(onTrack),      icon: <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />, highlight: false },
    { label: "At Risk",       value: String(atRisk),       icon: <AlertTriangle className={cn("w-3.5 h-3.5", atRisk > 0 ? "text-red-400" : "text-foreground-muted")} />, highlight: atRisk > 0 },
  ]

  return (
    <div className="flex rounded-xl border border-border/40 bg-white/5 overflow-hidden flex-wrap">
      {stats.map((s, i) => (
        <div key={s.label} className={cn(
          "flex-1 min-w-[100px] p-4 border-r border-border/30 last:border-r-0",
          s.highlight && "bg-amber-500/5"
        )}>
          <div className="flex items-center gap-1.5 mb-1">
            {s.icon}
            <span className="font-mono text-[9px] uppercase tracking-wider text-foreground-muted whitespace-nowrap">{s.label}</span>
          </div>
          <div className={cn("font-display font-bold text-base tabular-nums", s.highlight ? "text-amber-200" : "text-foreground")}>{s.value}</div>
        </div>
      ))}
    </div>
  )
}

// ── Override form (inside slide-over Tab 1) ────────────────────────────────────

function OverrideForm({ row, projectId, onSaved }: {
  row: PartnerRow; projectId: string; onSaved: () => void
}) {
  const [status, setStatus] = useState(row.current_status || "on_track")
  const [pct, setPct] = useState(row.completion_pct)
  const [note, setNote] = useState("")
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  const handleSave = useCallback(async () => {
    setSaving(true); setErr(null)
    try {
      const res = await fetch(`/api/agency/projects/${projectId}/status-updates`, {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partnershipId: row.partnershipId, projectAssignmentId: row.assignmentId, status, completionPct: pct, note }),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); setErr(d?.error || "Failed"); return }
      setOpen(false); setNote(""); onSaved()
    } catch { setErr("Failed to save") }
    finally { setSaving(false) }
  }, [projectId, row, status, pct, note, onSaved])

  const statuses = ["on_track", "at_risk", "delayed", "blocked", "complete"]

  return (
    <div className="rounded-lg border border-border/40 bg-white/5">
      <button type="button" onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-white/5 transition-colors">
        <span className="font-mono text-xs text-foreground-muted uppercase tracking-wider">Override Status</span>
        <ChevronDown className={cn("w-4 h-4 text-foreground-muted transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="border-t border-border/30 p-4 space-y-4">
          <p className="text-xs text-foreground-muted">Overrides are recorded as agency-set updates.</p>
          <div className="space-y-2">
            <label className="font-mono text-[10px] uppercase tracking-wider text-foreground-muted">Status</label>
            <div className="flex flex-wrap gap-2">
              {statuses.map(s => (
                <button key={s} type="button" onClick={() => setStatus(s)}
                  className={cn("px-2.5 py-1.5 rounded-lg font-mono text-[10px] uppercase tracking-wider border transition-colors",
                    status === s ? "bg-accent text-accent-foreground border-accent" : "bg-white/5 text-foreground-muted border-border hover:bg-white/10")}>
                  {STATUS_LABEL[s] || s}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between">
              <label className="font-mono text-[10px] uppercase tracking-wider text-foreground-muted">Completion</label>
              <span className="font-mono text-xs text-foreground">{pct}%</span>
            </div>
            <input type="range" min={0} max={100} value={pct} onChange={e => setPct(Number(e.target.value))} className="w-full accent-accent" />
          </div>
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="Reason for override…"
            className="w-full bg-white/5 border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-foreground-muted/50 resize-none" />
          {err && <p className="text-xs text-red-300">{err}</p>}
          <Button className="w-full bg-accent text-accent-foreground" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            {saving ? "Saving…" : "Save Override"}
          </Button>
        </div>
      )}
    </div>
  )
}

// ── Slide-over panel ───────────────────────────────────────────────────────────

function SlideOverPanel({ row, projectId, resolving, onResolve, onRefresh, onClose }: {
  row: PartnerRow
  projectId: string
  resolving: string | null
  onResolve: (alertId: string) => void
  onRefresh: () => void
  onClose: () => void
}) {
  const [tab, setTab] = useState<SlideTab>("status")
  const name = partnerDisplayName(row)
  const sk = statusKey(row)
  const badge = STATUS_BADGE[sk]
  const agencySet = isAgencyOverride(row.latest_partner_update?.notes)

  const tabs: { key: SlideTab; label: string }[] = [
    { key: "status", label: "Status & Alerts" },
    { key: "utilization", label: "Utilization" },
    { key: "cashflow", label: "Cash Flow" },
  ]

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      {/* Panel */}
      <div className="relative w-full md:w-1/2 max-w-2xl h-full bg-background border-l border-border flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between p-6 border-b border-border shrink-0">
          <div>
            <h2 className="font-display font-bold text-xl text-foreground">{name}</h2>
            {row.scopeItemName && (
              <p className="text-sm text-foreground-muted mt-0.5">{row.scopeItemName}</p>
            )}
          </div>
          <button type="button" onClick={onClose} className="text-foreground-muted hover:text-foreground mt-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-border shrink-0">
          {tabs.map(t => (
            <button key={t.key} type="button" onClick={() => setTab(t.key)}
              className={cn("px-5 py-3 font-mono text-[11px] uppercase tracking-wider transition-colors border-b-2 -mb-px",
                tab === t.key ? "border-accent text-accent" : "border-transparent text-foreground-muted hover:text-foreground")}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto">
          {tab === "status" && (
            <div className="p-6 space-y-6">
              {/* Current status */}
              <div className="space-y-3">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className={cn("font-mono text-[10px] px-2.5 py-1 rounded-full border uppercase tracking-wider", badge.bg, badge.text, badge.border)}>
                    {STATUS_LABEL[sk] || sk}
                  </span>
                  {agencySet && (
                    <span className="flex items-center gap-1 font-mono text-[9px] px-2 py-0.5 rounded-full border border-sky-500/40 bg-sky-500/15 text-sky-300">
                      <Shield className="w-2.5 h-2.5" />Agency set
                    </span>
                  )}
                </div>
                <div>
                  <div className="flex justify-between text-[10px] font-mono text-foreground-muted mb-1">
                    <span>Completion</span><span>{row.completion_pct}%</span>
                  </div>
                  <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                    <div className={cn("h-full rounded-full", sk === "complete" ? "bg-cyan-400/80" : "bg-accent/80")}
                      style={{ width: `${row.completion_pct}%` }} />
                  </div>
                </div>
                <p className="font-mono text-[10px] text-foreground-muted/70 italic">
                  Status data comes from partner-submitted updates via their portal.
                </p>
              </div>

              {/* Latest partner note */}
              {row.latest_partner_update && !agencySet && row.latest_partner_update.notes && (
                <div className="space-y-1">
                  <label className="font-mono text-[10px] uppercase tracking-wider text-foreground-muted">Latest partner note</label>
                  <p className="text-sm text-foreground leading-relaxed italic">
                    &ldquo;{row.latest_partner_update.notes}&rdquo;
                  </p>
                  <p className="font-mono text-[10px] text-foreground-muted">{fmtTime(row.latest_partner_update.created_at)}</p>
                </div>
              )}

              {/* Unresolved alerts */}
              {row.alert_summaries.length > 0 && (
                <div className="space-y-2">
                  <label className="font-mono text-[10px] uppercase tracking-wider text-foreground-muted">
                    Unresolved Alerts ({row.alert_summaries.length})
                  </label>
                  {row.alert_summaries.map(a => (
                    <div key={a.id} className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                          <span className={cn("font-mono text-[9px] px-1.5 py-0.5 rounded-full border uppercase", STATUS_BADGE[a.status]?.bg, STATUS_BADGE[a.status]?.text, STATUS_BADGE[a.status]?.border)}>
                            {STATUS_LABEL[a.status] || a.status}
                          </span>
                          <span className="font-mono text-[9px] text-foreground-muted">{fmtTime(a.created_at)}</span>
                        </div>
                        <Button size="sm" variant="outline"
                          className="h-6 px-2 text-[10px] border-amber-500/40 text-amber-200 hover:bg-amber-500/10 shrink-0"
                          disabled={resolving === a.id}
                          onClick={() => onResolve(a.id)}>
                          {resolving === a.id ? <Loader2 className="w-2.5 h-2.5 animate-spin mr-1" /> : null}
                          Resolve
                        </Button>
                      </div>
                      {a.notes && (
                        <p className="text-xs text-foreground-muted leading-relaxed">{a.notes}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Override form */}
              <OverrideForm row={row} projectId={projectId} onSaved={onRefresh} />
            </div>
          )}

          {tab === "utilization" && (
            <div className="p-6">
              <Suspense fallback={
                <div className="flex items-center gap-2 text-foreground-muted py-8">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span className="font-mono text-sm">Loading utilization…</span>
                </div>
              }>
                <UtilizationContent filterProjectId={projectId} />
              </Suspense>
            </div>
          )}

          {tab === "cashflow" && (
            <div className="p-6">
              <AgencyMsaContent hideProjectHeader />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Engagement row (compact, clickable) ────────────────────────────────────────

function EngagementRow({ row, onClick }: { row: PartnerRow; onClick: () => void }) {
  const name = partnerDisplayName(row)
  const sk = statusKey(row)
  const badge = STATUS_BADGE[sk]
  const badgeLabel = STATUS_LABEL[sk] || sk
  const budgetAmt = parseBudgetAmount(row.budgetProposal)
  const budgetCur = parseBudgetCurrency(row.budgetProposal)
  const agencySet = isAgencyOverride(row.latest_partner_update?.notes)
  const lastTs = row.latest_partner_update?.created_at

  return (
    <button type="button" onClick={onClick}
      className="w-full text-left flex items-center gap-4 p-4 rounded-lg border border-border/40 bg-white/5 hover:bg-white/10 transition-colors group">
      <div className="flex-1 min-w-0">
        {/* Line 1: name + badges */}
        <div className="flex items-center gap-2 flex-wrap mb-1.5">
          <span className="font-display font-bold text-sm text-foreground truncate">{name}</span>
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
        {/* Line 2: completion bar + meta */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="w-20 h-1.5 bg-white/10 rounded-full overflow-hidden shrink-0">
              <div className={cn("h-full rounded-full", sk === "complete" ? "bg-cyan-400/80" : "bg-accent/80")}
                style={{ width: `${row.completion_pct}%` }} />
            </div>
            <span className="font-mono text-[10px] text-foreground-muted shrink-0">{row.completion_pct}%</span>
          </div>
          <div className="flex items-center gap-3 font-mono text-[10px] text-foreground-muted shrink-0">
            {budgetAmt != null && <span className="text-accent">{formatMoney(budgetAmt, budgetCur)}</span>}
            {lastTs && <span>{fmtTime(lastTs)}</span>}
          </div>
        </div>
      </div>
      <ChevronRight className="w-4 h-4 text-foreground-muted group-hover:text-accent transition-colors shrink-0" />
    </button>
  )
}

// ── Group section ──────────────────────────────────────────────────────────────

function GroupSection({ label, rows, defaultOpen, onRowClick }: {
  label: string; rows: PartnerRow[]; defaultOpen: boolean; onRowClick: (row: PartnerRow) => void
}) {
  const [open, setOpen] = useState(defaultOpen)
  const [activeStatus, setActiveStatus] = useState<StatusKey>("all")

  const counts = useMemo(() => {
    const map: Record<string, number> = { all: rows.length }
    for (const r of rows) { const k = statusKey(r); map[k] = (map[k] || 0) + 1 }
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
        className="w-full flex items-center gap-4 p-5 hover:bg-white/5 transition-colors text-left">
        <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center shrink-0">
          <Building2 className="w-5 h-5 text-foreground-muted" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-display font-bold text-xl text-foreground">{label}</div>
          <div className="flex items-center gap-3 mt-0.5 font-mono text-[11px] text-foreground-muted">
            <span>{rows.length} engagement{rows.length !== 1 ? "s" : ""}</span>
            {totalAlerts > 0 && (
              <span className="flex items-center gap-1 text-amber-400">
                <AlertTriangle className="w-3 h-3" />{totalAlerts} alert{totalAlerts > 1 ? "s" : ""}
              </span>
            )}
          </div>
        </div>
        <ChevronDown className={cn("w-5 h-5 text-foreground-muted shrink-0 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="border-t border-border/30">
          <div className="flex gap-1 flex-wrap px-4 pt-3 pb-2 overflow-x-auto">
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
          <div className="px-4 pb-4 space-y-2">
            {filtered.length === 0 ? (
              <p className="text-sm text-foreground-muted py-4 text-center">No engagements match this filter.</p>
            ) : (
              filtered.map(row => (
                <EngagementRow
                  key={`${row.assignmentId}-${row.awardedResponseId ?? ""}`}
                  row={row}
                  onClick={() => onRowClick(row)}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main inner content ─────────────────────────────────────────────────────────

function ActiveEngagementsContent() {
  const { selectedProject, setSelectedProject, projects, isLoadingProjects } = useSelectedProject()
  const projectId = selectedProject?.id ?? null

  const [refreshKey, setRefreshKey] = useState(0)
  const refresh = useCallback(() => setRefreshKey(k => k + 1), [])

  const [groupBy, setGroupBy] = useState<GroupBy>("client")
  const [search, setSearch] = useState("")
  const [activeRow, setActiveRow] = useState<PartnerRow | null>(null)
  const [resolving, setResolving] = useState<string | null>(null)

  const engUrl = projectId
    ? `/api/agency/active-engagements?projectId=${encodeURIComponent(projectId)}&_k=${refreshKey}`
    : ""
  const { data: engData, isLoading: engLoading } = useFetch<{ projects: ProjectEngagement[] }>(engUrl)

  const currentProject = useMemo(
    () => engData?.projects?.find(p => p.id === projectId) ?? null,
    [engData, projectId]
  )
  const partners = useMemo(() => currentProject?.partners ?? [], [currentProject])

  // Resolve: preserved exactly
  const handleResolve = useCallback(async (alertId: string) => {
    setResolving(alertId)
    try {
      await fetch(`/api/agency/projects/${projectId}/status-updates`, {
        method: "PATCH", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updateId: alertId }),
      })
      refresh()
    } catch { /* silent */ }
    finally { setResolving(null) }
  }, [projectId, refresh])

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = q
      ? partners.filter(r => [partnerDisplayName(r), r.scopeItemName, currentProject?.clientName]
          .join(" ").toLowerCase().includes(q))
      : partners

    const map = new Map<string, PartnerRow[]>()
    for (const r of filtered) {
      const key = groupBy === "client"
        ? (currentProject?.clientName || "No Client").trim()
        : partnerDisplayName(r)
      const list = map.get(key) ?? []; list.push(r); map.set(key, list)
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, rows]) => ({ label, rows }))
  }, [partners, groupBy, search, currentProject])

  return (
    <div className="p-8 max-w-6xl space-y-6">
      {/* Project selector */}
      <InlineProjectSelector
        selectedProject={selectedProject}
        projects={projects}
        isLoadingProjects={isLoadingProjects}
        onSelect={p => { setSelectedProject(p); setActiveRow(null) }}
        label="Active Engagements"
      />

      {!selectedProject && !isLoadingProjects && (
        <div className="rounded-xl border border-border/40 bg-white/5 p-12 text-center">
          <p className="text-foreground-muted">Select a project above to view its active engagements.</p>
        </div>
      )}

      {selectedProject && (
        <>
          {/* Summary bar */}
          <SummaryBar partners={partners} project={currentProject} loading={engLoading} />

          {/* Controls: search + group-by */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground-muted" />
              <Input placeholder="Search client, partner, or scope…" value={search} onChange={e => setSearch(e.target.value)}
                className="pl-9 h-9 bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50 text-sm" />
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider">Group by</span>
              <div className="flex rounded-lg overflow-hidden border border-border">
                {(["client", "partner"] as GroupBy[]).map(g => (
                  <button key={g} type="button" onClick={() => setGroupBy(g)}
                    className={cn("px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider transition-colors",
                      groupBy === g ? "bg-accent text-accent-foreground" : "bg-white/5 text-foreground-muted hover:bg-white/10")}>
                    {g === "client" ? "Client" : "Partner Agency"}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Groups */}
          {engLoading && (
            <div className="flex items-center gap-2 text-foreground-muted py-8">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="font-mono text-sm">Loading partner data…</span>
            </div>
          )}
          {!engLoading && partners.length === 0 && (
            <div className="rounded-xl border border-border/40 bg-white/5 p-10 text-center">
              <p className="text-foreground-muted text-sm">No awarded partners for this project yet.</p>
            </div>
          )}
          {!engLoading && groups.length === 0 && partners.length > 0 && (
            <p className="text-sm text-foreground-muted text-center py-4">No results match your search.</p>
          )}
          {!engLoading && groups.length > 0 && (
            <div className="space-y-4">
              {groups.map((g, i) => (
                <GroupSection
                  key={g.label} label={g.label} rows={g.rows}
                  defaultOpen={i === 0} onRowClick={setActiveRow}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Slide-over panel */}
      {activeRow && projectId && (
        <SlideOverPanel
          row={activeRow}
          projectId={projectId}
          resolving={resolving}
          onResolve={handleResolve}
          onRefresh={refresh}
          onClose={() => setActiveRow(null)}
        />
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
