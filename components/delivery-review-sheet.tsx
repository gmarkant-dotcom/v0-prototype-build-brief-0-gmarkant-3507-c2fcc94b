"use client"

import { useEffect, useMemo, useState } from "react"
import { computeCompositeScore, compositeScoreColorClass } from "@/lib/bid-scoring"
import { AiMarkdown } from "@/components/ai-markdown"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { Loader2, CheckCircle, TrendingUp, TrendingDown } from "lucide-react"

type ReviewStatus = "draft" | "in_progress" | "complete"
type OnTime = "yes" | "no" | "partial"
type OnBudget = "yes" | "no" | "over" | "under"
type WorkAgain = "yes" | "likely" | "unlikely" | "no"

type Criterion = { id: string; name: string; description: string | null; default_weight: number; is_active: boolean }

type ReviewScoreRow = { criterion_id: string; weight: number; score: number | null; notes: string | null }

type Review = {
  id: string
  status: ReviewStatus
  composite_score: number | null
  on_time: OnTime | null
  on_time_notes: string | null
  on_budget: OnBudget | null
  budget_variance_pct: number | null
  on_budget_notes: string | null
  would_work_again: WorkAgain | null
  overall_satisfaction: number | null
  client_feedback: string | null
  ai_delta_summary: string | null
  response_id: string | null
  assignment_id: string | null
}

type DeltaRow = { criterion_id: string; criterion_name: string; bid_score: number; delivery_score: number; delta: number }
type Comparison = { hasEvaluation: boolean; rows: DeltaRow[]; unavailableReason?: string | null } | null

type ScoreDraft = { score: string; notes: string }

const ON_TIME_OPTIONS: { v: OnTime; label: string }[] = [
  { v: "yes", label: "Yes" },
  { v: "no", label: "No" },
  { v: "partial", label: "Partial" },
]
const ON_BUDGET_OPTIONS: { v: OnBudget; label: string }[] = [
  { v: "yes", label: "Yes" },
  { v: "no", label: "No" },
  { v: "over", label: "Over budget" },
  { v: "under", label: "Under budget" },
]
const WORK_AGAIN_OPTIONS: { v: WorkAgain; label: string }[] = [
  { v: "yes", label: "Yes" },
  { v: "likely", label: "Likely" },
  { v: "unlikely", label: "Unlikely" },
  { v: "no", label: "No" },
]

function PillGroup<T extends string>({
  value, options, onChange,
}: {
  value: T | null
  options: { v: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          onClick={() => onChange(o.v)}
          className={cn(
            "px-3 py-1.5 rounded-lg font-mono text-2xs uppercase tracking-wider border transition-colors",
            value === o.v
              ? "bg-accent text-accent-foreground border-accent"
              : "bg-white/5 text-foreground-muted border-border hover:bg-white/10"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export type DeliveryReviewSheetProps = {
  projectId: string
  partnershipId: string
  responseId: string | null
  projectName: string
  partnerName: string
  scopeItemName?: string | null
  onClose: () => void
  onSaved?: () => void
}

export function DeliveryReviewSheet({
  projectId, partnershipId, responseId, projectName, partnerName, scopeItemName, onClose, onSaved,
}: DeliveryReviewSheetProps) {
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [criteria, setCriteria] = useState<Criterion[]>([])
  const [review, setReview] = useState<Review | null>(null)
  const [comparison, setComparison] = useState<Comparison>(null)

  const [status, setStatus] = useState<ReviewStatus>("draft")
  const [onTime, setOnTime] = useState<OnTime | null>(null)
  const [onTimeNotes, setOnTimeNotes] = useState("")
  const [onBudget, setOnBudget] = useState<OnBudget | null>(null)
  const [budgetVariancePct, setBudgetVariancePct] = useState("")
  const [onBudgetNotes, setOnBudgetNotes] = useState("")
  const [workAgain, setWorkAgain] = useState<WorkAgain | null>(null)
  const [satisfaction, setSatisfaction] = useState<number>(5)
  const [clientFeedback, setClientFeedback] = useState("")
  const [scoreDraft, setScoreDraft] = useState<Record<string, ScoreDraft>>({})

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setLoadError(null)
      try {
        const [criteriaRes, reviewRes] = await Promise.all([
          fetch("/api/agency/scoring/criteria"),
          fetch(
            `/api/agency/delivery-reviews?project_id=${encodeURIComponent(projectId)}&partnership_id=${encodeURIComponent(partnershipId)}`
          ),
        ])
        const criteriaData = await criteriaRes.json().catch(() => ({}))
        const reviewData = await reviewRes.json().catch(() => ({}))
        if (!criteriaRes.ok) throw new Error(criteriaData?.error || "Failed to load criteria")
        if (!reviewRes.ok) throw new Error(reviewData?.error || "Failed to load delivery review")
        if (cancelled) return

        const activeCriteria = ((criteriaData.criteria || []) as Criterion[]).filter((c) => c.is_active)
        setCriteria(activeCriteria)

        const loadedReview = reviewData.review as Review | null
        setReview(loadedReview)
        setComparison(reviewData.comparison as Comparison)

        if (loadedReview) {
          setStatus(loadedReview.status)
          setOnTime(loadedReview.on_time)
          setOnTimeNotes(loadedReview.on_time_notes || "")
          setOnBudget(loadedReview.on_budget)
          setBudgetVariancePct(loadedReview.budget_variance_pct != null ? String(loadedReview.budget_variance_pct) : "")
          setOnBudgetNotes(loadedReview.on_budget_notes || "")
          setWorkAgain(loadedReview.would_work_again)
          setSatisfaction(loadedReview.overall_satisfaction != null ? Math.round(loadedReview.overall_satisfaction) : 5)
          setClientFeedback(loadedReview.client_feedback || "")
        }

        const scores = (reviewData.scores || []) as ReviewScoreRow[]
        const nextDraft: Record<string, ScoreDraft> = {}
        for (const s of scores) {
          nextDraft[s.criterion_id] = {
            score: s.score != null ? String(s.score) : "",
            notes: s.notes || "",
          }
        }
        setScoreDraft(nextDraft)
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Failed to load delivery review")
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectId, partnershipId])

  const updateScoreDraft = (criterionId: string, patch: Partial<ScoreDraft>) => {
    setScoreDraft((prev) => {
      const current = prev[criterionId] ?? { score: "", notes: "" }
      return { ...prev, [criterionId]: { ...current, ...patch } }
    })
  }

  const liveComposite = useMemo(
    () =>
      computeCompositeScore(
        criteria.map((c) => {
          const d = scoreDraft[c.id]
          const score = d?.score ? parseFloat(d.score) : null
          return {
            weight: c.default_weight,
            ai_score: null,
            human_score: score,
            is_overridden: true,
          }
        })
      ),
    [criteria, scoreDraft]
  )

  const save = async () => {
    setSaving(true)
    setSaveError(null)
    setSaved(false)
    try {
      const scores = criteria.map((c) => {
        const d = scoreDraft[c.id]
        return {
          criterion_id: c.id,
          score: d?.score ? parseFloat(d.score) : null,
          notes: d?.notes || null,
        }
      })
      const res = await fetch("/api/agency/delivery-reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          partnership_id: partnershipId,
          response_id: responseId,
          status,
          scores,
          delivery_summary_fields: {
            on_time: onTime,
            on_time_notes: onTimeNotes,
            on_budget: onBudget,
            budget_variance_pct: budgetVariancePct ? parseFloat(budgetVariancePct) : null,
            on_budget_notes: onBudgetNotes,
            would_work_again: workAgain,
            overall_satisfaction: satisfaction,
            client_feedback: clientFeedback,
          },
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "Failed to save delivery review")
      setReview(data.review as Review)
      setComparison(data.comparison as Comparison)
      setStatus((data.review as Review).status)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
      onSaved?.()
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Failed to save delivery review")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose() }}>
      <SheetContent side="right" className="w-full sm:max-w-2xl bg-card border-border text-foreground flex flex-col p-0 gap-0">
        <SheetHeader className="px-6 pt-6 pb-4 border-b border-border shrink-0">
          <SheetTitle className="font-display text-foreground">{projectName}</SheetTitle>
          <SheetDescription className="text-foreground-muted">
            {[partnerName, scopeItemName].filter(Boolean).join(" · ")}
          </SheetDescription>
        </SheetHeader>

        {loading ? (
          <div className="p-6">
            <p className="text-sm text-foreground-muted">Loading…</p>
          </div>
        ) : loadError ? (
          <div className="p-6">
            <p className="text-sm text-red-300">{loadError}</p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
            {/* Section A - Delivery Summary */}
            <div className="space-y-4">
              <h3 className="font-display font-bold text-sm text-foreground">Delivery Summary</h3>

              <div className="space-y-2">
                <label className="font-mono text-2xs uppercase tracking-wider text-foreground-muted">On time</label>
                <PillGroup value={onTime} options={ON_TIME_OPTIONS} onChange={setOnTime} />
                <Textarea
                  value={onTimeNotes}
                  onChange={(e) => setOnTimeNotes(e.target.value)}
                  placeholder="Notes on timeline delivery (optional)"
                  className="bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50 min-h-[70px] text-sm"
                />
              </div>

              <div className="space-y-2">
                <label className="font-mono text-2xs uppercase tracking-wider text-foreground-muted">On budget</label>
                <PillGroup value={onBudget} options={ON_BUDGET_OPTIONS} onChange={setOnBudget} />
                {(onBudget === "over" || onBudget === "under") && (
                  <Input
                    value={budgetVariancePct}
                    onChange={(e) => setBudgetVariancePct(e.target.value)}
                    placeholder="Variance % (e.g. 15 for 15% over)"
                    className="max-w-[220px] bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50"
                  />
                )}
                <Textarea
                  value={onBudgetNotes}
                  onChange={(e) => setOnBudgetNotes(e.target.value)}
                  placeholder="Notes on budget performance (optional)"
                  className="bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50 min-h-[70px] text-sm"
                />
              </div>

              <div className="space-y-2">
                <label className="font-mono text-2xs uppercase tracking-wider text-foreground-muted">
                  Would work with again
                </label>
                <PillGroup value={workAgain} options={WORK_AGAIN_OPTIONS} onChange={setWorkAgain} />
              </div>

              <div className="space-y-2">
                <div className="flex justify-between">
                  <label className="font-mono text-2xs uppercase tracking-wider text-foreground-muted">
                    Overall satisfaction
                  </label>
                  <span className="font-mono text-xs text-foreground">{satisfaction}/10</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={10}
                  value={satisfaction}
                  onChange={(e) => setSatisfaction(Number(e.target.value))}
                  className="w-full accent-accent"
                />
              </div>

              <div className="space-y-2">
                <label className="font-mono text-2xs uppercase tracking-wider text-foreground-muted">
                  Client feedback
                </label>
                <Textarea
                  value={clientFeedback}
                  onChange={(e) => setClientFeedback(e.target.value)}
                  placeholder="How did the client respond to this vendor's work?"
                  className="bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50 min-h-[80px] text-sm"
                />
              </div>
            </div>

            {/* Section B - Criteria Scoring */}
            <div className="space-y-4">
              <div>
                <h3 className="font-display font-bold text-sm text-foreground">Criteria Scoring</h3>
                <p className="text-xs text-foreground-muted mt-0.5">
                  Rate actual delivery performance against each criterion
                </p>
              </div>

              {criteria.map((c) => {
                const d = scoreDraft[c.id] || { score: "", notes: "" }
                return (
                  <div key={c.id} className="rounded-lg border border-border/40 bg-white/5 p-4 space-y-3">
                    <div>
                      <span className="font-display font-bold text-sm text-foreground">{c.name}</span>
                      {c.description && <p className="text-xs text-foreground-muted mt-1">{c.description}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min={1}
                        max={10}
                        step={1}
                        value={d.score}
                        onChange={(e) => updateScoreDraft(c.id, { score: e.target.value })}
                        placeholder="1-10"
                        className="w-20 bg-white/5 border-border text-foreground"
                      />
                      {d.score !== "" && (
                        <button
                          type="button"
                          onClick={() => updateScoreDraft(c.id, { score: "" })}
                          className="text-xs text-foreground-muted hover:text-foreground transition-colors"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                    <Textarea
                      value={d.notes}
                      onChange={(e) => updateScoreDraft(c.id, { notes: e.target.value })}
                      placeholder="Notes (optional)"
                      className="bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50 min-h-[60px] text-xs"
                    />
                  </div>
                )
              })}

              <div className="rounded-lg border border-border/40 bg-white/5 p-4 flex items-center gap-3">
                {liveComposite != null ? (
                  <div
                    className={cn(
                      "flex items-center justify-center w-14 h-14 rounded-full border-2 font-display font-bold text-lg",
                      compositeScoreColorClass(liveComposite).bg,
                      compositeScoreColorClass(liveComposite).text,
                      compositeScoreColorClass(liveComposite).border
                    )}
                  >
                    {Math.round(liveComposite)}
                  </div>
                ) : (
                  <div className="w-14 h-14 rounded-full border-2 border-border flex items-center justify-center font-mono text-2xs text-foreground-muted">
                    --
                  </div>
                )}
                <div>
                  <div className="font-mono text-2xs uppercase text-foreground-muted">Composite Score</div>
                  <div className="text-xs text-foreground-muted">0-100 scale</div>
                </div>
              </div>
            </div>

            {/* Section C - Bid vs Delivery Delta */}
            {review?.status === "complete" && (
              <div className="space-y-3">
                <h3 className="font-display font-bold text-sm text-foreground">Bid vs Delivery Delta</h3>
                {comparison && comparison.hasEvaluation ? (
                  <>
                    {/* P2-3 cross-surface guard: a bid scored against its own RFP's criteria has
                        no shared criterion to compare delivery against. Say so - an empty delta
                        table would read as delivery matching the bid exactly. */}
                    {comparison.rows.length === 0 && comparison.unavailableReason && (
                      <p className="text-sm text-foreground-muted">{comparison.unavailableReason}</p>
                    )}
                    {comparison.rows.length > 0 && (
                      <div className="overflow-x-auto rounded-lg border border-border/40">
                        <table className="w-full text-sm border-collapse">
                          <thead className="bg-white/5 border-b border-border/40">
                            <tr>
                              <th className="text-left font-mono text-2xs uppercase tracking-wider text-foreground-muted px-3 py-2">
                                Criterion
                              </th>
                              <th className="text-left font-mono text-2xs uppercase tracking-wider text-foreground-muted px-3 py-2">
                                Bid Score
                              </th>
                              <th className="text-left font-mono text-2xs uppercase tracking-wider text-foreground-muted px-3 py-2">
                                Delivery Score
                              </th>
                              <th className="text-left font-mono text-2xs uppercase tracking-wider text-foreground-muted px-3 py-2">
                                Delta
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {comparison.rows.map((r) => (
                              <tr key={r.criterion_id} className="border-t border-border/20">
                                <td className="px-3 py-2 text-foreground">{r.criterion_name}</td>
                                <td className="px-3 py-2 text-foreground">{r.bid_score}/10</td>
                                <td className="px-3 py-2 text-foreground">{r.delivery_score}/10</td>
                                <td className="px-3 py-2">
                                  <span
                                    className={cn(
                                      "inline-flex items-center gap-1 font-mono text-xs",
                                      r.delta > 0 ? "text-success" : r.delta < 0 ? "text-red-300" : "text-foreground-muted"
                                    )}
                                  >
                                    {r.delta > 0 ? (
                                      <TrendingUp className="w-3 h-3" />
                                    ) : r.delta < 0 ? (
                                      <TrendingDown className="w-3 h-3" />
                                    ) : null}
                                    {r.delta > 0 ? "+" : ""}
                                    {r.delta}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {review.ai_delta_summary ? (
                      <div className="rounded-lg border border-border/40 bg-white/5 p-4">
                        <AiMarkdown content={review.ai_delta_summary} />
                      </div>
                    ) : (
                      <p className="text-sm text-foreground-muted">Delta analysis will appear after saving.</p>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-foreground-muted">
                    No bid evaluation was recorded for this engagement. Delta analysis is available when bids are
                    scored before awarding.
                  </p>
                )}
              </div>
            )}

            {/* Save controls */}
            <div className="rounded-lg border border-border/40 bg-white/5 p-4 space-y-3 sticky bottom-0">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <Select value={status} onValueChange={(v) => setStatus(v as ReviewStatus)}>
                  <SelectTrigger className="w-[150px] bg-white/5 border-border text-foreground">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="in_progress">In Progress</SelectItem>
                    <SelectItem value="complete">Complete</SelectItem>
                  </SelectContent>
                </Select>
                <div className="flex items-center gap-3">
                  {saved && (
                    <span className="inline-flex items-center gap-1 text-xs text-success">
                      <CheckCircle className="w-3.5 h-3.5" /> Saved
                    </span>
                  )}
                  <Button onClick={() => void save()} disabled={saving} className="bg-accent text-accent-foreground hover:bg-accent/90">
                    {saving && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
                    Save Review
                  </Button>
                </div>
              </div>
              {saveError && <p className="text-xs text-red-300">{saveError}</p>}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
