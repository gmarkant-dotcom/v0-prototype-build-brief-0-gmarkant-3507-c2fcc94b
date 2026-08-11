"use client"

import { useEffect, useMemo, useState } from "react"
import { mutate } from "swr"
import {
  type BidRow,
  bestBudgetDisplay,
  bestBudgetAmount,
  requestRanking,
  termsSummaryLine,
} from "@/lib/bid-shared"
import { compositeScoreColorClass } from "@/lib/bid-scoring"
import { formatTimelineForDisplay } from "@/lib/rfp-response-fields"
import {
  DESIGNATION_KEYS,
  INSURANCE_KEYS,
  DESIGNATION_LABELS,
  INSURANCE_LABELS,
  compareBusinessCriteria,
  normalizeBusinessCriteriaRequired,
  withBusinessCriteriaDefaults,
  normalizeAcknowledgments,
  computeRequirementCompliance,
  hasExplicitPriorityData,
} from "@/lib/business-criteria"
import { cn } from "@/lib/utils"
import { HelpTerm } from "@/components/help-term"
import { AiMarkdown } from "@/components/ai-markdown"
import { BidDetailSheet } from "@/components/bid-detail-sheet"
import { useUsageLimitModal } from "@/contexts/usage-limit-modal-context"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { BidBudgetComparison } from "@/components/bid-budget-comparison"
import { normalizeBudgetLines } from "@/lib/budget-categories"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { ChevronRight, Star, Sparkles, Loader2 } from "lucide-react"

const RFP_RESPONSES_URL = "/api/agency/rfp-responses"

type LineItem = { category: string; amount: number; percentage_of_total: number; description: string }

/**
 * Requirement-tier compliance matrix (S4-1) - renders nothing for any row whose RFP predates
 * tiers (hasTierData false), so old RFPs never show a fake pass/fail. Distinct from the
 * legacy "Business Criteria" row below, which is unchanged and shows the old presence-based
 * gap count for every RFP regardless of tiers.
 */
function rowRequirementCompliance(row: BidRow) {
  const required = normalizeBusinessCriteriaRequired(row.business_criteria_required)
  const responses = withBusinessCriteriaDefaults(row.business_criteria_responses)
  const acknowledgments = normalizeAcknowledgments(row.business_criteria_acknowledgments)
  return computeRequirementCompliance(required, responses, acknowledgments, {
    designations: DESIGNATION_LABELS,
    insurance: INSURANCE_LABELS,
  })
}

function businessCriteriaCounts(row: BidRow): { required: number; missing: number } {
  const responses = withBusinessCriteriaDefaults(row.business_criteria_responses)
  const required = normalizeBusinessCriteriaRequired(row.business_criteria_required)
  const gap = compareBusinessCriteria(required, responses)
  const requiredDesignationCount = DESIGNATION_KEYS.filter((key) => required.designations[key] === true).length
  const requiredInsuranceCount = INSURANCE_KEYS.filter((key) => required.insurance[key]?.required === true).length
  const requiredCount = requiredDesignationCount + requiredInsuranceCount + (required.insurance.coi_on_file ? 1 : 0)
  const missingCount = gap.missingDesignations.length + gap.missingInsurance.length + (gap.missingCoi ? 1 : 0)
  return { required: requiredCount, missing: missingCount }
}

export function BidCompareView({ initialRows, onBack }: { initialRows: BidRow[]; onBack: () => void }) {
  const [rows, setRows] = useState(initialRows)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [awardTarget, setAwardTarget] = useState<BidRow | null>(null)
  const [patchError, setPatchError] = useState<string | null>(null)

  const [decompositions, setDecompositions] = useState<Map<string, LineItem[]>>(new Map())
  const [checkingDecompositions, setCheckingDecompositions] = useState(true)
  const [analyzingIds, setAnalyzingIds] = useState<Set<string>>(new Set())
  const [decomposeError, setDecomposeError] = useState<string | null>(null)

  const [comparison, setComparison] = useState<{ narrative: string } | null>(null)
  const [comparing, setComparing] = useState(false)
  const [comparisonError, setComparisonError] = useState<string | null>(null)
  const [comparisonRequested, setComparisonRequested] = useState(false)

  const [generatingSummaryIds, setGeneratingSummaryIds] = useState<Set<string>>(new Set())

  const [evaluateQueue, setEvaluateQueue] = useState<BidRow[] | null>(null)
  const [evaluateIndex, setEvaluateIndex] = useState(0)

  const [rankingNarrative, setRankingNarrative] = useState<string | null>(null)
  const [rankingGenerating, setRankingGenerating] = useState(false)
  const [rankingError, setRankingError] = useState<string | null>(null)
  const [rankingRequested, setRankingRequested] = useState(false)
  const { guardAction, handleUsageLimitError } = useUsageLimitModal()

  const responseIds = useMemo(() => rows.map((r) => r.id), [rows])
  const maxBudget = useMemo(
    () => Math.max(0, ...rows.map((r) => bestBudgetAmount(r) ?? 0)),
    [rows]
  )

  // At a Glance renders instantly from already-loaded data; missing AI short summaries
  // are backfilled in parallel afterward without blocking the rest of the table.
  useEffect(() => {
    const missingSummaryIds = initialRows.filter((r) => !r.ai_summary_short).map((r) => r.id)
    if (missingSummaryIds.length === 0) return
    setGeneratingSummaryIds(new Set(missingSummaryIds))
    let cancelled = false
    Promise.all(
      missingSummaryIds.map(async (id) => {
        try {
          const res = await fetch(`/api/agency/bids/${id}/generate-summary`, { method: "POST" })
          const data = await res.json().catch(() => ({}))
          if (res.ok && !cancelled) {
            setRows((prev) =>
              prev.map((r) =>
                r.id === id
                  ? {
                      ...r,
                      ai_summary_short: data.ai_summary_short ?? r.ai_summary_short,
                      ai_summary_detailed: data.ai_summary_detailed ?? r.ai_summary_detailed,
                      ai_summary_generated_at: data.ai_summary_generated_at ?? r.ai_summary_generated_at,
                    }
                  : r
              )
            )
          }
        } catch {
          // Leave ai_summary_short null - the row falls back to "Not generated yet".
        } finally {
          if (!cancelled) {
            setGeneratingSummaryIds((prev) => {
              const next = new Set(prev)
              next.delete(id)
              return next
            })
          }
        }
      })
    ).then(() => {
      if (!cancelled) void mutate(RFP_RESPONSES_URL)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Check (not generate) which selected bids already have a decomposition on mount.
  useEffect(() => {
    let cancelled = false
    setCheckingDecompositions(true)
    Promise.all(
      responseIds.map(async (id) => {
        const res = await fetch(`/api/agency/bids/${id}/decompose`)
        if (res.status === 404) return [id, null] as const
        const data = await res.json().catch(() => null)
        return [id, res.ok && data ? (data.line_items as LineItem[]) : null] as const
      })
    ).then((results) => {
      if (cancelled) return
      const map = new Map<string, LineItem[]>()
      for (const [id, items] of results) {
        if (items) map.set(id, items)
      }
      setDecompositions(map)
      setCheckingDecompositions(false)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const missingIds = responseIds.filter((id) => !decompositions.has(id))
  const allDecompositionsReady = !checkingDecompositions && missingIds.length === 0

  const analyzeAllBids = async () => {
    if (!guardAction("ai_analyses")) return
    setDecomposeError(null)
    setAnalyzingIds(new Set(missingIds))
    await Promise.all(
      missingIds.map(async (id) => {
        try {
          const res = await fetch(`/api/agency/bids/${id}/decompose`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ force: false }),
          })
          const data = await res.json().catch(() => ({}))
          if (res.ok) {
            setDecompositions((prev) => new Map(prev).set(id, data.line_items || []))
          } else if (!handleUsageLimitError(res.status, data)) {
            setDecomposeError("Analysis unavailable - try again")
          }
        } catch {
          setDecomposeError("Analysis unavailable - try again")
        } finally {
          setAnalyzingIds((prev) => {
            const next = new Set(prev)
            next.delete(id)
            return next
          })
        }
      })
    )
  }

  const runComparison = async (force: boolean) => {
    // force=true only ever comes from a deliberate retry click, force=false is the
    // automatic run once every selected bid has a decomposition - same distinction as
    // bid-detail-sheet's generateAnalysis/loadDecomposition, and for the same reason: don't
    // pop the blocking modal from an effect the user didn't directly trigger.
    if (force && !guardAction("ai_analyses")) return
    setComparing(true)
    setComparisonError(null)
    setComparisonRequested(true)
    try {
      const res = await fetch("/api/agency/bids/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response_ids: responseIds, force }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (force && handleUsageLimitError(res.status, data)) return
        throw new Error(data?.error || "Analysis unavailable")
      }
      setComparison({ narrative: data.narrative })
    } catch {
      setComparisonError("Analysis unavailable - try again")
    } finally {
      setComparing(false)
    }
  }

  // Auto-run the AI narrative comparison once every selected bid has a decomposition.
  useEffect(() => {
    if (allDecompositionsReady && !comparisonRequested) {
      void runComparison(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allDecompositionsReady])

  const allScored = rows.every((r) => r.composite_score != null)

  const runRanking = async (force: boolean) => {
    setRankingGenerating(true)
    setRankingError(null)
    setRankingRequested(true)
    const result = await requestRanking(rows.map((r) => r.id), force)
    setRankingGenerating(false)
    if (!result.ok) {
      setRankingError("Analysis unavailable - try again")
      return
    }
    setRankingNarrative(result.narrative)
  }

  // Once every compared vendor has a composite score, show the ranking narrative
  // (cached server-side, so this is nearly instant on repeat views).
  useEffect(() => {
    if (allScored && !rankingRequested) {
      void runRanking(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allScored])

  const categoryUnion = useMemo(() => {
    const set = new Set<string>()
    for (const items of decompositions.values()) {
      for (const li of items) set.add(li.category)
    }
    return Array.from(set)
  }, [decompositions])

  const patchRow = async (row: BidRow, payload: Record<string, unknown>) => {
    setBusyId(row.id)
    setPatchError(null)
    try {
      const res = await fetch(`/api/agency/rfp-responses/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "Failed to update response")
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, ...(data.response || {}) } : r)))
      void mutate(RFP_RESPONSES_URL)
    } catch (e) {
      // Column-header actions are a quick-decision surface, but a failure must still be
      // visible - status stays unchanged in that case and the agency needs to know to retry.
      setPatchError(e instanceof Error ? e.message : "Failed to update response")
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="p-8 max-w-7xl space-y-6">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1 font-mono text-xs text-accent hover:underline"
      >
        <ChevronRight className="w-3.5 h-3.5 rotate-180" /> Back to Bids
      </button>

      <div>
        <h1 className="font-display font-bold text-2xl text-foreground">Compare Bids</h1>
        <p className="text-foreground-muted mt-1 text-sm">
          {rows.length} vendors for {rows[0]?.inbox?.scope_item_name || rows[0]?.project_name || "this scope"}
        </p>
      </div>

      {patchError && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          {patchError}
        </div>
      )}

      {/* At a Glance - existing data only, no AI, renders instantly */}
      <div className="rounded-xl border border-border/40 bg-white/[0.02] overflow-hidden">
        <div className="px-5 pt-5 pb-1 flex items-center justify-between gap-3 flex-wrap">
          <div className="font-mono text-2xs uppercase text-foreground-muted tracking-wider">At a Glance</div>
          {rows.filter((r) => r.composite_score == null).length >= 2 && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-2xs border-accent/40 bg-accent/10 text-accent hover:bg-accent/20"
              onClick={() => {
                const unscored = rows.filter((r) => r.composite_score == null)
                setEvaluateQueue(unscored)
                setEvaluateIndex(0)
              }}
            >
              Evaluate All
            </Button>
          )}
        </div>
        <div className="overflow-x-auto p-5 pt-3">
          <Table>
            <TableHeader>
              <TableRow className="border-border/40 hover:bg-transparent">
                <TableHead className="text-foreground-muted">Vendor</TableHead>
                {rows.map((row) => (
                  <TableHead key={row.id} className="text-foreground min-w-[220px]">
                    <div className="space-y-2">
                      <div className="font-display font-bold text-sm">{row.partner_display_name}</div>
                      <div className="flex items-center gap-1.5">
                        {/* H2: award now establishes the partnership rather than requiring one
                            to already exist, so guest/magic-link rows are no longer excluded
                            here (see the matching change in bid-detail-sheet.tsx). */}
                        <Button
                          size="sm"
                          className="h-6 px-2 text-2xs bg-success hover:bg-success/90 text-accent-foreground"
                          disabled={busyId === row.id || row.status === "awarded"}
                          onClick={() => setAwardTarget(row)}
                        >
                          Award
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className={cn(
                            "h-6 px-2 text-2xs",
                            row.status === "shortlisted" && "bg-blue-600 hover:bg-blue-600/90 text-white border-blue-400/40"
                          )}
                          disabled={busyId === row.id || row.status === "awarded"}
                          onClick={() =>
                            void patchRow(row, { status: row.status === "shortlisted" ? "under_review" : "shortlisted" })
                          }
                        >
                          <Star className="w-3 h-3 mr-1" /> Shortlist
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 px-2 text-2xs border-red-400/40 bg-red-900/30 text-red-100 hover:bg-red-900/45"
                          disabled={busyId === row.id || row.status === "awarded" || row.status === "declined"}
                          onClick={() => void patchRow(row, { status: "declined" })}
                        >
                          Decline
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 px-2 text-2xs border-border text-foreground hover:bg-white/5"
                          onClick={() => {
                            setEvaluateQueue([row])
                            setEvaluateIndex(0)
                          }}
                        >
                          Evaluate
                        </Button>
                      </div>
                    </div>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {/* S4-1 compliance matrix - before scoring, per spec. Renders only when at
                  least one row's RFP has explicit requirement-tier data; a mix of tiered and
                  pre-tier rows shows "-" for the pre-tier ones rather than omitting them. */}
              {rows.some((r) => hasExplicitPriorityData(normalizeBusinessCriteriaRequired(r.business_criteria_required))) && (
                <TableRow className="border-border/30">
                  <TableCell className="text-foreground-muted font-mono text-2xs uppercase">
                    Meets required
                  </TableCell>
                  {rows.map((row) => {
                    const compliance = rowRequirementCompliance(row)
                    if (!compliance.hasTierData) {
                      return (
                        <TableCell key={row.id} className="text-foreground-muted text-xs">-</TableCell>
                      )
                    }
                    if (compliance.requiredTotalCount === 0) {
                      return (
                        <TableCell key={row.id} className="text-foreground-muted text-xs">No required criteria</TableCell>
                      )
                    }
                    return (
                      <TableCell key={row.id} className="whitespace-normal">
                        <span className={cn("text-xs font-medium", compliance.meetsAllRequired ? "text-success" : "text-red-400")}>
                          {compliance.meetsAllRequired ? "Yes" : "No"}
                        </span>
                        <span className="text-foreground-muted text-2xs ml-1">
                          ({compliance.requiredConfirmedCount} of {compliance.requiredTotalCount})
                        </span>
                        {!compliance.meetsAllRequired && (
                          <ul className="mt-1 space-y-0.5">
                            {compliance.requiredItems
                              .filter((i) => !i.met)
                              .map((i) => (
                                <li key={i.key} className="text-2xs text-red-400/90">
                                  {i.label}
                                  {i.cannotMeetReason ? `: ${i.cannotMeetReason}` : ""}
                                </li>
                              ))}
                          </ul>
                        )}
                      </TableCell>
                    )
                  })}
                </TableRow>
              )}
              <TableRow className="border-border/30">
                <TableCell className="text-foreground-muted font-mono text-2xs uppercase">
                  <HelpTerm term="composite_score" theme="dark">Score</HelpTerm>
                </TableCell>
                {rows.map((row) => (
                  <TableCell key={row.id}>
                    {row.composite_score != null ? (
                      <span
                        className={cn(
                          "inline-flex items-center justify-center w-9 h-9 rounded-full border font-mono text-xs font-bold",
                          compositeScoreColorClass(row.composite_score).bg,
                          compositeScoreColorClass(row.composite_score).text,
                          compositeScoreColorClass(row.composite_score).border
                        )}
                      >
                        {Math.round(row.composite_score)}
                      </span>
                    ) : (
                      <span className="text-foreground-muted text-xs">Not scored</span>
                    )}
                  </TableCell>
                ))}
              </TableRow>
              <TableRow className="border-border/30">
                <TableCell className="text-foreground-muted font-mono text-2xs uppercase">Budget</TableCell>
                {rows.map((row) => {
                  const amount = bestBudgetAmount(row)
                  const pct = maxBudget > 0 && amount != null ? Math.max(4, Math.round((amount / maxBudget) * 100)) : 0
                  return (
                    <TableCell key={row.id} className="whitespace-normal">
                      <div className="text-sm text-foreground">{bestBudgetDisplay(row) || "Not provided"}</div>
                      {amount != null && (
                        <div className="mt-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                          <div className="h-full bg-accent rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                      )}
                    </TableCell>
                  )
                })}
              </TableRow>
              <TableRow className="border-border/30">
                <TableCell className="text-foreground-muted font-mono text-2xs uppercase">Timeline</TableCell>
                {rows.map((row) => (
                  <TableCell key={row.id} className="text-foreground whitespace-normal">
                    {row.timeline_proposal ? formatTimelineForDisplay(row.timeline_proposal) : "Not provided"}
                  </TableCell>
                ))}
              </TableRow>
              <TableRow className="border-border/30">
                <TableCell className="text-foreground-muted font-mono text-2xs uppercase">Terms</TableCell>
                {rows.map((row) => {
                  const summary = termsSummaryLine(row)
                  return (
                    <TableCell key={row.id} className="text-xs">
                      {summary ? (
                        <span className="text-foreground line-clamp-2" title={summary}>
                          {summary}
                        </span>
                      ) : (
                        <span className="text-foreground-muted">No terms disclosed</span>
                      )}
                    </TableCell>
                  )
                })}
              </TableRow>
              <TableRow className="border-border/30">
                <TableCell className="text-foreground-muted font-mono text-2xs uppercase">Business Criteria</TableCell>
                {rows.map((row) => {
                  const { required, missing } = businessCriteriaCounts(row)
                  return (
                    <TableCell key={row.id} className="whitespace-normal">
                      {required === 0 ? (
                        <span className="text-foreground-muted text-xs">None required</span>
                      ) : missing === 0 ? (
                        <span className="text-success text-xs">{required} of {required} met</span>
                      ) : (
                        <span className="text-amber-300 text-xs">{required - missing} of {required} met</span>
                      )}
                    </TableCell>
                  )
                })}
              </TableRow>
              <TableRow className="border-border/30">
                <TableCell className="text-foreground-muted font-mono text-2xs uppercase">Attachments</TableCell>
                {rows.map((row) => (
                  <TableCell key={row.id} className="text-foreground">{row.attachments?.length || 0}</TableCell>
                ))}
              </TableRow>
              <TableRow className="border-border/30">
                <TableCell className="text-foreground-muted font-mono text-2xs uppercase align-top">AI Summary</TableCell>
                {rows.map((row) => (
                  <TableCell key={row.id} className="whitespace-normal text-xs text-foreground/80 align-top">
                    {generatingSummaryIds.has(row.id) ? (
                      <div className="space-y-1.5 max-w-[200px]">
                        <Skeleton className="h-2.5 w-full bg-white/10" />
                        <Skeleton className="h-2.5 w-2/3 bg-white/10" />
                      </div>
                    ) : (
                      row.ai_summary_short || "Not generated yet"
                    )}
                  </TableCell>
                ))}
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </div>

      {/* P2-1 budget categories. Structurally a second table, not one more row in the first:
          there are N categories, each needing its own row, so it cannot fold into the
          one-row-per-dimension table above. Renders nothing when no bid carries a structured
          budget, so RFPs without categories look exactly as they did before. */}
      <BidBudgetComparison
        categoriesSource={rows.find((r) => r.budget_categories)?.budget_categories}
        bids={rows.map((r) => ({
          id: r.id,
          label: r.partner_display_name,
          lines: normalizeBudgetLines(r.budget_lines),
        }))}
      />

      {/* Detailed Comparison - AI-powered */}
      <div className="rounded-xl border border-border/40 bg-white/[0.02] overflow-hidden">
        <div className="px-5 pt-5 pb-1">
          <div className="font-mono text-2xs uppercase text-foreground-muted tracking-wider">Detailed Comparison</div>
        </div>
        <div className="p-5 pt-3 space-y-4">
          {checkingDecompositions ? (
            <p className="text-sm text-foreground-muted">Checking cost breakdowns...</p>
          ) : missingIds.length > 0 && analyzingIds.size === 0 ? (
            <div className="space-y-2">
              <p className="text-sm text-foreground-muted">
                {missingIds.length} of {rows.length} bids still need a cost breakdown before they can be compared.
              </p>
              {decomposeError && <p className="text-xs text-red-300">{decomposeError}</p>}
              <Button onClick={() => void analyzeAllBids()} className="bg-accent text-accent-foreground hover:bg-accent/90">
                Analyze All Bids
              </Button>
            </div>
          ) : analyzingIds.size > 0 ? (
            <div className="space-y-2">
              <p className="text-sm text-foreground-muted">Analyzing bid cost structures...</p>
              <ul className="space-y-1.5">
                {rows.map((row) => (
                  <li key={row.id} className="flex items-center gap-2 text-xs text-foreground-muted">
                    {analyzingIds.has(row.id) ? (
                      <Loader2 className="w-3 h-3 animate-spin text-accent" />
                    ) : decompositions.has(row.id) ? (
                      <span className="w-3 h-3 rounded-full bg-success" />
                    ) : (
                      <span className="w-3 h-3 rounded-full bg-red-400" />
                    )}
                    {row.partner_display_name}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <>
              {categoryUnion.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow className="border-border/40 hover:bg-transparent">
                      <TableHead className="text-foreground-muted">Category</TableHead>
                      {rows.map((row) => (
                        <TableHead key={row.id} className="text-foreground">{row.partner_display_name}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {categoryUnion.map((category) => (
                      <TableRow key={category} className="border-border/30">
                        <TableCell className="text-foreground font-medium whitespace-normal">{category}</TableCell>
                        {rows.map((row) => {
                          const item = (decompositions.get(row.id) || []).find((li) => li.category === category)
                          return (
                            <TableCell key={row.id} className="whitespace-normal text-xs">
                              {item ? (
                                <>
                                  <div className="text-foreground">${item.amount.toLocaleString("en-US")}</div>
                                  <div className="text-foreground-muted">{item.description || "-"}</div>
                                </>
                              ) : (
                                <span className="text-foreground-muted italic">Not itemized</span>
                              )}
                            </TableCell>
                          )
                        })}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-sm text-foreground-muted">No line items were extracted from these proposals.</p>
              )}

              <div className="rounded-lg border border-border/40 bg-white/5 p-4 space-y-2">
                <div className="font-mono text-2xs uppercase text-foreground-muted flex items-center gap-1.5">
                  <Sparkles className="w-3 h-3 text-accent" /> AI Analysis
                </div>
                {comparing ? (
                  <div className="space-y-2">
                    <p className="text-xs text-foreground-muted">Analyzing bid...</p>
                    <Skeleton className="h-3 w-full bg-white/10" />
                    <Skeleton className="h-3 w-full bg-white/10" />
                    <Skeleton className="h-3 w-2/3 bg-white/10" />
                  </div>
                ) : comparisonError ? (
                  <div className="flex items-center gap-2 font-mono text-2xs text-red-300">
                    <span>{comparisonError}</span>
                    <button type="button" onClick={() => void runComparison(true)} className="underline hover:text-red-200">
                      Retry
                    </button>
                  </div>
                ) : comparison ? (
                  <>
                    <AiMarkdown content={comparison.narrative} />
                    <button
                      type="button"
                      onClick={() => void runComparison(true)}
                      className="font-mono text-2xs text-accent hover:underline"
                    >
                      Regenerate Comparison
                    </button>
                  </>
                ) : (
                  <p className="text-sm text-foreground-muted">No comparison available yet.</p>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {allScored && (
        <div className="rounded-lg border border-accent/30 bg-accent/5 p-4">
          <div className="font-mono text-2xs uppercase text-foreground-muted mb-1 flex items-center gap-1.5">
            <Sparkles className="w-3 h-3 text-accent" /> Ranking Recommendation
          </div>
          {rankingGenerating ? (
            <div className="space-y-2">
              <p className="text-xs text-foreground-muted">Analyzing bid...</p>
              <Skeleton className="h-3 w-full bg-white/10" />
              <Skeleton className="h-3 w-2/3 bg-white/10" />
            </div>
          ) : rankingError ? (
            <div className="flex items-center gap-2 font-mono text-2xs text-red-300">
              <span>{rankingError}</span>
              <button type="button" onClick={() => void runRanking(true)} className="underline hover:text-red-200">
                Retry
              </button>
            </div>
          ) : rankingNarrative ? (
            <>
              <AiMarkdown content={rankingNarrative} />
              <button
                type="button"
                onClick={() => void runRanking(true)}
                className="mt-1.5 font-mono text-2xs text-accent hover:underline"
              >
                Regenerate Rankings
              </button>
            </>
          ) : null}
        </div>
      )}

      {evaluateQueue && (
        <BidDetailSheet
          row={evaluateQueue[evaluateIndex]}
          initialTab="evaluate"
          onNext={
            evaluateIndex < evaluateQueue.length - 1
              ? {
                  label: evaluateQueue[evaluateIndex + 1].partner_display_name,
                  onClick: () => setEvaluateIndex((i) => i + 1),
                }
              : null
          }
          onClose={() => {
            setEvaluateQueue(null)
            setEvaluateIndex(0)
          }}
        />
      )}

      <AlertDialog open={Boolean(awardTarget)} onOpenChange={(open) => { if (!open) setAwardTarget(null) }}>
        <AlertDialogContent className="border border-white/15 bg-[#081F1F] text-foreground shadow-2xl sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-foreground">Award this bid?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <p className="text-foreground/85 text-left text-sm leading-relaxed">
                {awardTarget && (
                  <>
                    You&apos;re about to award <span className="font-semibold text-foreground">{awardTarget.partner_display_name}</span>.
                    This action cannot be undone. The vendor will be notified immediately.
                  </>
                )}
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-2">
            <AlertDialogCancel type="button" className="border-border/60 text-foreground hover:bg-white/10 mt-0">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                type="button"
                className="bg-[#0C3535] hover:bg-[#0C3535]/90 text-white"
                onClick={() => {
                  if (awardTarget) void patchRow(awardTarget, { status: "awarded" })
                  setAwardTarget(null)
                }}
              >
                Confirm Award
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
