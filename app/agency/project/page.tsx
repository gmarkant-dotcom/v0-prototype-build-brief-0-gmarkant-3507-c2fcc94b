"use client"

import { useState, useMemo } from "react"
import Link from "next/link"
import { AgencyLayout } from "@/components/agency-layout"
import { useFetch } from "@/hooks/useFetch"
import { cn } from "@/lib/utils"
import { Search, Filter, ChevronDown, ChevronRight, AlertTriangle, Building2, Users } from "lucide-react"
import { Input } from "@/components/ui/input"

// ── Types ────────────────────────────────────────────────────────────────────

type PartnerRow = {
  assignmentId: string
  awardedResponseId?: string | null
  budgetProposal?: string
  partner: { companyName: string | null; fullName: string | null }
  alert_count?: number
  completion_pct?: number
  current_status?: string | null
}

type ProjectRow = {
  id: string
  title: string
  clientName: string | null
  budgetRange: string | null
  startDate: string | null
  endDate: string | null
  status: string | null
  dashboardWorkflowStage: string | null
  dashboardWorkflowLabel: string | null
  partners: PartnerRow[]
}

type ClientGroup = {
  clientName: string
  projects: ProjectRow[]
}

// ── Constants ────────────────────────────────────────────────────────────────

const WORKFLOW_STAGE_STYLES: Record<string, { bg: string; color: string }> = {
  rfp_broadcast:      { bg: "bg-violet-500/15", color: "text-violet-300" },
  bid_management:     { bg: "bg-sky-500/15",    color: "text-sky-300" },
  onboarding:         { bg: "bg-amber-500/15",  color: "text-amber-300" },
  active_engagements: { bg: "bg-emerald-500/15",color: "text-emerald-300" },
  cashflow:           { bg: "bg-cyan-500/15",   color: "text-cyan-300" },
  completed:          { bg: "bg-white/10",      color: "text-foreground-muted" },
  setup:              { bg: "bg-white/10",      color: "text-foreground-muted" },
}

const STATUS_FILTERS = ["all", "active", "onboarding", "completed", "on_hold"] as const
type StatusFilter = (typeof STATUS_FILTERS)[number]

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDateRange(start: string | null, end: string | null): string {
  const fmt = (d: string) =>
    new Date(d).toLocaleDateString("en-US", { month: "short", year: "numeric" })
  if (start && end) return `${fmt(start)} – ${fmt(end)}`
  if (start) return `From ${fmt(start)}`
  if (end) return `Until ${fmt(end)}`
  return "—"
}

function stageLabel(project: ProjectRow): string {
  if (project.dashboardWorkflowLabel) return project.dashboardWorkflowLabel
  const s = (project.status || "").toLowerCase()
  if (s === "active") return "Production"
  if (s === "completed") return "Closed"
  return "Setup"
}

function parseBudgetNumber(raw: string | null): number {
  if (!raw) return 0
  const n = Number(String(raw).replace(/[^0-9.]/g, ""))
  return isNaN(n) ? 0 : n
}

function formatBudgetK(n: number): string {
  if (n === 0) return "$0K"
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`
  return `$${Math.round(n / 1000)}K`
}

function avgCompletion(partners: PartnerRow[]): number {
  if (!partners.length) return 0
  const total = partners.reduce((s, p) => s + (p.completion_pct ?? 0), 0)
  return Math.round(total / partners.length)
}

function totalAlerts(partners: PartnerRow[]): number {
  return partners.reduce((s, p) => s + (p.alert_count ?? 0), 0)
}

function uniquePartnerCount(partners: PartnerRow[]): number {
  return new Set(partners.map(p => p.assignmentId)).size
}

// ── Sub-components ───────────────────────────────────────────────────────────

function ProgressBar({ pct, status }: { pct: number; status: string | null }) {
  const color =
    status === "completed" ? "bg-green-500" :
    status === "on_hold"   ? "bg-yellow-500" :
    "bg-accent"
  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-1">
        <span className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider">Progress</span>
        <span className="font-mono text-xs text-accent">{pct}%</span>
      </div>
      <div className="h-2 bg-white/10 rounded-full overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function ProjectCard({ project }: { project: ProjectRow }) {
  const wfKey = (project.dashboardWorkflowStage || "setup") as string
  const wfStyle = WORKFLOW_STAGE_STYLES[wfKey] ?? WORKFLOW_STAGE_STYLES.setup
  const wfLabel = stageLabel(project)
  const budget = parseBudgetNumber(project.budgetRange)
  const progress = avgCompletion(project.partners)
  const alerts = totalAlerts(project.partners)
  const partnerCount = uniquePartnerCount(project.partners)
  const dateRange = formatDateRange(project.startDate, project.endDate)

  return (
    <Link
      href={`/agency/projects/${project.id}`}
      className="block bg-white/5 border border-border/50 rounded-xl p-6 hover:bg-white/10 hover:border-border transition-all group"
    >
      <div className="flex items-start gap-4">
        <div className="flex-1 min-w-0">
          {/* Name + badges */}
          <div className="flex items-center gap-3 mb-2 flex-wrap">
            <h3 className="font-display font-bold text-lg text-foreground truncate">
              {project.title}
            </h3>
            <span className={cn(
              "font-mono text-[9px] px-2 py-0.5 rounded-full border uppercase tracking-wider shrink-0",
              wfStyle.bg, wfStyle.color
            )}>
              {wfLabel}
            </span>
            {alerts > 0 && (
              <span className="flex items-center gap-1 font-mono text-[9px] px-2 py-0.5 rounded-full border border-amber-500/40 bg-amber-500/15 text-amber-200 shrink-0">
                <AlertTriangle className="w-3 h-3 text-amber-300" />
                {alerts} Alert{alerts > 1 ? "s" : ""}
              </span>
            )}
          </div>

          {/* Meta row */}
          <div className="flex items-center gap-3 text-sm text-foreground-muted mb-4 flex-wrap">
            {project.clientName && <span>{project.clientName}</span>}
            {project.clientName && <span className="text-foreground-muted/40">|</span>}
            <span>{dateRange}</span>
            <span className="text-foreground-muted/40">|</span>
            <span className="text-foreground-muted/70">Stage: {wfLabel}</span>
          </div>

          {/* Progress */}
          <ProgressBar pct={progress} status={project.status} />

          {/* Stats */}
          <div className="flex items-center gap-6">
            <div>
              <div className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider">Budget</div>
              <div className="font-display font-bold text-lg text-foreground">
                {budget > 0 ? formatBudgetK(budget) : project.budgetRange || "—"}
              </div>
            </div>
            <div>
              <div className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider">Spent</div>
              <div className="font-display font-bold text-lg text-foreground">$0K</div>
            </div>
            <div>
              <div className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider">Partners</div>
              <div className="font-display font-bold text-lg text-foreground">{partnerCount}</div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-white/5 group-hover:bg-accent/20 transition-colors shrink-0 mt-1">
          <ChevronRight className="w-5 h-5 text-foreground-muted group-hover:text-accent transition-colors" />
        </div>
      </div>
    </Link>
  )
}

function ClientSection({ group, defaultOpen }: { group: ClientGroup; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const totalBudget = group.projects.reduce((s, p) => s + parseBudgetNumber(p.budgetRange), 0)
  const count = group.projects.length

  return (
    <div className="rounded-xl border border-border/40 bg-white/[0.02] overflow-hidden">
      {/* Client header */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-4 p-5 hover:bg-white/5 transition-colors text-left"
      >
        <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center shrink-0">
          <Building2 className="w-5 h-5 text-foreground-muted" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-display font-bold text-xl text-foreground">{group.clientName}</div>
          <div className="flex items-center gap-3 mt-0.5 font-mono text-[11px] text-foreground-muted">
            <span className="flex items-center gap-1">
              <Users className="w-3 h-3" />
              {count} engagement{count !== 1 ? "s" : ""}
            </span>
            {totalBudget > 0 && (
              <>
                <span className="text-foreground-muted/40">·</span>
                <span>{formatBudgetK(totalBudget)} total budget</span>
              </>
            )}
          </div>
        </div>
        <div className={cn("transition-transform shrink-0", open && "rotate-180")}>
          <ChevronDown className="w-5 h-5 text-foreground-muted" />
        </div>
      </button>

      {/* Engagement list */}
      {open && (
        <div className="border-t border-border/30 p-4 space-y-3">
          {group.projects.map(p => (
            <ProjectCard key={p.id} project={p} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function ActiveEngagementsPage() {
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")

  const { data, isLoading, error } = useFetch<{ projects: ProjectRow[] }>(
    "/api/agency/active-engagements"
  )

  const clientGroups = useMemo<ClientGroup[]>(() => {
    const projects = data?.projects ?? []
    const q = search.trim().toLowerCase()

    const filtered = projects.filter(p => {
      if (statusFilter !== "all" && p.status !== statusFilter) return false
      if (q) {
        const hay = [p.title, p.clientName].join(" ").toLowerCase()
        return hay.includes(q)
      }
      return true
    })

    // Group by clientName
    const map = new Map<string, ProjectRow[]>()
    for (const p of filtered) {
      const key = (p.clientName || "").trim() || "No Client"
      const list = map.get(key) ?? []
      list.push(p)
      map.set(key, list)
    }

    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([clientName, ps]) => ({
        clientName,
        projects: ps.sort((a, b) => a.title.localeCompare(b.title)),
      }))
  }, [data, search, statusFilter])

  const totalEngagements = clientGroups.reduce((s, g) => s + g.projects.length, 0)

  return (
    <AgencyLayout>
      <div className="p-8 max-w-5xl space-y-6">
        {/* Header */}
        <div>
          <h1 className="font-display font-bold text-3xl text-foreground">Active Engagements</h1>
          <p className="text-foreground-muted mt-1">
            {isLoading ? "Loading…" : `${totalEngagements} engagement${totalEngagements !== 1 ? "s" : ""} across ${clientGroups.length} client${clientGroups.length !== 1 ? "s" : ""}`}
          </p>
        </div>

        {/* Search + filter */}
        <div className="flex items-center gap-4 flex-wrap">
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground-muted" />
            <Input
              placeholder="Search projects or clients..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-10 bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50"
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-foreground-muted" />
            <div className="flex gap-1 flex-wrap">
              {STATUS_FILTERS.map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatusFilter(s)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg font-mono text-[10px] uppercase tracking-wider transition-colors",
                    statusFilter === s
                      ? "bg-accent text-accent-foreground"
                      : "bg-white/5 text-foreground-muted hover:bg-white/10"
                  )}
                >
                  {s === "all" ? "All" : s.replace("_", " ")}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Content */}
        {isLoading && (
          <div className="text-foreground-muted font-mono text-sm py-12 text-center">Loading engagements…</div>
        )}
        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
            Failed to load engagements. Please refresh.
          </div>
        )}
        {!isLoading && !error && clientGroups.length === 0 && (
          <div className="rounded-xl border border-border/40 bg-white/5 p-12 text-center">
            <div className="font-display font-bold text-lg text-foreground mb-2">No engagements found</div>
            <p className="text-sm text-foreground-muted">
              {search || statusFilter !== "all"
                ? "Try adjusting your search or filter."
                : "Awarded bids will appear here once a project has active partners."}
            </p>
          </div>
        )}
        {!isLoading && clientGroups.length > 0 && (
          <div className="space-y-4">
            {clientGroups.map((group, i) => (
              <ClientSection
                key={group.clientName}
                group={group}
                defaultOpen={i === 0}
              />
            ))}
          </div>
        )}
      </div>
    </AgencyLayout>
  )
}
