"use client"

import { useState, useMemo } from "react"
import Link from "next/link"
import { PartnerLayout } from "@/components/partner-layout"
import { useFetch } from "@/hooks/useFetch"
import { cn } from "@/lib/utils"
import { Search, Filter, ChevronDown, ChevronRight, Building2, Users } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

// ── Types ─────────────────────────────────────────────────────────────────────

type GroupBy = "agency" | "client"

type PartnerProject = {
  project_id: string
  project_name: string
  client_name: string | null
  budget_range: string | null
  start_date: string | null
  end_date: string | null
  status: string | null
  partnership_id: string
  agency_id: string | null
  agency_name: string
  assignment_id: string
  response_id: string | null
  budget_proposal: string | null
  scope_item_name: string | null
  awarded_at: string | null
}

type Group = {
  label: string
  groupId: string | null
  projects: PartnerProject[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDateRange(start: string | null | undefined, end: string | null | undefined): string {
  const fmt = (d: string) =>
    new Date(d).toLocaleDateString("en-US", { month: "short", year: "numeric" })
  if (start && end) return `${fmt(start)} – ${fmt(end)}`
  if (start) return `From ${fmt(start)}`
  if (end) return `Until ${fmt(end)}`
  return "—"
}

function parseBudgetNumber(raw: string | null | undefined): number {
  if (!raw) return 0
  const n = Number(String(raw).replace(/[^0-9.]/g, ""))
  return isNaN(n) ? 0 : n
}

function formatBudgetK(n: number): string {
  if (n === 0) return "$0K"
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`
  return `$${Math.round(n / 1000)}K`
}

function stageLabel(status: string | null | undefined): string {
  const s = (status || "").toLowerCase()
  if (s === "active" || s === "in_progress") return "Active"
  if (s === "onboarding") return "Onboarding"
  if (s === "completed") return "Completed"
  if (s === "on_hold") return "On Hold"
  return "In Progress"
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ProjectCard({ project }: { project: PartnerProject }) {
  const budget = parseBudgetNumber(project.budget_range)
  const dateRange = formatDateRange(project.start_date, project.end_date)
  const stage = stageLabel(project.status)
  const scopeName = project.scope_item_name || project.project_name

  return (
    <Link
      href={`/partner/projects/${project.project_id}`}
      className="block bg-white border border-gray-200 rounded-xl p-6 hover:border-[#0C3535]/40 hover:shadow-sm transition-all group"
    >
      <div className="flex items-start gap-4">
        <div className="flex-1 min-w-0">
          {/* Scope + status */}
          <div className="flex items-center gap-3 mb-2 flex-wrap">
            <h3 className="font-display font-bold text-lg text-[#0C3535] truncate">
              {scopeName}
            </h3>
            <span className="font-mono text-[9px] px-2 py-0.5 rounded-full border border-[#0C3535]/20 bg-[#0C3535]/10 text-[#0C3535] uppercase tracking-wider shrink-0">
              {stage}
            </span>
          </div>

          {/* Project + meta row */}
          <div className="flex items-center gap-3 text-sm text-gray-500 mb-4 flex-wrap">
            {project.project_name !== scopeName && (
              <>
                <span className="text-gray-600">{project.project_name}</span>
                <span className="text-gray-300">|</span>
              </>
            )}
            {project.client_name && (
              <>
                <span>Client: {project.client_name}</span>
                <span className="text-gray-300">|</span>
              </>
            )}
            <span>{dateRange}</span>
            <span className="text-gray-300">|</span>
            <span className="text-gray-400">Stage: {stage}</span>
          </div>

          {/* Progress */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-1">
              <span className="font-mono text-[10px] text-gray-400 uppercase tracking-wider">Progress</span>
              <span className="font-mono text-xs text-[#0C3535]">0%</span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-[#0C3535]/70 rounded-full" style={{ width: "0%" }} />
            </div>
          </div>

          {/* Stats */}
          <div className="flex items-center gap-6">
            <div>
              <div className="font-mono text-[10px] text-gray-400 uppercase tracking-wider">Budget</div>
              <div className="font-display font-bold text-lg text-[#0C3535]">
                {budget > 0 ? formatBudgetK(budget) : project.budget_range || "—"}
              </div>
            </div>
            <div>
              <div className="font-mono text-[10px] text-gray-400 uppercase tracking-wider">Earned</div>
              <div className="font-display font-bold text-lg text-[#0C3535]">$0K</div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-gray-50 group-hover:bg-[#0C3535]/10 transition-colors shrink-0 mt-1">
          <ChevronRight className="w-5 h-5 text-gray-400 group-hover:text-[#0C3535] transition-colors" />
        </div>
      </div>
    </Link>
  )
}

function GroupSection({ group, defaultOpen, groupBy }: { group: Group; defaultOpen: boolean; groupBy: GroupBy }) {
  const [open, setOpen] = useState(defaultOpen)
  const totalBudget = group.projects.reduce((s, p) => s + parseBudgetNumber(p.budget_range), 0)
  const count = group.projects.length

  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50/50 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-4 p-5 hover:bg-gray-100/60 transition-colors text-left"
      >
        <div className="w-10 h-10 rounded-lg bg-[#0C3535]/10 flex items-center justify-center shrink-0">
          <Building2 className="w-5 h-5 text-[#0C3535]" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-display font-bold text-xl text-[#0C3535]">{group.label}</div>
          <div className="flex items-center gap-3 mt-0.5 font-mono text-[11px] text-gray-500">
            <span className="flex items-center gap-1">
              <Users className="w-3 h-3" />
              {count} engagement{count !== 1 ? "s" : ""}
            </span>
            {totalBudget > 0 && (
              <>
                <span className="text-gray-300">·</span>
                <span>{formatBudgetK(totalBudget)} total budget</span>
              </>
            )}
          </div>
        </div>
        <div className={cn("transition-transform shrink-0", open && "rotate-180")}>
          <ChevronDown className="w-5 h-5 text-gray-400" />
        </div>
      </button>

      {open && (
        <div className="border-t border-gray-200 p-4 space-y-3 bg-white">
          {group.projects.map(p => (
            <ProjectCard key={`${p.project_id}-${p.response_id ?? p.assignment_id}`} project={p} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

const STATUS_FILTERS = ["all", "active", "onboarding", "completed", "on_hold"] as const
type StatusFilter = typeof STATUS_FILTERS[number]

export default function PartnerProjectsPage() {
  const [search, setSearch] = useState("")
  const [groupBy, setGroupBy] = useState<GroupBy>("agency")
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")

  const { data, isLoading, error } = useFetch<{ projects: PartnerProject[] }>(
    "/api/partner/projects"
  )

  const agencyGroups = useMemo<Group[]>(() => {
    const all = data?.projects ?? []
    const q = search.trim().toLowerCase()

    const filtered = all.filter(p => {
      if (statusFilter !== "all" && p.status !== statusFilter) return false
      if (q) {
        const hay = [p.project_name, p.scope_item_name, p.client_name, p.agency_name].join(" ").toLowerCase()
        return hay.includes(q)
      }
      return true
    })

    // Group by agency or client
    const map = new Map<string, { groupId: string | null; projects: PartnerProject[] }>()
    for (const p of filtered) {
      const key = groupBy === "client"
        ? ((p.client_name || "").trim() || "No Client")
        : (p.agency_name || "Lead Agency")
      const id = groupBy === "client" ? null : p.agency_id
      if (!map.has(key)) map.set(key, { groupId: id, projects: [] })
      map.get(key)!.projects.push(p)
    }

    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, val]) => ({ label, groupId: val.groupId, projects: val.projects }))
  }, [data, search, statusFilter])

  const totalEngagements = agencyGroups.reduce((s, g) => s + g.projects.length, 0)

  return (
    <PartnerLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="font-display font-bold text-3xl text-[#0C3535]">Active Projects</h1>
          <p className="text-gray-600 mt-1">
            {isLoading
              ? "Loading…"
              : `${totalEngagements} engagement${totalEngagements !== 1 ? "s" : ""} across ${agencyGroups.length} ${groupBy === "client" ? "client" : "agency partner"}${agencyGroups.length !== 1 ? "s" : ""}`
            }
          </p>
        </div>

        {/* Search + filter */}
        <div className="flex items-center gap-4 flex-wrap">
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Search projects, agencies, or clients..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-10 bg-white border-gray-200 text-gray-900 placeholder:text-gray-400"
            />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="font-mono text-[10px] text-gray-400 uppercase tracking-wider">Group by</span>
            <div className="flex rounded-lg overflow-hidden border border-gray-200">
              {(["agency", "client"] as GroupBy[]).map(g => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGroupBy(g)}
                  className={cn(
                    "px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider transition-colors",
                    groupBy === g
                      ? "bg-[#0C3535] text-white"
                      : "bg-white text-gray-500 hover:bg-gray-50"
                  )}
                >
                  {g === "agency" ? "Agency" : "Client"}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-gray-400" />
            <div className="flex gap-1 flex-wrap">
              {STATUS_FILTERS.map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatusFilter(s)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg font-mono text-[10px] uppercase tracking-wider transition-colors",
                    statusFilter === s
                      ? "bg-[#0C3535] text-white"
                      : "bg-white border border-gray-200 text-gray-500 hover:border-[#0C3535]/30"
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
          <div className="text-gray-500 font-mono text-sm py-12 text-center">Loading engagements…</div>
        )}
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            Failed to load projects. Please refresh.
          </div>
        )}
        {!isLoading && !error && agencyGroups.length === 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
            <div className="font-display font-bold text-xl text-[#0C3535] mb-2">No active projects</div>
            <p className="text-gray-600 mb-6">
              {search || statusFilter !== "all"
                ? "Try adjusting your search or filter."
                : "You don't have any project assignments yet. Check open RFPs for opportunities."}
            </p>
            {!search && statusFilter === "all" && (
              <Link href="/partner/rfps">
                <Button className="bg-[#0C3535] hover:bg-[#0C3535]/90 text-white">
                  View Open RFPs →
                </Button>
              </Link>
            )}
          </div>
        )}
        {!isLoading && agencyGroups.length > 0 && (
          <div className="space-y-4">
            {agencyGroups.map((group, i) => (
              <GroupSection key={group.label} group={group} defaultOpen={i === 0} groupBy={groupBy} />
            ))}
          </div>
        )}
      </div>
    </PartnerLayout>
  )
}
