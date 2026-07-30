"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { AgencyLayout } from "@/components/agency-layout"
import { useSelectedProject } from "@/contexts/selected-project-context"
import { cn, formatRelativeTime } from "@/lib/utils"
import { isDemoMode, demoMasterProjects } from "@/lib/demo-data"
import { useFetch } from "@/hooks/useFetch"
import { useAgencyUsage, getUsageSeverity, type UsageSeverity } from "@/hooks/use-agency-usage"
import { useSectionCollapse, useCappedList } from "@/lib/dashboard-section-state"
import { DashboardShowMoreToggle } from "@/components/dashboard-show-more"
import { NewProjectDialog } from "@/components/new-project-dialog"
import {
  Search,
  AlertTriangle,
  Users,
  Send,
  Gavel,
  Trophy,
  ClipboardCheck,
  FileWarning,
  Plus,
  ChevronRight,
  ChevronDown,
  UserPlus,
  FolderOpen,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command"

// ── Types (mirrors the GET /api/agency/dashboard response) ──────────────────────

type AttentionBidsRow = { projectId: string; projectName: string; count: number; href: string }
type AttentionRfpRow = {
  projectId: string
  projectName: string
  scopeItemName: string
  deadline: string
  invited: number
  pending: number
  href: string
}
type AttentionDeliveryRow = { projectId: string; projectName: string; count: number; href: string }
type AttentionAlertRow = { projectId: string; projectName: string; count: number; href: string }

type DashboardData = {
  attention: {
    bidsAwaitingReview: AttentionBidsRow[]
    rfpsClosingSoon: AttentionRfpRow[]
    pendingDeliveryEvaluations: AttentionDeliveryRow[]
    alerts: AttentionAlertRow[]
    isBrandNew: boolean
  }
  funnel: {
    activePartners: number
    openRfps: number
    bidsReceivedThisMonth: number
    awardedThisQuarter: number
    committedPartnerSpend: number
    totalClientBudget: number
  }
  projects: {
    id: string
    name: string
    client: string | null
    status: string
    stage: "active_engagements" | "bid_management" | "rfp_broadcast" | "setup"
    stageLabel: string
    committedSpend: number
    lastActivityAt: string
  }[]
  activity: { id: string; text: string; href: string; timestamp: string }[]
}

const STAGE_STYLES: Record<string, { color: string; bg: string }> = {
  active_engagements: { color: "text-emerald-300", bg: "bg-emerald-500/15 border-emerald-500/35" },
  bid_management: { color: "text-violet-300", bg: "bg-violet-500/15 border-violet-500/35" },
  rfp_broadcast: { color: "text-sky-300", bg: "bg-sky-500/15 border-sky-500/35" },
  setup: { color: "text-slate-300", bg: "bg-slate-500/15 border-slate-500/35" },
}

const RECENT_PROJECTS_PREVIEW_COUNT = 5
const SECTION_LIST_CAP = 5
const URGENT_DAYS_THRESHOLD = 3

function formatUsdWhole(amount: number): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(amount)
  } catch {
    return `$${Math.round(amount).toLocaleString()}`
  }
}

function formatDeadlineRelative(iso: string): string {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return "soon"
  const days = Math.ceil((t - Date.now()) / (24 * 60 * 60 * 1000))
  if (days <= 0) return "today"
  if (days === 1) return "in 1 day"
  return `in ${days} days`
}

// ── Project search (Cmd+K palette + inline trigger) ──────────────────────────────

function ProjectSearch({
  open,
  onOpenChange,
  projects,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projects: { id: string; name: string; client: string }[]
}) {
  const router = useRouter()

  const handleSelect = (id: string) => {
    onOpenChange(false)
    router.push(`/agency/projects/${id}`)
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Search projects" description="Jump to a project by name or client">
      <CommandInput placeholder="Search projects or clients..." />
      <CommandList>
        <CommandEmpty>No projects found.</CommandEmpty>
        <CommandGroup heading="Projects">
          {projects.map((p) => (
            <CommandItem
              key={p.id}
              value={`${p.name} ${p.client}`}
              onSelect={() => handleSelect(p.id)}
              className="flex items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <div className="text-foreground truncate">{p.name}</div>
                <div className="text-xs text-foreground-muted truncate">{p.client || "Client TBD"}</div>
              </div>
              <ChevronRight className="w-3.5 h-3.5 text-foreground-muted shrink-0" />
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}

// ── Attention queue ───────────────────────────────────────────────────────────

type AttentionRow = { key: string; icon: typeof AlertTriangle; text: string; timeframe?: string; href: string; urgent: boolean }

function AttentionQueue({ data }: { data: DashboardData["attention"] }) {
  const { collapsed, toggle } = useSectionCollapse("agency", "needs-attention")
  const rows: AttentionRow[] = []

  for (const r of data.bidsAwaitingReview) {
    rows.push({
      key: `bids:${r.projectId}`,
      icon: Gavel,
      text: `${r.count} bid${r.count === 1 ? "" : "s"} awaiting review on ${r.projectName}`,
      href: r.href,
      urgent: false,
    })
  }
  for (const r of data.rfpsClosingSoon) {
    const daysLeft = Math.ceil((new Date(r.deadline).getTime() - Date.now()) / (24 * 60 * 60 * 1000))
    rows.push({
      key: `rfp:${r.projectId}:${r.scopeItemName}`,
      icon: Send,
      text: `RFP for ${r.scopeItemName} on ${r.projectName} - ${r.pending} of ${r.invited} partner${r.invited === 1 ? "" : "s"} ${r.pending === 1 ? "hasn't" : "haven't"} responded`,
      timeframe: `closes ${formatDeadlineRelative(r.deadline)}`,
      href: r.href,
      urgent: Number.isFinite(daysLeft) && daysLeft <= URGENT_DAYS_THRESHOLD,
    })
  }
  for (const r of data.pendingDeliveryEvaluations) {
    rows.push({
      key: `delivery:${r.projectId}`,
      icon: ClipboardCheck,
      text: `${r.count} delivery evaluation${r.count === 1 ? "" : "s"} pending on ${r.projectName}`,
      href: r.href,
      urgent: false,
    })
  }
  for (const r of data.alerts) {
    rows.push({
      key: `alert:${r.projectId}`,
      icon: FileWarning,
      text: `${r.count} partner update${r.count === 1 ? "" : "s"} ${r.count === 1 ? "needs" : "need"} attention on ${r.projectName}`,
      href: r.href,
      urgent: false,
    })
  }

  const { visible, hasMore, expanded, toggle: toggleShowAll, total } = useCappedList(
    rows,
    SECTION_LIST_CAP,
    (r) => r.urgent
  )

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <button type="button" onClick={toggle} className="flex items-center gap-1.5 group">
          <ChevronDown
            className={cn("w-3.5 h-3.5 text-foreground-muted transition-transform", collapsed && "-rotate-90")}
          />
          <h2 className="font-mono text-[11px] uppercase tracking-wider text-foreground-muted group-hover:text-foreground transition-colors">
            Needs your attention{!data.isBrandNew ? ` (${rows.length})` : ""}
          </h2>
        </button>
      </div>
      {!collapsed && (
        <div className="glass rounded-xl divide-y divide-border/50 overflow-hidden">
          {data.isBrandNew ? (
            <>
              <NewProjectDialog
                trigger={
                  <button
                    type="button"
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/5 transition-colors"
                  >
                    <Plus className="w-4 h-4 text-accent shrink-0" />
                    <span className="flex-1 text-sm text-foreground">Create your first project</span>
                    <ChevronRight className="w-4 h-4 text-foreground-muted shrink-0" />
                  </button>
                }
              />
              <Link href="/agency/pool" className="flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors">
                <UserPlus className="w-4 h-4 text-accent shrink-0" />
                <span className="flex-1 text-sm text-foreground">Invite partners to your pool</span>
                <ChevronRight className="w-4 h-4 text-foreground-muted shrink-0" />
              </Link>
            </>
          ) : rows.length === 0 ? (
            <div className="px-4 py-3 text-sm text-foreground-muted">You're all caught up.</div>
          ) : (
            <>
              {visible.map((row) => {
                const Icon = row.icon
                return (
                  <Link
                    key={row.key}
                    href={row.href}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors"
                  >
                    <Icon className="w-4 h-4 text-amber-400 shrink-0" />
                    <span className="flex-1 text-sm text-foreground min-w-0 truncate">{row.text}</span>
                    {row.timeframe && (
                      <span className="font-mono text-[10px] uppercase tracking-wider text-foreground-muted shrink-0">
                        {row.timeframe}
                      </span>
                    )}
                    <ChevronRight className="w-4 h-4 text-foreground-muted shrink-0" />
                  </Link>
                )
              })}
              {hasMore && (
                <div className="px-4 py-2.5">
                  <DashboardShowMoreToggle
                    hasMore={hasMore}
                    expanded={expanded}
                    total={total}
                    onToggle={toggleShowAll}
                    className="text-accent"
                  />
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── Funnel metrics ────────────────────────────────────────────────────────────

function FunnelMetrics({ funnel }: { funnel: DashboardData["funnel"] }) {
  const stats: { label: string; value: number; href: string; icon: typeof Users }[] = [
    { label: "Active Partners", value: funnel.activePartners, href: "/agency/pool", icon: Users },
    { label: "Open RFPs", value: funnel.openRfps, href: "/agency/bids", icon: Send },
    { label: "Bids Received (Month)", value: funnel.bidsReceivedThisMonth, href: "/agency/bids", icon: Gavel },
    { label: "Awarded (Quarter)", value: funnel.awardedThisQuarter, href: "/agency/bids", icon: Trophy },
  ]

  const spendPct =
    funnel.totalClientBudget > 0 ? Math.min(100, Math.round((funnel.committedPartnerSpend / funnel.totalClientBudget) * 100)) : 0

  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {stats.map((stat) => {
          const Icon = stat.icon
          return (
            <Link key={stat.label} href={stat.href} className="glass rounded-xl p-4 hover:bg-white/10 transition-colors">
              <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center mb-3">
                <Icon className="w-4 h-4 text-accent" />
              </div>
              <div className="font-display font-bold text-2xl text-foreground">{stat.value}</div>
              <div className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider mt-1">{stat.label}</div>
            </Link>
          )
        })}
      </div>
      <div className="glass rounded-xl p-4 mt-3">
        <div className="flex items-center justify-between mb-2 text-sm">
          <span className="text-foreground-muted">
            Committed partner spend{" "}
            <span className="text-foreground font-medium">{formatUsdWhole(funnel.committedPartnerSpend)}</span> of{" "}
            <span className="text-foreground font-medium">{formatUsdWhole(funnel.totalClientBudget)}</span> client budget
          </span>
        </div>
        <Progress value={spendPct} className="h-1.5" />
      </div>
    </div>
  )
}

// ── Usage card ────────────────────────────────────────────────────────────────

function indicatorClass(severity: UsageSeverity): string {
  if (severity === "blocked") return "[&>[data-slot=progress-indicator]]:bg-red-500"
  if (severity === "warning") return "[&>[data-slot=progress-indicator]]:bg-amber-500"
  return "[&>[data-slot=progress-indicator]]:bg-emerald-500"
}

function UsageCard() {
  const { usage, isLoading } = useAgencyUsage()

  return (
    <Link href="/agency/usage" className="glass rounded-xl p-4 flex flex-col justify-between hover:bg-white/10 transition-colors">
      <div className="flex items-center justify-between mb-3">
        <span className="font-mono text-[10px] uppercase tracking-wider text-foreground-muted">
          {isLoading || !usage ? "Plan" : `${usage.tier.charAt(0).toUpperCase()}${usage.tier.slice(1)} plan`}
        </span>
        <ChevronRight className="w-3.5 h-3.5 text-foreground-muted" />
      </div>
      {isLoading || !usage ? (
        <Skeleton className="h-8 w-full bg-white/10" />
      ) : usage.tier === "enterprise" ? (
        <div className="text-sm text-foreground">Unlimited</div>
      ) : (
        <div className="space-y-3">
          <div>
            <div className="flex items-center justify-between text-[11px] mb-1">
              <span className="text-foreground-muted">AI analyses</span>
              <span className="text-foreground-muted">
                {usage.analyses.count} / {usage.analyses.limit ?? "∞"}
              </span>
            </div>
            <Progress
              value={usage.analyses.percentage}
              className={cn("h-1.5", indicatorClass(getUsageSeverity(usage.analyses.limit, usage.analyses.percentage)))}
            />
          </div>
          <div>
            <div className="flex items-center justify-between text-[11px] mb-1">
              <span className="text-foreground-muted">Projects</span>
              <span className="text-foreground-muted">
                {usage.projects.count} / {usage.projects.limit ?? "∞"}
              </span>
            </div>
            <Progress
              value={usage.projects.percentage}
              className={cn("h-1.5", indicatorClass(getUsageSeverity(usage.projects.limit, usage.projects.percentage)))}
            />
          </div>
        </div>
      )}
    </Link>
  )
}

// ── Activity feed ─────────────────────────────────────────────────────────────

function ActivityFeed({ items }: { items: DashboardData["activity"] }) {
  const { collapsed, toggle } = useSectionCollapse("agency", "recent-activity")
  const { visible, hasMore, expanded, toggle: toggleShowAll, total } = useCappedList(items, SECTION_LIST_CAP)

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <button type="button" onClick={toggle} className="flex items-center gap-1.5 group">
          <ChevronDown
            className={cn("w-3.5 h-3.5 text-foreground-muted transition-transform", collapsed && "-rotate-90")}
          />
          <h2 className="font-mono text-[11px] uppercase tracking-wider text-foreground-muted group-hover:text-foreground transition-colors">
            Recent activity ({items.length})
          </h2>
        </button>
      </div>
      {!collapsed && (
        <div className="glass rounded-xl divide-y divide-border/50 overflow-hidden">
          {items.length === 0 ? (
            <div className="px-4 py-3 text-sm text-foreground-muted">No activity yet.</div>
          ) : (
            <>
              {visible.map((item) => (
                <Link key={item.id} href={item.href} className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 transition-colors">
                  <span className="flex-1 text-sm text-foreground min-w-0 truncate">{item.text}</span>
                  <span className="font-mono text-[10px] text-foreground-muted shrink-0">{formatRelativeTime(item.timestamp)}</span>
                </Link>
              ))}
              {hasMore && (
                <div className="px-4 py-2.5">
                  <DashboardShowMoreToggle
                    hasMore={hasMore}
                    expanded={expanded}
                    total={total}
                    onToggle={toggleShowAll}
                    className="text-accent"
                  />
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── Recent projects (slim) ────────────────────────────────────────────────────

function RecentProjectsList({ projects }: { projects: DashboardData["projects"] }) {
  const [showAll, setShowAll] = useState(false)
  const visible = showAll ? projects : projects.slice(0, RECENT_PROJECTS_PREVIEW_COUNT)

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-mono text-[11px] uppercase tracking-wider text-foreground-muted">Recent projects</h2>
        {projects.length > RECENT_PROJECTS_PREVIEW_COUNT && (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="text-xs text-accent hover:underline"
          >
            {showAll ? "Show less" : "View all projects"}
          </button>
        )}
      </div>
      <div className="glass rounded-xl divide-y divide-border/50 overflow-hidden">
        {visible.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <FolderOpen className="w-6 h-6 text-foreground-muted mx-auto mb-2" />
            <p className="text-sm text-foreground-muted">No projects yet.</p>
          </div>
        ) : (
          visible.map((p) => {
            const stageStyle = STAGE_STYLES[p.stage] ?? STAGE_STYLES.setup
            return (
              <Link
                key={p.id}
                href={`/agency/projects/${p.id}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground truncate">{p.name}</span>
                    <span
                      className={cn(
                        "font-mono text-[9px] px-2 py-0.5 rounded-full border uppercase tracking-wider shrink-0",
                        stageStyle.bg,
                        stageStyle.color
                      )}
                    >
                      {p.stageLabel}
                    </span>
                  </div>
                  <div className="text-xs text-foreground-muted truncate">{p.client || "Client TBD"}</div>
                </div>
                {p.committedSpend > 0 && (
                  <span className="font-mono text-xs text-foreground-muted shrink-0">{formatUsdWhole(p.committedSpend)}</span>
                )}
                <span className="font-mono text-[10px] text-foreground-muted shrink-0 w-16 text-right">
                  {formatRelativeTime(p.lastActivityAt)}
                </span>
                <ChevronRight className="w-4 h-4 text-foreground-muted shrink-0" />
              </Link>
            )
          })
        )}
      </div>
    </div>
  )
}

// ── Demo mode - no fetch happens (useFetch is passed an empty URL), so this builds a
// synthetic DashboardData from lib/demo-data.ts's static fixtures instead of hitting the
// API. Demo data has no real timestamps, so lastActivityAt/activity fall back to "now" /
// empty rather than fabricating history.
function buildDemoDashboardData(): DashboardData {
  const nowIso = new Date().toISOString()
  return {
    attention: { bidsAwaitingReview: [], rfpsClosingSoon: [], pendingDeliveryEvaluations: [], alerts: [], isBrandNew: false },
    funnel: {
      activePartners: demoMasterProjects.reduce((sum, p) => sum + p.partnerCount, 0),
      openRfps: demoMasterProjects.reduce((sum, p) => sum + p.activeRfps, 0),
      bidsReceivedThisMonth: demoMasterProjects.reduce((sum, p) => sum + p.pendingBids, 0),
      awardedThisQuarter: demoMasterProjects.filter((p) => p.workflowStageKey === "active_engagements").length,
      committedPartnerSpend: demoMasterProjects.reduce((sum, p) => sum + p.spent, 0),
      totalClientBudget: demoMasterProjects.reduce((sum, p) => sum + p.budget, 0),
    },
    projects: demoMasterProjects.map((p) => ({
      id: p.id,
      name: p.name,
      client: p.client,
      status: p.status,
      stage: p.workflowStageKey,
      stageLabel: p.workflowStageLabel,
      committedSpend: p.spent,
      lastActivityAt: nowIso,
    })),
    activity: [],
  }
}

// ── Skeletons ─────────────────────────────────────────────────────────────────

function DashboardSkeleton() {
  return (
    <div className="space-y-8">
      <Skeleton className="h-20 w-full bg-white/10 rounded-xl" />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full bg-white/10 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-40 w-full bg-white/10 rounded-xl" />
      <Skeleton className="h-64 w-full bg-white/10 rounded-xl" />
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

function DashboardContent() {
  const { projects: contextProjects } = useSelectedProject()
  const isDemo = isDemoMode()

  const { data, isLoading } = useFetch<DashboardData>(isDemo ? "" : "/api/agency/dashboard")

  const [searchOpen, setSearchOpen] = useState(false)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setSearchOpen((v) => !v)
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [])

  const searchableProjects = useMemo(
    () => contextProjects.map((p) => ({ id: p.id, name: p.name, client: p.client })),
    [contextProjects]
  )

  const newProjectDialog = (
    <NewProjectDialog
      trigger={
        <Button className="bg-accent text-accent-foreground hover:bg-accent/90 font-mono">
          <Plus className="w-4 h-4 mr-2" />
          New Project
        </Button>
      }
    />
  )

  return (
    <div className="p-4 sm:p-8 max-w-7xl">
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 justify-between mb-8">
        <div>
          <h1 className="font-display font-black text-3xl sm:text-4xl text-foreground tracking-tight">Dashboard</h1>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 border border-border text-foreground-muted hover:bg-white/10 transition-colors sm:w-64"
          >
            <Search className="w-4 h-4 shrink-0" />
            <span className="text-sm flex-1 text-left">Search projects...</span>
            <kbd className="hidden sm:inline font-mono text-[10px] px-1.5 py-0.5 rounded border border-border/70 text-foreground-muted/70">
              ⌘K
            </kbd>
          </button>
          {newProjectDialog}
        </div>
      </div>

      <ProjectSearch open={searchOpen} onOpenChange={setSearchOpen} projects={searchableProjects} />

      {(() => {
        const dashboardData = isDemo ? buildDemoDashboardData() : data
        if (!isDemo && (isLoading || !dashboardData)) return <DashboardSkeleton />
        if (!dashboardData) return <DashboardSkeleton />
        return (
          <div className="space-y-8">
            <AttentionQueue data={dashboardData.attention} />

            <div className="grid grid-cols-1 lg:grid-cols-[1fr_14rem] gap-3 items-start">
              <FunnelMetrics funnel={dashboardData.funnel} />
              <UsageCard />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <ActivityFeed items={dashboardData.activity} />
              <RecentProjectsList projects={dashboardData.projects} />
            </div>
          </div>
        )
      })()}
    </div>
  )
}

export default function AgencyDashboardPage() {
  return (
    <AgencyLayout>
      <DashboardContent />
    </AgencyLayout>
  )
}
