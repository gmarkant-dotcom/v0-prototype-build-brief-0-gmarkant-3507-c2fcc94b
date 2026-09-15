"use client"

import { useState, useMemo, useCallback, useEffect, Suspense } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { mutate } from "swr"
import { AgencyLayout } from "@/components/agency-layout"
import { BidDetailSheet } from "@/components/bid-detail-sheet"
import { BidCompareView } from "@/components/bid-compare-view"
import { ScoringSettingsSheet } from "@/components/scoring-settings-sheet"
import { useFetch } from "@/hooks/useFetch"
import { useUsageLimitModal } from "@/contexts/usage-limit-modal-context"
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
  requestRanking,
  termsSummaryLine,
} from "@/lib/bid-shared"
import { compositeScoreColorClass } from "@/lib/bid-scoring"
import type { RfpClosureUnit } from "@/lib/rfp-closure"
import { HelpTerm } from "@/components/help-term"
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
async function requestSummaryGeneration(
  responseId: string
): Promise<{ ok: true } | { ok: false; error: string; status: number; data: unknown }> {
  try {
    const res = await fetch(`/api/agency/bids/${responseId}/generate-summary`, { method: "POST" })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, error: data?.error || "Analysis unavailable", status: res.status, data }
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
    return { ok: false, error: "Analysis unavailable", status: 0, data: null }
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
      <div className="mt-2 flex items-center gap-2 font-mono text-2xs text-red-300">
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
        className="shrink-0 font-mono text-2xs text-accent hover:underline whitespace-nowrap"
      >
        Generate
      </button>
    </div>
  )
}

// ── Bid card ─────────────────────────────────────────────────────────────────

function BidCard({
  row, groupBy, onView, selected, onToggleSelect, rank, onRequestClosure,
}: {
  row: BidRow
  groupBy: "client" | "partner"
  onView: (row: BidRow) => void
  selected: boolean
  onToggleSelect: (id: string) => void
  rank?: number | null
  onRequestClosure: (row: BidRow, unit: RfpClosureUnit) => void
}) {
  const [summaryGenerating, setSummaryGenerating] = useState(false)
  const [summaryError, setSummaryError] = useState<string | null>(null)
  const { guardAction, handleUsageLimitError } = useUsageLimitModal()

  const badge = statusBadge(row.status)
  const scope = row.inbox?.scope_item_name || row.project_name || "Scope"
  const deadline = formatDeadline(row.inbox?.response_deadline)
  const budget = bestBudgetDisplay(row)
  const submittedAt = formatSubmittedAt(row.submitted_at)
  const canSelect = row.response_exists && Boolean(row.response_id)
  /**
   * R7. WHICH ROWS OFFER A CLOSURE ACTION.
   *
   * Only a row with NO BID that is not already closed. `awaiting_response` is
   * the synthetic status /api/agency/rfp-responses mints for an inbox row with
   * no partner_rfp_responses row, so this is exactly "a vendor we asked who has
   * not answered" - which is exactly what a closure ends.
   *
   * A row carrying a bid never offers it. A submitted bid is not an unanswered
   * request; the agency decides those with award/decline on the bid itself, and
   * the route would refuse them anyway (RFP_CLOSABLE_STATUSES).
   */
  const canClose = !row.response_exists && row.status === "awaiting_response" && Boolean(row.inbox_item_id)

  const generateSummary = async () => {
    if (!guardAction("ai_analyses")) return
    setSummaryGenerating(true)
    setSummaryError(null)
    const result = await requestSummaryGeneration(row.id)
    setSummaryGenerating(false)
    if (!result.ok) {
      if (handleUsageLimitError(result.status, result.data)) return
      setSummaryError("Analysis unavailable - try again")
    }
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
            <span className="font-mono text-2xs font-bold px-1.5 py-0.5 rounded-full border border-accent/40 bg-accent/10 text-accent shrink-0">
              #{rank}
            </span>
          )}
          <span className="font-display font-bold text-foreground truncate">{scope}</span>
          <span className={cn(
            "font-mono text-2xs px-2 py-0.5 rounded-full border uppercase tracking-wider shrink-0",
            badge.bg, badge.text
          )}>
            {badge.label}
          </span>
          {row.composite_score != null && (
            <HelpTerm
              term="composite_score"
              theme="dark"
              className={cn(
                "flex items-center justify-center w-6 h-6 rounded-full border font-mono text-2xs font-bold shrink-0",
                compositeScoreColorClass(row.composite_score).bg,
                compositeScoreColorClass(row.composite_score).text,
                compositeScoreColorClass(row.composite_score).border
              )}
            >
              {Math.round(row.composite_score)}
            </HelpTerm>
          )}
          {!row.vendor_org_id && row.response_exists && (
            <span className="font-mono text-2xs px-2 py-0.5 rounded-full border border-teal-400/40 bg-teal-500/10 text-teal-300 uppercase tracking-wider shrink-0">
              Guest Submission
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 font-mono text-2xs text-foreground-muted flex-wrap">
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
          <div className="font-mono text-2xs text-foreground-muted/70 mt-1">
            Submitted {submittedAt}
          </div>
        )}
        {row.response_exists && (
          <div className="font-mono text-2xs text-foreground-muted/70 mt-1">
            {termsSummaryLine(row) || "No terms disclosed"}
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
        {row.status === "awarded" && row.inbox?.project_id && (
          <Link
            href={`/agency/project?projectId=${encodeURIComponent(row.inbox.project_id)}&responseId=${encodeURIComponent(row.id)}`}
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-1 font-mono text-2xs text-success border border-success/30 hover:bg-success/10 rounded-md px-2 py-1 transition-colors"
          >
            Review Delivery
          </Link>
        )}
        <button
          type="button"
          onClick={() => onView(row)}
          className="flex items-center gap-1 font-mono text-2xs text-accent border border-accent/30 hover:bg-accent/10 rounded-md px-2 py-1 transition-colors"
        >
          View <ChevronRight className="w-3 h-3" />
        </button>
        {((row.response_exists && row.ai_summary_short) || canClose) && (
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
            {/* bg-popover, not bg-card. This floats over page content with no
                overlay beneath it, and --card is 7% opaque. See CLAUDE.md. The
                Radix default here is already bg-background, which is opaque. */}
            <DropdownMenuContent align="end" className="bg-background border-border">
              {row.response_exists && row.ai_summary_short && (
                <DropdownMenuItem
                  onClick={() => void generateSummary()}
                  className="text-foreground focus:bg-white/5 focus:text-foreground"
                >
                  Regenerate Summary
                </DropdownMenuItem>
              )}
              {canClose && (
                <>
                  {/* THE VENDOR UNIT FIRST. It is the narrower of the two and the
                      one an agency reaches for more often: you are looking at one
                      vendor's row when you decide they are not the one. */}
                  <DropdownMenuItem
                    onClick={() => onRequestClosure(row, "vendor")}
                    className="text-foreground focus:bg-white/5 focus:text-foreground"
                  >
                    Mark not selected
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => onRequestClosure(row, "rfp")}
                    className="text-foreground focus:bg-white/5 focus:text-foreground"
                  >
                    Close this RFP for all vendors
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  )
}

// ── Ranked group ──────────────────────────────────────────────────────────────

function RankedGroup({
  rows, groupBy, onView, selectedIds, onToggleSelect, onRequestClosure,
}: {
  rows: BidRow[]
  groupBy: "client" | "partner"
  onView: (row: BidRow) => void
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
  // THREADED THROUGH EVEN THOUGH A RANKED GROUP IS MOSTLY SCORED BIDS.
  // buildRankedBlocks puts EVERY row sharing a scope key into the block once two
  // of them are scored and complete - including the awaiting-response rows. So a
  // vendor who never bid can and does appear inside a ranked group, and dropping
  // the callback here would silently remove their closure action.
  onRequestClosure: (row: BidRow, unit: RfpClosureUnit) => void
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
        <span className="font-mono text-2xs uppercase tracking-wider text-accent">Ranked</span>
        <span className="text-foreground-muted/40">·</span>
        <span className="font-mono text-2xs text-foreground-muted">
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
          <div className="font-mono text-2xs uppercase text-foreground-muted mb-1 flex items-center gap-1.5">
            <Sparkles className="w-3 h-3 text-accent" /> Ranking Recommendation
          </div>
          <AiMarkdown content={narrative} />
          <button
            type="button"
            onClick={() => void generate(true)}
            className="mt-1.5 font-mono text-2xs text-accent hover:underline"
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
          onRequestClosure={onRequestClosure}
        />
      ))}
    </div>
  )
}

// ── Group section ─────────────────────────────────────────────────────────────

function GroupSection({
  label, rows, defaultOpen, groupBy, onView, selectedIds, onToggleSelect, onRequestClosure,
}: {
  label: string
  rows: BidRow[]
  defaultOpen: boolean
  groupBy: "client" | "partner"
  onView: (row: BidRow) => void
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
  onRequestClosure: (row: BidRow, unit: RfpClosureUnit) => void
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
          <div className="font-mono text-2xs text-foreground-muted mt-0.5">
            {rows.length} RFP{rows.length !== 1 ? "s" : ""}
            {counts["awarded"] > 0 && (
              <span className="ml-2 text-success">· {counts["awarded"]} awarded</span>
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
                    "shrink-0 px-2.5 py-1 rounded-lg font-mono text-2xs transition-colors whitespace-nowrap",
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
                    onRequestClosure={onRequestClosure}
                  />
                ) : (
                  <RankedGroup
                    key={block.scopeKey}
                    rows={block.rows}
                    groupBy={groupBy}
                    onView={onView}
                    selectedIds={selectedIds}
                    onToggleSelect={onToggleSelect}
                    onRequestClosure={onRequestClosure}
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

/**
 * THE DEEP LINK FROM THE NOTIFICATION BELL, AND WHY IT CARRIES NO AUTHORIZATION OF ITS OWN.
 *
 * `?response=<partner_rfp_responses.id>` opens that bid's detail sheet. It is what makes
 * "April Partner Test Agency updated their bid on X" reach that bid instead of a list of every
 * bid. The id comes off `notifications.data.responseId`, which `notifyBidSubmitted` has been
 * writing since migration 095 turned the type on.
 *
 * >>> THE IDENTIFIER IS A CLAIM, NOT A GRANT, AND NOTHING HERE TREATS IT AS ONE. <<<
 *
 * There is no fetch by id and no new endpoint. The parameter is matched against `data.responses`
 * - the list this page already holds, from GET /api/agency/rfp-responses, which resolves
 * `resolveCallerOrgIds(user.id, supabase)` and filters `.in("lead_org_id", callerOrgIds)` on
 * every one of its reads (app/api/agency/rfp-responses/route.ts:25, :91, :123, :210). A
 * response id belonging to another company is not in that array, so it matches nothing and
 * opens nothing. Hand-editing the URL therefore reaches exactly as far as it did before this
 * parameter existed, which is nowhere.
 *
 * It is matched on `response_exists && response_id`, NOT on `row.id`. `row.id` is the response
 * id for a real bid but the synthetic string `inbox-<uuid>` for an inbox row with no response
 * yet (route.ts:451), and those synthetic ids are not what any notification carries.
 *
 * WHAT A FAILED MATCH SHOWS, DECIDED HERE RATHER THAN LEFT TO THE IMPLEMENTATION (brief 1d):
 *
 *   - NOT a silent redirect to the dashboard. That teaches nothing and reads as a broken app.
 *   - NOT an error that names the record. "Bid 4f3a... was not found" confirms to anyone
 *     editing the URL that some ids exist and others do not, which is an existence oracle
 *     over another company's data.
 *   - INSTEAD: the page renders normally, and one dismissible notice sits above the list. The
 *     wording is IDENTICAL for "withdrawn", "deleted" and "belongs to another company",
 *     because the page genuinely cannot tell them apart and must not appear to. The user lands
 *     where they expected, with an explanation, and everything else on the page still works.
 */
function AgencyBidsPageInner() {
  const [search, setSearch] = useState("")
  const [groupBy, setGroupBy] = useState<GroupBy>("client")
  const [viewingBid, setViewingBid] = useState<BidRow | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [compareRows, setCompareRows] = useState<BidRow[] | null>(null)
  const [scoringSettingsOpen, setScoringSettingsOpen] = useState(false)
  // R7. The pending closure, held here rather than in the card, so the
  // confirmation survives the dropdown closing and so the fetch happens once at
  // the page level where the SWR key lives.
  const [closurePrompt, setClosurePrompt] = useState<{ row: BidRow; unit: RfpClosureUnit } | null>(null)
  const [closureSubmitting, setClosureSubmitting] = useState(false)
  const [closureError, setClosureError] = useState<string | null>(null)

  const { data, isLoading, error } = useFetch<{ responses: BidRow[] }>(RFP_RESPONSES_URL)

  /**
   * THE NOTIFICATION BELL'S DEEP LINK. Read the header above this component first.
   *
   * DERIVED, NOT STORED, AND THERE IS NO EFFECT. The obvious shape is an effect that finds the
   * row and calls setViewingBid, and it is the wrong one twice over: this repository's ESLint
   * config errors on `setState` inside an effect (cascading renders), and an effect needs a
   * "consumed" flag to stop the URL reopening the sheet the moment it is closed. Both
   * disappear if the open sheet is a function of the URL rather than a copy of it.
   *
   * WHAT IS DISMISSED IS AN ID, NOT A BOOLEAN. Clicking a second notification for a different
   * bid is a client navigation between two search strings on the SAME route, so this component
   * does not remount. A boolean would stay dismissed and the second bid would never open.
   */
  const searchParams = useSearchParams()
  const requestedResponseId = (searchParams.get("response") || "").trim()
  const [dismissedResponseId, setDismissedResponseId] = useState<string | null>(null)
  const deepLinkActive = requestedResponseId !== "" && dismissedResponseId !== requestedResponseId

  /**
   * NOT MEMOISED, DELIBERATELY. A `useMemo` here reports "Existing memoization could not be
   * preserved" under this repository's React Compiler lint rule, because `data?.responses` in
   * a dependency array is an optional-chain the compiler cannot match - and it buys nothing:
   * `find` returns an element of an array SWR already holds stable between revalidations, so
   * the identity downstream is unchanged either way, and the miss case returns a literal null.
   *
   * Matched on `response_id`, NOT `row.id`: `row.id` is the synthetic `inbox-<uuid>` for an
   * inbox row with no response yet (app/api/agency/rfp-responses/route.ts:451), and no
   * notification carries one of those.
   */
  const deepLinkRow =
    !deepLinkActive || isLoading || !data?.responses
      ? null
      : data.responses.find((r) => r.response_exists && r.response_id === requestedResponseId) ?? null

  /** "Not found" is claimed only once the list has arrived. The house rule about empty states
   *  during load applies to a banner exactly as it does to a list. */
  const deepLinkUnresolved = deepLinkActive && !isLoading && Boolean(data?.responses) && deepLinkRow === null
  const dismissDeepLink = () => setDismissedResponseId(requestedResponseId || null)

  /** The card click wins over the URL, and closing either one closes both. */
  const sheetRow = viewingBid ?? deepLinkRow

  const requestClosure = useCallback((row: BidRow, unit: RfpClosureUnit) => {
    setClosureError(null)
    setClosurePrompt({ row, unit })
  }, [])

  /**
   * R7. THE WRITE.
   *
   * Sends ONLY the inbox_item_id and the unit. The project and the scope item
   * that define "the whole RFP" are derived SERVER SIDE from the row the route
   * re-reads under the caller's own organization - see the security note in
   * app/api/agency/rfp-closure/route.ts. A client that could name the scope
   * directly could close a scope it does not own.
   */
  const confirmClosure = useCallback(async () => {
    if (!closurePrompt) return
    setClosureSubmitting(true)
    setClosureError(null)
    try {
      const res = await fetch("/api/agency/rfp-closure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inbox_item_id: closurePrompt.row.inbox_item_id,
          unit: closurePrompt.unit,
        }),
      })
      const payload = (await res.json().catch(() => ({}))) as { closed?: number; error?: string }
      if (!res.ok) {
        setClosureError(payload?.error || "Could not close this request. Please try again.")
        return
      }
      // A zero count is NOT an error and is not reported as one. It is what
      // idempotency looks like: somebody else closed it first, or every row was
      // already answered. The list refresh below shows the real state either way.
      setClosurePrompt(null)
      void mutate(RFP_RESPONSES_URL)
    } catch {
      setClosureError("Could not close this request. Please try again.")
    } finally {
      setClosureSubmitting(false)
    }
  }, [closurePrompt])

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
      // Group by vendor_org_id when present, not partner_display_name: a guest/magic-link bid
      // from a known partner carries whatever name the agency typed into the invite, which
      // can differ from that partner's other bids and would otherwise split them into a
      // separate group. vendor_org_id is the stable identity; display_name is cosmetic only.
      const key = groupBy === "client" ? r.client_name!.trim() : r.vendor_org_id || r.partner_display_name || "Unknown Vendor"
      const label = groupBy === "client" ? r.client_name!.trim() : r.partner_display_name || "Unknown Vendor"
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
        {/* 1d. THE SAME SENTENCE FOR WITHDRAWN, DELETED AND NOT-YOURS.
            This page cannot tell those apart - the id simply is not in the org-scoped array -
            and it must not appear to, because wording that distinguishes them is an existence
            oracle over another company's bids. It sits above the list rather than replacing
            it: the rest of the page is fine and the user is where they meant to be. */}
        {deepLinkUnresolved && (
          <div className="flex items-start justify-between gap-3 rounded-xl border border-border bg-white/5 px-4 py-3">
            <p className="text-sm text-foreground-muted">
              That bid could not be opened. It may have been withdrawn, or it may no longer be
              available to your company.
            </p>
            <button
              type="button"
              onClick={dismissDeepLink}
              className="shrink-0 text-foreground-muted hover:text-foreground transition-colors"
              aria-label="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-display font-bold text-3xl text-foreground">Bid Management</h1>
            <p className="text-foreground-muted mt-1">
              {isLoading
                ? "Loading…"
                : `${totalRfps} RFP${totalRfps !== 1 ? "s" : ""} across ${totalGroups} ${groupBy === "client" ? "client" : "vendor"}${totalGroups !== 1 ? "s" : ""}`
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
              placeholder="Search client, vendor, or project…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-10 bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50"
            />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="font-mono text-2xs text-foreground-muted uppercase tracking-wider">Group by</span>
            <div className="flex rounded-lg overflow-hidden border border-border">
              {(["client", "partner"] as GroupBy[]).map(g => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGroupBy(g)}
                  className={cn(
                    "px-3 py-1.5 font-mono text-2xs uppercase tracking-wider transition-colors",
                    groupBy === g
                      ? "bg-accent text-accent-foreground"
                      : "bg-white/5 text-foreground-muted hover:bg-white/10"
                  )}
                >
                  {g === "client" ? "Client" : "Vendor"}
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
                onRequestClosure={requestClosure}
              />
            ))}
          </div>
        )}
      </div>
      <BidDetailSheet
        row={sheetRow}
        onClose={() => {
          setViewingBid(null)
          dismissDeepLink()
        }}
      />
      <ScoringSettingsSheet open={scoringSettingsOpen} onOpenChange={setScoringSettingsOpen} />

      {/*
        R7 / 3e. THE CONFIRMATION.

        WHAT IT HAS TO NAME, and each of these is a separate consequence an
        agency can get wrong:
          1. WHO it reaches. "every vendor who has not bid" vs "this one vendor".
          2. WHAT IT DOES NOT TOUCH. A submitted bid is not an unanswered
             request and is left exactly where it is.
          3. THAT AN EMAIL GOES OUT. The vendor is told. That is the point of
             R7 - a request vanishing silently reads as a bug - and it is also
             the reason this cannot be taken back.
          4. >>> 3f. THAT THERE IS NO UNDO. Reopen is not built. An agency must
             know the action is final BEFORE they take it, not discover it
             afterwards by looking for a button that is not there.

        bg-card is correct HERE and only here: this modal sits on a
        bg-black/80 backdrop-blur-sm overlay, which is what makes a 7%-opaque
        surface read as solid. See CLAUDE.md.
      */}
      {closurePrompt && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          onClick={() => { if (!closureSubmitting) { setClosurePrompt(null); setClosureError(null) } }}
        >
          <div
            className="w-full max-w-lg bg-card border border-border rounded-xl p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-display font-bold text-xl text-foreground">
              {closurePrompt.unit === "rfp"
                ? "Close this RFP?"
                : `Tell ${closurePrompt.row.partner_display_name} they were not selected?`}
            </h2>

            <div className="mt-3 space-y-3 text-sm text-foreground-muted">
              {closurePrompt.unit === "rfp" ? (
                <>
                  <p>
                    This closes {closurePrompt.row.inbox?.scope_item_name || "this scope"} for every
                    vendor who has not bid. Each of them gets an email and a notification saying the
                    opportunity has ended, and the request moves out of their response queue into
                    their history.
                  </p>
                  <p>
                    Vendors who already submitted a bid are not affected. Their bids stay exactly
                    where they are and you can still award, shortlist or decline them.
                  </p>
                </>
              ) : (
                <>
                  <p>
                    This tells {closurePrompt.row.partner_display_name} they were not selected for{" "}
                    {closurePrompt.row.inbox?.scope_item_name || "this scope"}. They get an email and
                    a notification, and the request moves out of their response queue into their
                    history.
                  </p>
                  <p>
                    Every other vendor on this RFP stays open and can still bid.
                  </p>
                </>
              )}
              <p className="text-warning">
                This cannot be undone. There is no reopen, and the email cannot be unsent.
              </p>
            </div>

            {closureError && (
              <p className="mt-4 text-sm text-destructive">{closureError}</p>
            )}

            <div className="mt-6 flex items-center justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                disabled={closureSubmitting}
                onClick={() => { setClosurePrompt(null); setClosureError(null) }}
                className="border-border text-foreground"
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={closureSubmitting}
                onClick={() => void confirmClosure()}
                className="bg-accent text-accent-foreground hover:bg-accent/90"
              >
                {closureSubmitting
                  ? "Working..."
                  : closurePrompt.unit === "rfp"
                    ? "Close RFP"
                    : "Mark not selected"}
              </Button>
            </div>
          </div>
        </div>
      )}

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
            <span className="font-mono text-2xs text-amber-300 flex items-center gap-1.5">
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

/**
 * Suspense is required, not decorative: useSearchParams() opts the tree into client-side
 * rendering and Next fails the build without a boundary. Same shape as
 * app/agency/pool/page.tsx and components/partner-rfp-surface.tsx, which reached this the
 * same way.
 */
export default function AgencyBidsPage() {
  return (
    <Suspense fallback={null}>
      <AgencyBidsPageInner />
    </Suspense>
  )
}
