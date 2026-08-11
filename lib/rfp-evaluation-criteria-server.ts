import type { SupabaseClient } from "@supabase/supabase-js"
import {
  normalizeRfpEvaluationCriteria,
  readRfpEvaluationCriteriaFromMasterRfpJson,
  type RfpEvaluationCriterion,
} from "@/lib/rfp-evaluation-criteria"

/**
 * Server-side rubric resolution for one bid (P2-3).
 *
 * A bid is scored against its own RFP's rubric when that RFP defines one AND the database can
 * actually store per-RFP scores. Otherwise it falls back to the agency's global
 * bid_scoring_criteria, which is exactly today's behavior and is what every legacy RFP gets.
 */

/**
 * Whether migration 075's per-RFP score columns exist. Probed rather than assumed, because
 * offering an agency a per-RFP rubric it cannot save against would be worse than not offering
 * it at all - they would score a whole bid and lose it. One cheap query, and the answer is
 * cached for the life of the server instance since a migration does not un-apply itself.
 */
let scoreColumnsAvailable: boolean | null = null

export async function rfpScoreColumnsAvailable(supabase: SupabaseClient): Promise<boolean> {
  if (scoreColumnsAvailable !== null) return scoreColumnsAvailable
  const { error } = await supabase.from("bid_evaluation_scores").select("rfp_criterion_key").limit(1)
  if (error) {
    // 42703 is the expected pre-migration answer. Anything else (a transient failure, an RLS
    // quirk) is also treated as "not available" - falling back to the global rubric is always
    // safe, where guessing the other way is not.
    scoreColumnsAvailable = false
    if (error.code !== "42703") {
      console.warn("[rfp-evaluation-criteria] per-RFP score columns probe failed, using global rubric", {
        code: error.code,
        message: error.message,
      })
    }
    return false
  }
  scoreColumnsAvailable = true
  return true
}

/**
 * The RFP rubric behind one response, from whichever flow created it. Empty array means "no
 * per-RFP rubric", which is the global-defaults path.
 *
 * Wizard flow reads master_rfp_json, which is an existing column and needs no migration.
 * Magic-link flow reads rfp_magic_tokens.evaluation_criteria through a guarded select, so a
 * missing column is simply "no rubric" rather than a 500.
 */
export async function resolveRfpRubricForResponse(
  supabase: SupabaseClient,
  responseId: string,
  agencyId: string
): Promise<RfpEvaluationCriterion[]> {
  if (!(await rfpScoreColumnsAvailable(supabase))) return []

  const { data: response } = await supabase
    .from("partner_rfp_responses")
    .select("inbox_item_id")
    .eq("id", responseId)
    .eq("agency_id", agencyId)
    .maybeSingle()
  if (!response) return []

  if (response.inbox_item_id) {
    const { data: inbox } = await supabase
      .from("partner_rfp_inbox")
      .select("master_rfp_json")
      .eq("id", response.inbox_item_id)
      .eq("agency_id", agencyId)
      .maybeSingle()
    return readRfpEvaluationCriteriaFromMasterRfpJson(inbox?.master_rfp_json)
  }

  const { data: token, error: tokenErr } = await supabase
    .from("rfp_magic_tokens")
    .select("evaluation_criteria")
    .eq("response_id", responseId)
    .eq("agency_id", agencyId)
    .maybeSingle()
  if (tokenErr) {
    if (tokenErr.code !== "42703") {
      console.warn("[rfp-evaluation-criteria] magic token rubric read failed, using global rubric", {
        code: tokenErr.code,
        message: tokenErr.message,
      })
    }
    return []
  }
  return normalizeRfpEvaluationCriteria(token?.evaluation_criteria)
}
