import type { SupabaseClient } from "@supabase/supabase-js"

export type DeltaRow = {
  criterion_id: string
  criterion_name: string
  bid_score: number
  delivery_score: number
  delta: number
}

export type DeltaComparison = {
  hasEvaluation: boolean
  rows: DeltaRow[]
}

/**
 * Loads the bid evaluation (if any) linked to a delivery review's response_id and builds
 * a per-criterion delta table against the delivery review's own scores, matched by
 * criterion_id (not name). Some awarded bids are never formally scored - "no evaluation"
 * is an expected, non-error outcome here, not every delivery review can produce a delta.
 */
export async function loadBidDeltaComparison(
  supabase: SupabaseClient,
  agencyId: string,
  responseId: string | null,
  deliveryScores: { criterion_id: string; score: number | null }[]
): Promise<DeltaComparison> {
  if (!responseId) return { hasEvaluation: false, rows: [] }

  const { data: evaluation } = await supabase
    .from("bid_evaluations")
    .select("id")
    .eq("response_id", responseId)
    .eq("agency_id", agencyId)
    .maybeSingle()
  if (!evaluation) return { hasEvaluation: false, rows: [] }

  const { data: bidScores } = await supabase
    .from("bid_evaluation_scores")
    .select("criterion_id, ai_score, human_score, is_overridden")
    .eq("evaluation_id", evaluation.id)

  const bidActiveByCriterion = new Map<string, number>()
  for (const s of bidScores || []) {
    const active = s.is_overridden ? (s.human_score as number | null) : (s.ai_score as number | null)
    if (active != null) bidActiveByCriterion.set(s.criterion_id as string, active)
  }

  const deliveryByCriterion = new Map(
    deliveryScores.filter((s) => s.score != null).map((s) => [s.criterion_id, s.score as number])
  )

  const criterionIds = [...new Set([...bidActiveByCriterion.keys(), ...deliveryByCriterion.keys()])]
  if (criterionIds.length === 0) return { hasEvaluation: true, rows: [] }

  const { data: criteriaRows } = await supabase.from("bid_scoring_criteria").select("id, name").in("id", criterionIds)
  const nameByCriterion = new Map((criteriaRows || []).map((c) => [c.id as string, c.name as string]))

  const rows: DeltaRow[] = []
  for (const criterionId of criterionIds) {
    const bidScore = bidActiveByCriterion.get(criterionId)
    const deliveryScore = deliveryByCriterion.get(criterionId)
    if (bidScore == null || deliveryScore == null) continue
    rows.push({
      criterion_id: criterionId,
      criterion_name: nameByCriterion.get(criterionId) || "Criterion",
      bid_score: bidScore,
      delivery_score: deliveryScore,
      delta: Math.round((deliveryScore - bidScore) * 10) / 10,
    })
  }

  return { hasEvaluation: true, rows }
}
