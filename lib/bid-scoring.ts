// No Node built-ins here (e.g. "crypto") - this file is imported from client components
// for live composite-score calculation, not just from API routes.

export type ScoreForComposite = {
  weight: number
  ai_score: number | null
  human_score: number | null
  is_overridden: boolean
}

/**
 * (sum(active_score * weight) / sum(weight)) * 10, rounded to one decimal, on a 0-100
 * scale. active_score = human_score when is_overridden, else ai_score. Criteria with no
 * score at all (neither ai nor human) are excluded from both sums rather than counted
 * as zero, so a partial evaluation still produces a meaningful composite.
 */
export function computeCompositeScore(scores: ScoreForComposite[]): number | null {
  let weightedSum = 0
  let weightTotal = 0
  for (const s of scores) {
    const activeScore = s.is_overridden ? s.human_score : s.ai_score
    if (activeScore == null) continue
    weightedSum += activeScore * s.weight
    weightTotal += s.weight
  }
  if (weightTotal === 0) return null
  return Math.round((weightedSum / weightTotal) * 10 * 10) / 10
}

export function compositeScoreColorClass(score: number): { bg: string; text: string; border: string } {
  if (score >= 80) return { bg: "bg-emerald-500/15", text: "text-emerald-300", border: "border-emerald-400/40" }
  if (score >= 60) return { bg: "bg-amber-500/15", text: "text-amber-300", border: "border-amber-400/40" }
  return { bg: "bg-red-500/15", text: "text-red-300", border: "border-red-400/40" }
}
