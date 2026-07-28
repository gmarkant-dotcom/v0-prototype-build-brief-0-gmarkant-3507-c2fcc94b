"use client"

import { forwardRef, useEffect, useImperativeHandle, useState } from "react"
import { mutate } from "swr"
import { computeCompositeScore, compositeScoreColorClass } from "@/lib/bid-scoring"
import { AiMarkdown } from "@/components/ai-markdown"
import { ScoringSettingsSheet } from "@/components/scoring-settings-sheet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { Sparkles, Loader2, CheckCircle, Settings } from "lucide-react"

const STATUS_HELPER_TEXT: Record<Evaluation["status"], string> = {
  draft: "Evaluation started, scores are tentative",
  in_progress: "Partially scored, not yet finalized",
  complete: "All scores finalized, counts toward rankings",
}

const MIN_WEIGHT = 0.5
const MAX_WEIGHT = 3.0

const RFP_RESPONSES_URL = "/api/agency/rfp-responses"

type Criterion = {
  id: string
  name: string
  description: string | null
  category: string | null
  default_weight: number
  is_active: boolean
}

type EvaluationScore = {
  criterion_id: string
  weight: number
  ai_score: number | null
  ai_rationale: string | null
  human_score: number | null
  human_notes: string | null
  is_overridden: boolean
}

type Evaluation = {
  id: string
  status: "draft" | "in_progress" | "complete"
  composite_score: number | null
  ai_recommendation: string | null
  scores: EvaluationScore[]
}

type Draft = { humanScore: string; humanNotes: string }

export type BidEvaluationTabHandle = {
  /** Saves the current draft and returns whether it succeeded - used by compare
   *  mode's "Evaluate All" flow to save-then-advance to the next vendor. */
  save: () => Promise<boolean>
}

export const BidEvaluationTab = forwardRef<BidEvaluationTabHandle, { responseId: string }>(function BidEvaluationTab(
  { responseId },
  ref
) {
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [criteria, setCriteria] = useState<Criterion[]>([])
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null)
  const [draft, setDraft] = useState<Record<string, Draft>>({})
  const [weightDraft, setWeightDraft] = useState<Record<string, string>>({})
  const [status, setStatus] = useState<Evaluation["status"]>("draft")
  const [scoringSettingsOpen, setScoringSettingsOpen] = useState(false)

  const [starting, setStarting] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [generateError, setGenerateError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const load = async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [criteriaRes, evalRes] = await Promise.all([
        fetch("/api/agency/scoring/criteria"),
        fetch(`/api/agency/bids/${responseId}/evaluation`),
      ])
      const criteriaData = await criteriaRes.json().catch(() => ({}))
      const evalData = await evalRes.json().catch(() => ({}))
      if (!criteriaRes.ok) throw new Error(criteriaData?.error || "Failed to load criteria")
      if (!evalRes.ok) throw new Error(evalData?.error || "Failed to load evaluation")

      const activeCriteria = ((criteriaData.criteria || []) as Criterion[]).filter((c) => c.is_active)
      setCriteria(activeCriteria)
      const loadedEvaluation = evalData.evaluation as Evaluation | null
      setEvaluation(loadedEvaluation)

      if (loadedEvaluation) {
        setStatus(loadedEvaluation.status)
        const nextDraft: Record<string, Draft> = {}
        for (const s of loadedEvaluation.scores) {
          nextDraft[s.criterion_id] = {
            humanScore: s.human_score != null ? String(s.human_score) : "",
            humanNotes: s.human_notes || "",
          }
        }
        setDraft(nextDraft)
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load evaluation")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [responseId])

  const startEvaluation = async () => {
    setStarting(true)
    setLoadError(null)
    try {
      const res = await fetch(`/api/agency/bids/${responseId}/evaluation`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scores: [], status: "draft" }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "Failed to start evaluation")
      setEvaluation(data.evaluation)
      setStatus(data.evaluation.status)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to start evaluation")
    } finally {
      setStarting(false)
    }
  }

  const generateAiScores = async () => {
    setGenerating(true)
    setGenerateError(null)
    try {
      const res = await fetch(`/api/agency/bids/${responseId}/ai-score`, { method: "POST" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "AI scoring failed, please try again.")
      setEvaluation((prev) =>
        prev ? { ...prev, composite_score: data.composite_score, scores: data.scores } : prev
      )
      void mutate(RFP_RESPONSES_URL)
    } catch (e) {
      setGenerateError(e instanceof Error ? e.message : "AI scoring failed, please try again.")
    } finally {
      setGenerating(false)
    }
  }

  const updateDraft = (criterionId: string, patch: Partial<Draft>) => {
    setDraft((prev) => {
      const current: Draft = prev[criterionId] ?? { humanScore: "", humanNotes: "" }
      return { ...prev, [criterionId]: { ...current, ...patch } }
    })
  }

  /** Current weight for a criterion as a string for the input: the in-session edit if
   *  there is one, else whatever's already saved on this evaluation, else the
   *  criterion's agency-wide default. Never mutates bid_scoring_criteria itself. */
  const weightFor = (criterion: Criterion): string => {
    if (weightDraft[criterion.id] !== undefined) return weightDraft[criterion.id]
    const existing = evaluation?.scores.find((s) => s.criterion_id === criterion.id)
    return String(existing?.weight ?? criterion.default_weight)
  }

  const updateWeight = (criterionId: string, value: string) => {
    setWeightDraft((prev) => ({ ...prev, [criterionId]: value }))
  }

  const liveComposite = computeCompositeScore(
    criteria.map((c) => {
      const existing = evaluation?.scores.find((s) => s.criterion_id === c.id)
      const d = draft[c.id]
      const humanScore = d?.humanScore ? parseFloat(d.humanScore) : null
      const weightNum = parseFloat(weightFor(c))
      return {
        weight: Number.isFinite(weightNum) && weightNum > 0 ? weightNum : c.default_weight,
        ai_score: existing?.ai_score ?? null,
        human_score: humanScore,
        is_overridden: humanScore != null,
      }
    })
  )

  const saveEvaluation = async () => {
    setSaving(true)
    setSaveError(null)
    setSaved(false)
    try {
      const scores = criteria.map((c) => {
        const d = draft[c.id]
        const weightNum = parseFloat(weightFor(c))
        return {
          criterion_id: c.id,
          human_score: d?.humanScore ? parseFloat(d.humanScore) : null,
          human_notes: d?.humanNotes || null,
          weight: Number.isFinite(weightNum) && weightNum > 0 ? weightNum : c.default_weight,
        }
      })
      const res = await fetch(`/api/agency/bids/${responseId}/evaluation`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scores, status }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "Failed to save evaluation")
      setEvaluation(data.evaluation)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
      void mutate(RFP_RESPONSES_URL)
      return true
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Failed to save evaluation")
      return false
    } finally {
      setSaving(false)
    }
  }

  useImperativeHandle(ref, () => ({ save: saveEvaluation }))

  if (loading) {
    return <p className="text-sm text-foreground-muted">Loading...</p>
  }

  if (!evaluation) {
    return (
      <div className="rounded-lg border border-border/40 bg-white/5 p-5 space-y-3">
        <p className="text-sm text-foreground/90 leading-relaxed">
          Score this bid against your evaluation criteria. AI will pre-score each criterion with a written
          rationale that you can accept or override.
        </p>
        {loadError && <p className="text-xs text-red-300">{loadError}</p>}
        <Button
          onClick={() => void startEvaluation()}
          disabled={starting}
          className="bg-accent text-accent-foreground hover:bg-accent/90"
        >
          {starting && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
          Start Evaluation
        </Button>
      </div>
    )
  }

  const hasAnyAiScore = evaluation.scores.some((s) => s.ai_score != null)

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setScoringSettingsOpen(true)}
          className="flex items-center gap-1.5 font-mono text-[10px] text-foreground-muted hover:text-foreground transition-colors"
        >
          <Settings className="w-3.5 h-3.5" /> Scoring Settings
        </button>
      </div>

      {criteria.map((c) => {
        const existing = evaluation.scores.find((s) => s.criterion_id === c.id)
        const d = draft[c.id] || { humanScore: "", humanNotes: "" }
        const hasHuman = d.humanScore !== ""
        const currentWeight = weightFor(c)
        const currentWeightNum = parseFloat(currentWeight)
        const isCustomWeight = Number.isFinite(currentWeightNum) && currentWeightNum !== c.default_weight
        return (
          <div key={c.id} className="rounded-lg border border-border/40 bg-white/5 p-4 space-y-3">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-display font-bold text-sm text-foreground">{c.name}</span>
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-[10px] text-foreground-muted">weight</span>
                  <Input
                    type="number"
                    min={MIN_WEIGHT}
                    max={MAX_WEIGHT}
                    step={0.5}
                    value={currentWeight}
                    onChange={(e) => updateWeight(c.id, e.target.value)}
                    className="w-16 h-6 px-1.5 text-xs bg-white/5 border-border text-foreground"
                  />
                  {isCustomWeight && (
                    <button
                      type="button"
                      onClick={() => updateWeight(c.id, String(c.default_weight))}
                      className="font-mono text-[9px] text-foreground-muted hover:text-accent underline transition-colors"
                    >
                      Reset to default
                    </button>
                  )}
                </div>
              </div>
              {c.description && <p className="text-xs text-foreground-muted mt-1">{c.description}</p>}
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div
                className={cn(
                  "rounded-md border p-3",
                  !hasHuman && existing?.ai_score != null ? "border-accent/40 bg-accent/5" : "border-border/30"
                )}
              >
                <div className="font-mono text-[9px] uppercase text-foreground-muted mb-1.5 flex items-center justify-between">
                  <span>AI Score</span>
                  {!hasHuman && existing?.ai_score != null && (
                    <span className="text-accent">Active</span>
                  )}
                </div>
                {existing?.ai_score != null ? (
                  <>
                    <div className="flex items-center gap-2">
                      <div className="flex gap-0.5">
                        {Array.from({ length: 10 }).map((_, i) => (
                          <span
                            key={i}
                            className={cn(
                              "w-2 h-4 rounded-sm",
                              i < Math.round(existing.ai_score as number) ? "bg-accent" : "bg-white/10"
                            )}
                          />
                        ))}
                      </div>
                      <span className="text-sm text-foreground">{existing.ai_score}/10</span>
                    </div>
                    {existing.ai_rationale && (
                      <p className="text-xs text-foreground-muted mt-1.5 leading-relaxed">{existing.ai_rationale}</p>
                    )}
                  </>
                ) : generating ? (
                  <p className="text-xs text-foreground-muted italic">Analyzing bid...</p>
                ) : (
                  <p className="text-xs text-foreground-muted/70 italic">Not yet generated</p>
                )}
              </div>

              <div className={cn("rounded-md border p-3", hasHuman ? "border-accent/40 bg-accent/5" : "border-border/30")}>
                <div className="font-mono text-[9px] uppercase text-foreground-muted mb-1.5 flex items-center justify-between">
                  <span>Your Score</span>
                  {hasHuman && <span className="text-accent">Active</span>}
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={1}
                    max={10}
                    step={1}
                    value={d.humanScore}
                    onChange={(e) => updateDraft(c.id, { humanScore: e.target.value })}
                    placeholder="1-10"
                    className="w-20 bg-white/5 border-border text-foreground"
                  />
                  {hasHuman && (
                    <button
                      type="button"
                      onClick={() => updateDraft(c.id, { humanScore: "" })}
                      className="text-xs text-foreground-muted hover:text-foreground transition-colors"
                    >
                      Clear
                    </button>
                  )}
                </div>
                <Textarea
                  value={d.humanNotes}
                  onChange={(e) => updateDraft(c.id, { humanNotes: e.target.value })}
                  placeholder="Notes (optional)"
                  className="mt-2 bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50 min-h-[60px] text-xs"
                />
              </div>
            </div>
          </div>
        )
      })}

      <div className="rounded-lg border border-border/40 bg-white/5 p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
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
              <div className="w-14 h-14 rounded-full border-2 border-border flex items-center justify-center font-mono text-[10px] text-foreground-muted">
                --
              </div>
            )}
            <div>
              <div className="font-mono text-[10px] uppercase text-foreground-muted">Composite Score</div>
              <div className="text-xs text-foreground-muted">0-100 scale</div>
            </div>
          </div>

          <div className="text-right">
            <Select value={status} onValueChange={(v) => setStatus(v as Evaluation["status"])}>
              <SelectTrigger className="w-[150px] bg-white/5 border-border text-foreground">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="complete">Complete</SelectItem>
              </SelectContent>
            </Select>
            <p className="mt-1 text-[10px] text-foreground-muted max-w-[150px]">{STATUS_HELPER_TEXT[status]}</p>
          </div>
        </div>

        {evaluation.ai_recommendation && evaluation.status === "complete" && (
          <div className="rounded-md border border-border/40 bg-white/5 p-3">
            <div className="font-mono text-[10px] uppercase text-foreground-muted mb-1 flex items-center gap-1.5">
              <Sparkles className="w-3 h-3 text-accent" /> AI Recommendation
            </div>
            <AiMarkdown content={evaluation.ai_recommendation} />
          </div>
        )}

        <div className="flex items-center gap-3 flex-wrap">
          {!hasAnyAiScore ? (
            <Button
              onClick={() => void generateAiScores()}
              disabled={generating}
              className="bg-accent text-accent-foreground hover:bg-accent/90"
            >
              {generating ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 mr-1.5" />}
              Generate AI Scores
            </Button>
          ) : (
            <button
              type="button"
              onClick={() => void generateAiScores()}
              disabled={generating}
              className="font-mono text-[10px] text-accent hover:underline"
            >
              {generating ? "Regenerating..." : "Regenerate AI Scores"}
            </button>
          )}
          <Button
            onClick={() => void saveEvaluation()}
            disabled={saving}
            variant="outline"
            className="border-border text-foreground hover:bg-white/5"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
            Save Evaluation
          </Button>
          {saved && (
            <span className="inline-flex items-center gap-1 text-xs text-green-500">
              <CheckCircle className="w-3.5 h-3.5" /> Saved
            </span>
          )}
        </div>
        {generateError && <p className="text-xs text-red-300">{generateError}</p>}
        {saveError && <p className="text-xs text-red-300">{saveError}</p>}
      </div>

      <ScoringSettingsSheet open={scoringSettingsOpen} onOpenChange={setScoringSettingsOpen} />
    </div>
  )
})
