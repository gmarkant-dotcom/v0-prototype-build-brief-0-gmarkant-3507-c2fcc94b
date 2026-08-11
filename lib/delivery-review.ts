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
  /** P2-3 cross-surface guard. Set when an evaluation exists but no per-criterion comparison is
   *  possible, so the sheet can say why instead of rendering an empty delta table - an empty
   *  table there reads as "delivery matched the bid exactly", which would be a fabricated
   *  agreement. Null when there is nothing to explain. */
  unavailableReason: string | null
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
  if (!responseId) return { hasEvaluation: false, rows: [], unavailableReason: null }

  const { data: evaluation } = await supabase
    .from("bid_evaluations")
    .select("id")
    .eq("response_id", responseId)
    .eq("agency_id", agencyId)
    .maybeSingle()
  if (!evaluation) return { hasEvaluation: false, rows: [], unavailableReason: null }

  const { data: bidScores } = await supabase
    .from("bid_evaluation_scores")
    .select("criterion_id, ai_score, human_score, is_overridden")
    .eq("evaluation_id", evaluation.id)

  const bidActiveByCriterion = new Map<string, number>()
  let perRfpScoreCount = 0
  for (const s of bidScores || []) {
    const active = s.is_overridden ? (s.human_score as number | null) : (s.ai_score as number | null)
    // P2-3: a per-RFP score has a NULL criterion_id (its identity is rfp_criterion_key, which
    // has no row in bid_scoring_criteria at all). It is counted, then excluded - never matched
    // against a delivery criterion, because two criteria can share a name and mean different
    // things, and a delta built on that would be a number invented from a coincidence.
    if (s.criterion_id == null) {
      if (active != null) perRfpScoreCount += 1
      continue
    }
    if (active != null) bidActiveByCriterion.set(s.criterion_id as string, active)
  }

  const deliveryByCriterion = new Map(
    deliveryScores.filter((s) => s.score != null).map((s) => [s.criterion_id, s.score as number])
  )

  const criterionIds = [...new Set([...bidActiveByCriterion.keys(), ...deliveryByCriterion.keys()])]
  const perRfpOnly = perRfpScoreCount > 0 && bidActiveByCriterion.size === 0
  const unavailableReason = perRfpOnly
    ? "This bid was scored against criteria defined for its own RFP, and delivery is reviewed against your standard criteria. There is no shared criterion to compare, so no per-criterion delta is shown. The composite scores above are still directly comparable."
    : null
  if (criterionIds.length === 0) return { hasEvaluation: true, rows: [], unavailableReason }

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

  return { hasEvaluation: true, rows, unavailableReason: rows.length === 0 ? unavailableReason : null }
}
