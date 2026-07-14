"use client"

import { useState, useMemo, useCallback } from "react"
import Link from "next/link"
import { AgencyLayout } from "@/components/agency-layout"
import { useFetch } from "@/hooks/useFetch"
import { cn } from "@/lib/utils"
import {
  Search, Filter, ChevronDown, ChevronRight,
  Building2, Users, AlertTriangle, Clock, CheckCircle, XCircle,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { formatBudgetForDisplay } from "@/lib/rfp-response-fields"

// ── Types ─────────────────────────────────────────────────────────────────────

type BidRow = {
  id: string
  response_id: string | null
  response_exists: boolean
  inbox_item_id: string
  partner_id?: string | null
  vendor_email?: string | null
  partner_display_name: string
  project_name: string | null
  client_name: string | null
  status: string
  budget_proposal?: string
  created_at: string
  updated_at: string
  inbox: {
    scope_item_name?: string | null
    response_deadline?: string | null
    project_id?: string | null
  } | null
  versions?: { budget?: string | null; budget_currency?: string | null }[]
}

// ── Status config ─────────────────────────────────────────────────────────────

const BID_STATUSES = [
  { key: "all",               label: "All RFPs" },
  { key: "awaiting_response", label: "New" },
  { key: "submitted",         label: "Submitted" },
  { key: "under_review",      label: "Changes Requested" },
  { key: "shortlisted",       label: "Shortlisted" },
  { key: "meeting_requested", label: "Meeting Requested" },
  { key: "awarded",           label: "Awarded" },
  { key: "declined",          label: "Declined" },
] as const

type BidStatusKey = (typeof BID_STATUSES)[number]["key"]

const STATUS_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  awaiting_response: { bg: "bg-white/10",      text: "text-foreground-muted", label: "New" },
  submitted:         { bg: "bg-sky-500/15",    text: "text-sky-300",          label: "Submitted" },
  under_review:      { bg: "bg-amber-500/15",  text: "text-amber-300",        label: "Changes Requested" },
  shortlisted:       { bg: "bg-violet-500/15", text: "text-violet-300",       label: "Shortlisted" },
  meeting_requested: { bg: "bg-cyan-500/15",   text: "text-cyan-300",         label: "Meeting Requested" },
  awarded:           { bg: "bg-emerald-500/15",text: "text-emerald-300",       label: "Awarded" },
  declined:          { bg: "bg-red-500/15",    text: "text-red-300",          label: "Declined" },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusBadge(status: string) {
  return STATUS_BADGE[status] ?? STATUS_BADGE.awaiting_response
}

function formatDeadline(raw: string | null | undefined): string | null {
  if (!raw) return null
  const d = new Date(raw)
  if (isNaN(d.getTime())) return null
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

function bestBudgetDisplay(row: BidRow): string | null {
  const v = row.versions?.[0]
  if (v?.budget && v.budget_currency) {
    const n = parseFloat(v.budget)
    if (!isNaN(n)) return `$${n.toLocaleString("en-US")} ${v.budget_currency}`
  }
  // No version history (e.g. guest bids never get a partner_rfp_response_versions row) —
  // fall back to the response's own budget_proposal column.
  if (row.budget_proposal) {
    const display = formatBudgetForDisplay(row.budget_proposal)
    return display === "—" ? null : display
  }
  return null
}

// ── Bid card ─────────────────────────────────────────────────────────────────

function BidCard({ row, groupBy }: { row: BidRow; groupBy: "client" | "partner" }) {
  const badge = statusBadge(row.status)
  const scope = row.inbox?.scope_item_name || row.project_name || "Scope"
  const deadline = formatDeadline(row.inbox?.response_deadline)
  const budget = bestBudgetDisplay(row)
  const projectId = row.inbox?.project_id

  return (
    <div className="flex items-start gap-4 p-4 rounded-lg border border-border/40 bg-white/5 hover:bg-white/8 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <span className="font-display font-bold text-foreground truncate">{scope}</span>
          <span className={cn(
            "font-mono text-[9px] px-2 py-0.5 rounded-full border uppercase tracking-wider shrink-0",
            badge.bg, badge.text
          )}>
            {badge.label}
          </span>
          {!row.partner_id && row.response_exists && (
            <span className="font-mono text-[9px] px-2 py-0.5 rounded-full border border-teal-400/40 bg-teal-500/10 text-teal-300 uppercase tracking-wider shrink-0">
              Guest Submission
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 font-mono text-[10px] text-foreground-muted flex-wrap">
          {groupBy === "client" && (
            <span className="flex items-center gap-1">
              <Users className="w-3 h-3" />
              {row.partner_display_name}
            </span>
          )}
          {groupBy === "partner" && row.client_name && (
            <span className="flex items-center gap-1">
              <Building2 className="w-3 h-3" />
              {row.client_name}
            </span>
          )}
          {row.project_name && (
            <>
              {(groupBy === "client" || row.client_name) && <span className="text-foreground-muted/40">·</span>}
              <span>{row.project_name}</span>
            </>
          )}
          {budget && (
            <>
              <span className="text-foreground-muted/40">·</span>
              <span className="text-accent">{budget}</span>
            </>
          )}
          {deadline && (
            <>
              <span className="text-foreground-muted/40">·</span>
              <Clock className="w-3 h-3" />
              <span>Due {deadline}</span>
            </>
          )}
        </div>
      </div>
      {projectId && (
        <Link
          href={`/agency/projects/${projectId}`}
          className="shrink-0 flex items-center gap-1 font-mono text-[10px] text-accent border border-accent/30 hover:bg-accent/10 rounded-md px-2 py-1 transition-colors"
        >
          View <ChevronRight className="w-3 h-3" />
        </Link>
      )}
    </div>
  )
}

// ── Group section ─────────────────────────────────────────────────────────────

function GroupSection({
  label, rows, defaultOpen, groupBy,
}: {
  label: string
  rows: BidRow[]
  defaultOpen: boolean
  groupBy: "client" | "partner"
}) {
  const [open, setOpen] = useState(defaultOpen)
  const [activeStatus, setActiveStatus] = useState<BidStatusKey>("all")

  const counts = useMemo(() => {
    const map: Record<string, number> = { all: rows.length }
    for (const r of rows) {
      map[r.status] = (map[r.status] || 0) + 1
    }
    return map
  }, [rows])

  const filtered = useMemo(
    () => activeStatus === "all" ? rows : rows.filter(r => r.status === activeStatus),
    [rows, activeStatus]
  )

  return (
    <div className="rounded-xl border border-border/40 bg-white/[0.02] overflow-hidden">
      {/* Group header */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-4 p-5 hover:bg-white/5 transition-colors text-left"
      >
        <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center shrink-0">
          {groupBy === "client"
            ? <Building2 className="w-5 h-5 text-foreground-muted" />
            : <Users className="w-5 h-5 text-foreground-muted" />
          }
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-display font-bold text-xl text-foreground">{label}</div>
          <div className="font-mono text-[11px] text-foreground-muted mt-0.5">
            {rows.length} RFP{rows.length !== 1 ? "s" : ""}
            {counts["awarded"] > 0 && (
              <span className="ml-2 text-emerald-400">· {counts["awarded"]} awarded</span>
            )}
          </div>
        </div>
        <div className={cn("transition-transform shrink-0", open && "rotate-180")}>
          <ChevronDown className="w-5 h-5 text-foreground-muted" />
        </div>
      </button>

      {open && (
        <div className="border-t border-border/30">
          {/* Status tabs */}
          <div className="flex gap-1 flex-wrap px-4 pt-3 pb-2 overflow-x-auto">
            {BID_STATUSES.map(({ key, label: tabLabel }) => {
              const count = counts[key] ?? 0
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setActiveStatus(key)}
                  className={cn(
                    "shrink-0 px-2.5 py-1 rounded-lg font-mono text-[10px] transition-colors whitespace-nowrap",
                    activeStatus === key
                      ? "bg-accent text-accent-foreground"
                      : "bg-white/5 text-foreground-muted hover:bg-white/10"
                  )}
                >
                  {tabLabel} ({key === "all" ? rows.length : count})
                </button>
              )
            })}
          </div>

          {/* Bid list */}
          <div className="px-4 pb-4 space-y-2">
            {filtered.length === 0 ? (
              <p className="text-sm text-foreground-muted py-4 text-center">No bids match this filter.</p>
            ) : (
              filtered.map(row => (
                <BidCard key={row.id} row={row} groupBy={groupBy} />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

type GroupBy = "client" | "partner"

export default function AgencyBidsPage() {
  const [search, setSearch] = useState("")
  const [groupBy, setGroupBy] = useState<GroupBy>("client")

  const { data, isLoading, error } = useFetch<{ responses: BidRow[] }>(
    "/api/agency/rfp-responses"
  )

  const groups = useMemo(() => {
    const all = data?.responses ?? []
    const q = search.trim().toLowerCase()

    const filtered = q
      ? all.filter(r => {
          const hay = [
            r.client_name,
            r.partner_display_name,
            r.project_name,
            r.inbox?.scope_item_name,
          ].join(" ").toLowerCase()
          return hay.includes(q)
        })
      : all

    const map = new Map<string, BidRow[]>()
    for (const r of filtered) {
      if (groupBy === "client" && !r.client_name?.trim()) {
        // Skip RFPs with no client name rather than grouping them under a visible
        // "No Client" label - missing client data is a data quality issue, not a
        // valid client group to show real users.
        continue
      }
      const key = groupBy === "client"
        ? r.client_name!.trim()
        : r.partner_display_name || "Unknown Partner"
      const list = map.get(key) ?? []
      list.push(r)
      map.set(key, list)
    }

    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, rows]) => ({ label, rows }))
  }, [data, search, groupBy])

  const totalRfps = data?.responses?.length ?? 0
  const totalGroups = groups.length

  return (
    <AgencyLayout>
      <div className="p-8 max-w-5xl space-y-6">
        {/* Header */}
        <div>
          <h1 className="font-display font-bold text-3xl text-foreground">Bid Management</h1>
          <p className="text-foreground-muted mt-1">
            {isLoading
              ? "Loading…"
              : `${totalRfps} RFP${totalRfps !== 1 ? "s" : ""} across ${totalGroups} ${groupBy === "client" ? "client" : "partner agency"}${totalGroups !== 1 ? "s" : ""}`
            }
          </p>
        </div>

        {/* Search + group-by toggle */}
        <div className="flex items-center gap-4 flex-wrap">
          <div className="relative flex-1 min-w-[240px] max-w-lg">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground-muted" />
            <Input
              placeholder="Search client, partner agency, or project…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-10 bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50"
            />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider">Group by</span>
            <div className="flex rounded-lg overflow-hidden border border-border">
              {(["client", "partner"] as GroupBy[]).map(g => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGroupBy(g)}
                  className={cn(
                    "px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider transition-colors",
                    groupBy === g
                      ? "bg-accent text-accent-foreground"
                      : "bg-white/5 text-foreground-muted hover:bg-white/10"
                  )}
                >
                  {g === "client" ? "Client" : "Partner Agency"}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Content */}
        {isLoading && (
          <div className="text-foreground-muted font-mono text-sm py-12 text-center">Loading bids…</div>
        )}
        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
            Failed to load bids. Please refresh.
          </div>
        )}
        {!isLoading && !error && groups.length === 0 && (
          <div className="rounded-xl border border-border/40 bg-white/5 p-12 text-center">
            <div className="font-display font-bold text-lg text-foreground mb-2">
              {search ? "No results" : "No bids yet"}
            </div>
            <p className="text-sm text-foreground-muted">
              {search ? "Try a different search term." : "Broadcast an RFP to start receiving bids."}
            </p>
          </div>
        )}
        {!isLoading && groups.length > 0 && (
          <div className="space-y-4">
            {groups.map((g, i) => (
              <GroupSection
                key={g.label}
                label={g.label}
                rows={g.rows}
                defaultOpen={i === 0}
                groupBy={groupBy}
              />
            ))}
          </div>
        )}
      </div>
    </AgencyLayout>
  )
}
