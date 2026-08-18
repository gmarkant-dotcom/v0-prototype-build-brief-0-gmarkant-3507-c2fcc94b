import type { SupabaseClient } from "@supabase/supabase-js"
import type { OrgId } from "@/lib/entitlements"
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
/**
 * 079 PARAMETER CLASS: `orgIds` is the CALLER'S OWN organizations, from
 * resolveCallerOrgIds() - never a counterparty or visibility set. It replaces a single
 * parameter that callers filled with `user.id`, comparing an organization column to a
 * user id. `.in()` on an empty array matches nothing, so a caller with no membership
 * fails closed rather than silently reading another organization's rows.
 */
export async function resolveRfpRubricForResponse(
  supabase: SupabaseClient,
  responseId: string,
  orgIds: readonly OrgId[]
): Promise<RfpEvaluationCriterion[]> {
  if (!(await rfpScoreColumnsAvailable(supabase))) return []

  const { data: response } = await supabase
    .from("partner_rfp_responses")
    .select("inbox_item_id")
    .eq("id", responseId)
    .in("lead_org_id", orgIds)
    .maybeSingle()
  if (!response) return []

  if (response.inbox_item_id) {
    const { data: inbox } = await supabase
      .from("partner_rfp_inbox")
      .select("master_rfp_json")
      .eq("id", response.inbox_item_id)
      .in("lead_org_id", orgIds)
      .maybeSingle()
    return readRfpEvaluationCriteriaFromMasterRfpJson(inbox?.master_rfp_json)
  }

  const { data: token, error: tokenErr } = await supabase
    .from("rfp_magic_tokens")
    .select("evaluation_criteria")
    .eq("response_id", responseId)
    .in("org_id", orgIds)
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

/** One per-RFP criterion score, in the shape bid_evaluation_scores stores it. criterion_id is
 *  deliberately absent: migration 075's CHECK requires exactly one identifier, and for these
 *  rows that identifier is rfp_criterion_key. */
export type RfpCriterionScoreRow = {
  rfp_criterion_key: string
  criterion_name_snapshot: string | null
  weight: number
  ai_score?: number | null
  ai_rationale?: string | null
  human_score?: number | null
  human_notes?: string | null
  is_overridden?: boolean
}

/**
 * S1: writes per-RFP criterion scores WITHOUT PostgREST's on_conflict upsert.
 *
 * The obvious call - .upsert(rows, { onConflict: "evaluation_id,rfp_criterion_key" }) - cannot
 * work, and this is not a guess. Probed against the live database:
 *
 *   on_conflict=evaluation_id,rfp_criterion_key -> HTTP 400
 *     42P10 "there is no unique or exclusion constraint matching the ON CONFLICT specification"
 *   on_conflict=evaluation_id,criterion_id      -> HTTP 409 (23503, the expected FK rejection)
 *
 * Migration 075 backs the per-RFP half with a PARTIAL unique index
 * (... WHERE rfp_criterion_key IS NOT NULL), because 065's UNIQUE(evaluation_id, criterion_id)
 * cannot cover rows whose criterion_id is NULL - NULLs are distinct in a unique constraint.
 * Postgres will only use a partial index as an ON CONFLICT arbiter when the statement repeats
 * the index predicate (ON CONFLICT (cols) WHERE ...), and PostgREST emits no WHERE clause. So
 * every per-RFP score write failed at plan time, before touching a row. That is why Save
 * Evaluation and Generate AI Scores both failed while the composite still computed in the
 * browser: nothing was ever persisted.
 *
 * Select-then-update-or-insert instead. This is the pattern this codebase already uses for
 * exactly this reason - see the project_assignments write in
 * app/api/agency/rfp-responses/[id]/route.ts, which avoids onConflict because it has no real
 * unique constraint to target either. No migration needed, and the partial index still does its
 * real job of preventing duplicates.
 */
export async function writeRfpCriterionScores(
  supabase: SupabaseClient,
  evaluationId: string,
  rows: RfpCriterionScoreRow[]
): Promise<{ error: string | null }> {
  if (rows.length === 0) return { error: null }

  const keys = rows.map((r) => r.rfp_criterion_key)
  const { data: existing, error: lookupErr } = await supabase
    .from("bid_evaluation_scores")
    .select("id, rfp_criterion_key")
    .eq("evaluation_id", evaluationId)
    .in("rfp_criterion_key", keys)
  if (lookupErr) return { error: lookupErr.message }

  const idByKey = new Map(
    ((existing || []) as Record<string, unknown>[]).map((e) => [e.rfp_criterion_key as string, e.id as string])
  )

  for (const row of rows) {
    const id = idByKey.get(row.rfp_criterion_key)
    if (!id) continue
    // Only the fields this caller actually supplies are written. An AI rescore must not blank
    // the human score a reviewer already entered, and a human save must not blank the AI's.
    const patch: Record<string, unknown> = {
      criterion_name_snapshot: row.criterion_name_snapshot,
      weight: row.weight,
    }
    if ("ai_score" in row) patch.ai_score = row.ai_score
    if ("ai_rationale" in row) patch.ai_rationale = row.ai_rationale
    if ("human_score" in row) patch.human_score = row.human_score
    if ("human_notes" in row) patch.human_notes = row.human_notes
    if ("is_overridden" in row) patch.is_overridden = row.is_overridden
    const { error: updateErr } = await supabase.from("bid_evaluation_scores").update(patch).eq("id", id)
    if (updateErr) return { error: updateErr.message }
  }

  const toInsert = rows
    .filter((r) => !idByKey.has(r.rfp_criterion_key))
    .map((r) => ({ evaluation_id: evaluationId, ...r }))
  if (toInsert.length > 0) {
    const { error: insertErr } = await supabase.from("bid_evaluation_scores").insert(toInsert)
    if (insertErr) return { error: insertErr.message }
  }

  return { error: null }
}
