"use client"

import { useState, useMemo, useCallback, useEffect } from "react"
import { mutate } from "swr"
import { AgencyLayout } from "@/components/agency-layout"
import { BidDetailSheet } from "@/components/bid-detail-sheet"
import { BidCompareView } from "@/components/bid-compare-view"
import { ScoringSettingsSheet } from "@/components/scoring-settings-sheet"
import { useFetch } from "@/hooks/useFetch"
import { cn, formatSubmittedAt } from "@/lib/utils"
import {
  type BidRow,
  BID_STATUSES,
  type BidStatusKey,
  statusBadge,
  formatDeadline,
  bestBudgetDisplay,
  scopeKeyForRow,
  buildRankedBlocks,
  sortRankedGroup,
} from "@/lib/bid-shared"
import { compositeScoreColorClass } from "@/lib/bid-scoring"
import { AiMarkdown } from "@/components/ai-markdown"
import {
  Search, Filter, ChevronDown, ChevronRight,
  Building2, Users, AlertTriangle, Clock, XCircle,
  MoreVertical, Sparkles, X, Settings,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

const RFP_RESPONSES_URL = "/api/agency/rfp-responses"

// ── AI summary strip ─────────────────────────────────────────────────────────

/** Generates (or regenerates) the AI summary for one bid, then patches the shared SWR
 *  cache directly (no revalidate round-trip) so every card/sheet showing this response
 *  picks up the fresh columns immediately instead of flashing back to "Generate". */
async function requestSummaryGeneration(responseId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(`/api/agency/bids/${responseId}/generate-summary`, { method: "POST" })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, error: data?.error || "Analysis unavailable" }
    void mutate(
      RFP_RESPONSES_URL,
      (current: { responses: BidRow[] } | undefined) =>
        current
          ? {
              responses: current.responses.map((r) =>
                r.id === responseId
                  ? {
                      ...r,
                      ai_summary_short: data.ai_summary_short ?? r.ai_summary_short,
                      ai_summary_detailed: data.ai_summary_detailed ?? r.ai_summary_detailed,
                      ai_summary_generated_at: data.ai_summary_generated_at ?? r.ai_summary_generated_at,
                    }
                  : r
              ),
            }
          : current,
      { revalidate: false }
    )
    return { ok: true }
  } catch {
    return { ok: false, error: "Analysis unavailable" }
  }
}

function BidSummaryStrip({
  row, generating, error, onGenerate,
}: {
  row: BidRow
  generating: boolean
  error: string | null
  onGenerate: () => void
}) {
  if (generating) {
    return (
      <div className="mt-2 space-y-1.5">
        <Skeleton className="h-3 w-full max-w-[420px] bg-white/10" />
        <Skeleton className="h-3 w-2/3 max-w-[280px] bg-white/10" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="mt-2 flex items-center gap-2 font-mono text-[10px] text-red-300">
        <span>{error}</span>
        <button type="button" onClick={(e) => { e.stopPropagation(); onGenerate() }} className="underline hover:text-red-200">
          Retry
        </button>
      </div>
    )
  }

  if (row.ai_summary_short) {
    return (
      <p className="mt-2 text-xs text-foreground/80 leading-relaxed flex items-start gap-1.5">
        <Sparkles className="w-3 h-3 text-accent shrink-0 mt-0.5" />
        <span>{row.ai_summary_short}</span>
      </p>
    )
  }

  return (
    <div className="mt-2 flex items-center gap-2">
      <Skeleton className="h-3 w-full max-w-[320px] bg-white/5" />
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onGenerate() }}
        className="shrink-0 font-mono text-[10px] text-accent hover:underline whitespace-nowrap"
      >
        Generate
      </button>
    </div>
  )
}

// ── Bid card ─────────────────────────────────────────────────────────────────

function BidCard({
  row, groupBy, onView, selected, onToggleSelect, rank,
}: {
  row: BidRow
  groupBy: "client" | "partner"
  onView: (row: BidRow) => void
  selected: boolean
  onToggleSelect: (id: string) => void
  rank?: number | null
}) {
  const [summaryGenerating, setSummaryGenerating] = useState(false)
  const [summaryError, setSummaryError] = useState<string | null>(null)

  const badge = statusBadge(row.status)
  const scope = row.inbox?.scope_item_name || row.project_name || "Scope"
  const deadline = formatDeadline(row.inbox?.response_deadline)
  const budget = bestBudgetDisplay(row)
  const submittedAt = formatSubmittedAt(row.submitted_at)
  const canSelect = row.response_exists && Boolean(row.response_id)

  const generateSummary = async () => {
    setSummaryGenerating(true)
    setSummaryError(null)
    const result = await requestSummaryGeneration(row.id)
    setSummaryGenerating(false)
    if (!result.ok) setSummaryError("Analysis unavailable - try again")
  }

  return (
    <div className="flex items-start gap-3 p-4 rounded-lg border border-border/40 bg-white/5 hover:bg-white/8 transition-colors">
      {canSelect && (
        <Checkbox
          checked={selected}
          onCheckedChange={() => onToggleSelect(row.id)}
          onClick={(e) => e.stopPropagation()}
          className="mt-1 shrink-0 border-border data-[state=checked]:bg-accent data-[state=checked]:border-accent"
          aria-label={`Select ${row.partner_display_name} bid for comparison`}
        />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          {rank != null && (
            <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded-full border border-accent/40 bg-accent/10 text-accent shrink-0">
              #{rank}
            </span>
          )}
          <span className="font-display font-bold text-foreground truncate">{scope}</span>
          <span className={cn(
            "font-mono text-[9px] px-2 py-0.5 rounded-full border uppercase tracking-wider shrink-0",
            badge.bg, badge.text
          )}>
            {badge.label}
          </span>
          {row.composite_score != null && (
            <span
              className={cn(
                "flex items-center justify-center w-6 h-6 rounded-full border font-mono text-[9px] font-bold shrink-0",
                compositeScoreColorClass(row.composite_score).bg,
                compositeScoreColorClass(row.composite_score).text,
                compositeScoreColorClass(row.composite_score).border
              )}
              title="Composite evaluation score"
            >
              {Math.round(row.composite_score)}
            </span>
          )}
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
        {submittedAt && (
          <div className="font-mono text-[10px] text-foreground-muted/70 mt-1">
            Submitted {submittedAt}
          </div>
        )}
        {row.response_exists && (
          <BidSummaryStrip
            row={row}
            generating={summaryGenerating}
            error={summaryError}
            onGenerate={() => void generateSummary()}
          />
        )}
      </div>
      <div className="shrink-0 flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => onView(row)}
          className="flex items-center gap-1 font-mono text-[10px] text-accent border border-accent/30 hover:bg-accent/10 rounded-md px-2 py-1 transition-colors"
        >
          View <ChevronRight className="w-3 h-3" />
        </button>
        {row.response_exists && row.ai_summary_short && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                onClick={(e) => e.stopPropagation()}
                className="p-1 rounded-md text-foreground-muted hover:bg-white/10 hover:text-foreground transition-colors"
                aria-label="Bid actions"
              >
                <MoreVertical className="w-3.5 h-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-background border-border">
              <DropdownMenuItem
                onClick={() => void generateSummary()}
                className="text-foreground focus:bg-white/5 focus:text-foreground"
              >
                Regenerate Summary
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  )
}

// ── Ranked group ──────────────────────────────────────────────────────────────

async function requestRanking(responseIds: string[], force: boolean): Promise<{ ok: true; narrative: string } | { ok: false; error: string }> {
  try {
    const res = await fetch("/api/agency/bids/rank", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ response_ids: responseIds, force }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, error: data?.error || "Analysis unavailable" }
    return { ok: true, narrative: data.narrative }
  } catch {
    return { ok: false, error: "Analysis unavailable" }
  }
}

function RankedGroup({
  rows, groupBy, onView, selectedIds, onToggleSelect,
}: {
  rows: BidRow[]
  groupBy: "client" | "partner"
  onView: (row: BidRow) => void
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
}) {
  const ranked = useMemo(() => sortRankedGroup(rows), [rows])
  const cachedNarrative = rows.map((r) => r.ranked_recommendation).find(Boolean) || null
  const [narrative, setNarrative] = useState<string | null>(cachedNarrative)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const responseIds = useMemo(() => ranked.filter((r) => r.rank != null).map((r) => r.row.id), [ranked])

  const generate = async (force: boolean) => {
    setGenerating(true)
    setError(null)
    const result = await requestRanking(responseIds, force)
    setGenerating(false)
    if (!result.ok) {
      setError("Analysis unavailable - try again")
      return
    }
    setNarrative(result.narrative)
    void mutate(RFP_RESPONSES_URL)
  }

  // Generate once, the first time this scope group reaches 2+ complete+scored bids
  // and no cached recommendation exists yet.
  useEffect(() => {
    if (!cachedNarrative && !generating) {
      void generate(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cachedNarrative])

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 px-1">
        <span className="font-mono text-[10px] uppercase tracking-wider text-accent">Ranked</span>
        <span className="text-foreground-muted/40">·</span>
        <span className="font-mono text-[10px] text-foreground-muted">
          {ranked.filter((r) => r.rank != null).length} scored
        </span>
      </div>

      {generating ? (
        <div className="rounded-lg border border-border/40 bg-white/5 p-3 space-y-1.5">
          <p className="text-xs text-foreground-muted">Analyzing bid...</p>
          <Skeleton className="h-3 w-full bg-white/10" />
          <Skeleton className="h-3 w-2/3 bg-white/10" />
        </div>
      ) : error ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 flex items-center gap-2 text-xs text-red-300">
          <span>{error}</span>
          <button type="button" onClick={() => void generate(true)} className="underline hover:text-red-200">
            Retry
          </button>
        </div>
      ) : narrative ? (
        <div className="rounded-lg border border-accent/30 bg-accent/5 p-3">
          <div className="font-mono text-[9px] uppercase text-foreground-muted mb-1 flex items-center gap-1.5">
            <Sparkles className="w-3 h-3 text-accent" /> Ranking Recommendation
          </div>
          <AiMarkdown content={narrative} />
          <button
            type="button"
            onClick={() => void generate(true)}
            className="mt-1.5 font-mono text-[10px] text-accent hover:underline"
          >
            Regenerate Rankings
          </button>
        </div>
      ) : null}

      {ranked.map(({ row, rank }) => (
        <BidCard
          key={row.id}
          row={row}
          groupBy={groupBy}
          onView={onView}
          selected={selectedIds.has(row.id)}
          onToggleSelect={onToggleSelect}
          rank={rank}
        />
      ))}
    </div>
  )
}

// ── Group section ─────────────────────────────────────────────────────────────

function GroupSection({
  label, rows, defaultOpen, groupBy, onView, selectedIds, onToggleSelect,
}: {
  label: string
  rows: BidRow[]
  defaultOpen: boolean
  groupBy: "client" | "partner"
  onView: (row: BidRow) => void
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
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
              buildRankedBlocks(filtered).map((block) =>
                block.type === "single" ? (
                  <BidCard
                    key={block.row.id}
                    row={block.row}
                    groupBy={groupBy}
                    onView={onView}
                    selected={selectedIds.has(block.row.id)}
                    onToggleSelect={onToggleSelect}
                  />
                ) : (
                  <RankedGroup
                    key={block.scopeKey}
                    rows={block.rows}
                    groupBy={groupBy}
                    onView={onView}
                    selectedIds={selectedIds}
                    onToggleSelect={onToggleSelect}
                  />
                )
              )
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
  const [viewingBid, setViewingBid] = useState<BidRow | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [compareRows, setCompareRows] = useState<BidRow[] | null>(null)
  const [scoringSettingsOpen, setScoringSettingsOpen] = useState(false)

  const { data, isLoading, error } = useFetch<{ responses: BidRow[] }>(RFP_RESPONSES_URL)

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const allRowsById = useMemo(
    () => new Map((data?.responses ?? []).map((r) => [r.id, r])),
    [data]
  )
  const selectedRows = useMemo(
    () => Array.from(selectedIds).map((id) => allRowsById.get(id)).filter((r): r is BidRow => Boolean(r)),
    [selectedIds, allRowsById]
  )
  const selectedScopeKeys = useMemo(
    () => new Set(selectedRows.map((r) => scopeKeyForRow(r))),
    [selectedRows]
  )
  const compareEligible =
    selectedRows.length >= 2 && selectedScopeKeys.size === 1 && !selectedScopeKeys.has(null)

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

    const map = new Map<string, { label: string; rows: BidRow[] }>()
    for (const r of filtered) {
      if (groupBy === "client" && !r.client_name?.trim()) {
        // Skip RFPs with no client name rather than grouping them under a visible
        // "No Client" label - missing client data is a data quality issue, not a
        // valid client group to show real users.
        continue
      }
      // Group by partner_id when present, not partner_display_name: a guest/magic-link bid
      // from a known partner carries whatever name the agency typed into the invite, which
      // can differ from that partner's other bids and would otherwise split them into a
      // separate group. partner_id is the stable identity; display_name is cosmetic only.
      const key = groupBy === "client" ? r.client_name!.trim() : r.partner_id || r.partner_display_name || "Unknown Partner"
      const label = groupBy === "client" ? r.client_name!.trim() : r.partner_display_name || "Unknown Partner"
      const existing = map.get(key)
      if (existing) {
        existing.rows.push(r)
      } else {
        map.set(key, { label, rows: [r] })
      }
    }

    return Array.from(map.values())
      .sort((a, b) => a.label.localeCompare(b.label))
      .map(({ label, rows }) => ({ label, rows }))
  }, [data, search, groupBy])

  const totalRfps = data?.responses?.length ?? 0
  const totalGroups = groups.length

  if (compareRows) {
    return (
      <AgencyLayout>
        <BidCompareView initialRows={compareRows} onBack={() => setCompareRows(null)} />
      </AgencyLayout>
    )
  }

  return (
    <AgencyLayout>
      <div className="p-8 max-w-5xl space-y-6 pb-24">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-display font-bold text-3xl text-foreground">Bid Management</h1>
            <p className="text-foreground-muted mt-1">
              {isLoading
                ? "Loading…"
                : `${totalRfps} RFP${totalRfps !== 1 ? "s" : ""} across ${totalGroups} ${groupBy === "client" ? "client" : "partner agency"}${totalGroups !== 1 ? "s" : ""}`
              }
            </p>
          </div>
          <button
            type="button"
            onClick={() => setScoringSettingsOpen(true)}
            className="shrink-0 p-2 rounded-md text-foreground-muted hover:bg-white/10 hover:text-foreground transition-colors"
            aria-label="Scoring settings"
            title="Scoring settings"
          >
            <Settings className="w-5 h-5" />
          </button>
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
                onView={setViewingBid}
                selectedIds={selectedIds}
                onToggleSelect={toggleSelect}
              />
            ))}
          </div>
        )}
      </div>
      <BidDetailSheet row={viewingBid} onClose={() => setViewingBid(null)} />
      <ScoringSettingsSheet open={scoringSettingsOpen} onOpenChange={setScoringSettingsOpen} />

      {selectedRows.length >= 2 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 rounded-full border border-border bg-background/95 backdrop-blur px-5 py-3 shadow-2xl">
          <span className="font-mono text-xs text-foreground-muted">
            {selectedRows.length} bid{selectedRows.length !== 1 ? "s" : ""} selected
          </span>
          {compareEligible ? (
            <Button
              size="sm"
              className="bg-accent text-accent-foreground hover:bg-accent/90"
              onClick={() => setCompareRows(selectedRows)}
            >
              Compare {selectedRows.length} Bids
            </Button>
          ) : (
            <span className="font-mono text-[10px] text-amber-300 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" />
              Select bids from the same RFP to compare
            </span>
          )}
          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            className="text-foreground-muted hover:text-foreground transition-colors"
            aria-label="Clear selection"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </AgencyLayout>
  )
}
