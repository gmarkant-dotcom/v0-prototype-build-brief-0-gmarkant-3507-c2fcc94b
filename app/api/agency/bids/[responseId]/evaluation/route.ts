import { resolveCallerOrgIds, resolveCallerWriteOrgId } from "@/lib/entitlements"
import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { callAnthropicAnalysis } from "@/lib/ai-bid-analysis"
import { loadBidAnalysisContext, formatBidContextForPrompt } from "@/lib/bid-analysis-context"
import { computeCompositeScore } from "@/lib/bid-scoring"
import {
  resolveRfpRubricForResponse,
  rfpScoreColumnsAvailable,
  writeRfpCriterionScores,
} from "@/lib/rfp-evaluation-criteria-server"
import {
  formatRubricForPrompt,
  parseSyntheticCriterionId,
  toSyntheticCriterionId,
  type RfpEvaluationCriterion,
} from "@/lib/rfp-evaluation-criteria"

export const dynamic = "force-dynamic"

const ALLOWED_STATUS = new Set(["draft", "in_progress", "complete"])

async function requireAgency() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false as const, status: 401, error: "Unauthorized" }
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, active_role")
    .eq("id", user.id)
    .maybeSingle()
  if (profile?.role !== "agency" && profile?.active_role !== "agency") {
    return { ok: false as const, status: 403, error: "Agency only" }
  }
  return { ok: true as const, supabase, userId: user.id }
}


/** The columns a score row is read through. rfp_criterion_key and criterion_name_snapshot only
 *  exist after migration 075, so the select list is chosen from the same probe that decides
 *  whether a per-RFP rubric is offered at all. */
function scoreSelect(perRfpAvailable: boolean): string {
  const base = "criterion_id, weight, ai_score, ai_rationale, human_score, human_notes, is_overridden"
  return perRfpAvailable ? `${base}, rfp_criterion_key, criterion_name_snapshot` : base
}

/** Wire shape: a per-RFP score reports the synthetic id its rubric criterion carries, so the
 *  Evaluate tab keys its draft the same way for both rubric kinds and needs no branch of its
 *  own. Legacy rows keep reporting their real bid_scoring_criteria uuid. */
function toWireScore(row: Record<string, unknown>): Record<string, unknown> {
  const rfpKey = row.rfp_criterion_key as string | null | undefined
  if (!rfpKey) return row
  return { ...row, criterion_id: toSyntheticCriterionId(rfpKey) }
}

/** The rubric rendered by the Evaluate tab, in the shape it already expects for the agency's
 *  global criteria - so per-RFP criteria need no new client-side type. */
function rubricToWireCriteria(rubric: RfpEvaluationCriterion[]) {
  return rubric.map((c) => ({
    id: toSyntheticCriterionId(c.key),
    name: c.name,
    description: c.description || null,
    category: null,
    default_weight: c.weight,
    is_active: true,
  }))
}

// GET - load the evaluation (if any) plus its per-criterion scores. Returns
// { evaluation: null } rather than 404 - "no evaluation yet" is an expected state.
export async function GET(_req: Request, { params }: { params: Promise<{ responseId: string }> }) {
  const route = "/api/agency/bids/[responseId]/evaluation"
  const { responseId } = await params
  const auth = await requireAgency()
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const { supabase, userId } = auth

  // 079: an organization column is not a user id. Reads scope to the caller's memberships.
  const callerOrgIds = await resolveCallerOrgIds(userId, supabase)

  const { data: evaluation, error: evalErr } = await supabase
    .from("bid_evaluations")
    .select("id, status, composite_score, ai_recommendation, ranked_recommendation, ranked_recommendation_group, template_id")
    .eq("response_id", responseId)
    .in("org_id", callerOrgIds)
    .maybeSingle()
  if (evalErr) {
    console.error("[api] failure", { route, method: "GET", message: evalErr.message })
    return NextResponse.json({ error: "Failed to load evaluation" }, { status: 500 })
  }
  // P2-3. Resolved even when there is no evaluation yet: the Evaluate tab needs the rubric to
  // render its rows before the first score is saved. Empty means this RFP uses the agency's
  // global criteria, which is every legacy RFP and every RFP at all before migration 075.
  const perRfpAvailable = await rfpScoreColumnsAvailable(supabase)
  const rubric = await resolveRfpRubricForResponse(supabase, responseId, userId)
  const rfpCriteria = rubricToWireCriteria(rubric)

  if (!evaluation) return NextResponse.json({ evaluation: null, rfp_criteria: rfpCriteria })

  const { data: scores, error: scoresErr } = await supabase
    .from("bid_evaluation_scores")
    .select(scoreSelect(perRfpAvailable))
    .eq("evaluation_id", evaluation.id)
  if (scoresErr) {
    console.error("[api] failure", { route, method: "GET", message: scoresErr.message })
    return NextResponse.json({ error: "Failed to load evaluation scores" }, { status: 500 })
  }

  return NextResponse.json({
    evaluation: { ...evaluation, scores: ((scores || []) as unknown as Record<string, unknown>[]).map(toWireScore) },
    rfp_criteria: rfpCriteria,
  })
}

type ScoreInput = { criterion_id?: unknown; human_score?: unknown; human_notes?: unknown; weight?: unknown }

const MIN_WEIGHT = 0.5
const MAX_WEIGHT = 3.0

// PUT - create the evaluation shell (first "Start Evaluation" click, scores: []) or save
// human scores/notes and recompute the composite. Body: { scores, status }.
export async function PUT(req: Request, { params }: { params: Promise<{ responseId: string }> }) {
  const route = "/api/agency/bids/[responseId]/evaluation"
  try {
    const { responseId } = await params
    const auth = await requireAgency()
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
    const { supabase, userId } = auth

    // 079: an organization column is not a user id. Reads scope to the caller's memberships.
    const callerOrgIds = await resolveCallerOrgIds(userId, supabase)
    // 079: a write is attributed to the caller's OWN organization. Never a visibility set.
    const writeOrgId = await resolveCallerWriteOrgId(userId, supabase)
    if (!writeOrgId) {
      return NextResponse.json({ error: "Your account is not linked to an organization yet" }, { status: 403 })
    }

    const body = await req.json().catch(() => ({}))
    const status = typeof body?.status === "string" && ALLOWED_STATUS.has(body.status) ? body.status : "draft"
    const scoresInput: ScoreInput[] = Array.isArray(body?.scores) ? body.scores : []

    const { data: response, error: responseErr } = await supabase
      .from("partner_rfp_responses")
      .select("id")
      .eq("id", responseId)
      .in("lead_org_id", callerOrgIds)
      .maybeSingle()
    if (responseErr) {
      console.error("[api] failure", { route, method: "PUT", message: responseErr.message })
      return NextResponse.json({ error: "Failed to load bid" }, { status: 500 })
    }
    if (!response) return NextResponse.json({ error: "Bid not found" }, { status: 404 })

    const { data: evaluation, error: evalUpsertErr } = await supabase
      .from("bid_evaluations")
      .upsert(
        { response_id: responseId, org_id: writeOrgId, status, updated_at: new Date().toISOString() },
        { onConflict: "response_id" }
      )
      .select("id")
      .single()
    if (evalUpsertErr) {
      console.error("[api] failure", { route, method: "PUT", message: evalUpsertErr.message })
      return NextResponse.json({ error: "Failed to save evaluation" }, { status: 500 })
    }

    // P2-3. A per-RFP criterion arrives as the synthetic id "rfp:<key>" and is stored in
    // rfp_criterion_key, never under a bid_scoring_criteria uuid - two criteria can share a
    // name and mean different things, so borrowing a global id would silently corrupt every
    // cross-RFP aggregate that reads it. The two kinds are upserted separately because they
    // have different conflict targets.
    const perRfpAvailable = await rfpScoreColumnsAvailable(supabase)
    const rubric = perRfpAvailable ? await resolveRfpRubricForResponse(supabase, responseId, userId) : []
    const rubricByKey = new Map(rubric.map((c) => [c.key, c]))

    if (scoresInput.length > 0) {
      const allIds = scoresInput
        .map((s) => (typeof s.criterion_id === "string" ? s.criterion_id : null))
        .filter((id): id is string => Boolean(id))
      const criterionIds = allIds.filter((id) => parseSyntheticCriterionId(id) == null)
      const rfpKeys = allIds.map(parseSyntheticCriterionId).filter((k): k is string => Boolean(k))

      const [{ data: existingScores }, { data: criteriaRows }, existingRfp] = await Promise.all([
        criterionIds.length > 0
          ? supabase
              .from("bid_evaluation_scores")
              .select("criterion_id, weight, ai_score")
              .eq("evaluation_id", evaluation.id)
              .in("criterion_id", criterionIds)
          : Promise.resolve({ data: [] as Record<string, unknown>[] }),
        criterionIds.length > 0
          ? supabase.from("bid_scoring_criteria").select("id, default_weight").in("id", criterionIds)
          : Promise.resolve({ data: [] as Record<string, unknown>[] }),
        perRfpAvailable && rfpKeys.length > 0
          ? supabase
              .from("bid_evaluation_scores")
              .select("rfp_criterion_key, weight, ai_score")
              .eq("evaluation_id", evaluation.id)
              .in("rfp_criterion_key", rfpKeys)
          : Promise.resolve({ data: [] as Record<string, unknown>[] }),
      ])
      const existingByCriterion = new Map((existingScores || []).map((s) => [s.criterion_id as string, s]))
      const defaultWeightByCriterion = new Map((criteriaRows || []).map((c) => [c.id as string, c.default_weight as number]))
      const existingByRfpKey = new Map(
        ((existingRfp.data || []) as Record<string, unknown>[]).map((s) => [s.rfp_criterion_key as string, s])
      )

      /** Shared scalar handling for both rubric kinds - clamping, override detection, and the
       *  per-evaluation weight rule are identical whichever table the criterion came from. */
      const scalarsFor = (s: ScoreInput, existing: Record<string, unknown> | undefined, fallbackWeight: number) => {
        const humanScoreRaw = s.human_score
        const humanScore =
          humanScoreRaw === null || humanScoreRaw === undefined
            ? null
            : Math.min(10, Math.max(1, Number(humanScoreRaw)))
        const humanNotes = typeof s.human_notes === "string" ? s.human_notes.trim() || null : null
        const aiScore = (existing?.ai_score as number | null) ?? null
        const requestedWeight = typeof s.weight === "number" ? s.weight : parseFloat(String(s.weight ?? ""))
        const weight =
          Number.isFinite(requestedWeight) && requestedWeight >= MIN_WEIGHT && requestedWeight <= MAX_WEIGHT
            ? requestedWeight
            : (existing?.weight as number | undefined) ?? fallbackWeight
        return { weight, ai_score: aiScore, human_score: humanScore, human_notes: humanNotes, is_overridden: humanScore != null && humanScore !== aiScore }
      }

      const rfpRows = perRfpAvailable
        ? scoresInput
            .map((s) => {
              const id = typeof s.criterion_id === "string" ? s.criterion_id : ""
              const key = parseSyntheticCriterionId(id)
              if (!key) return null
              const criterion = rubricByKey.get(key)
              // A key that is not in this RFP's current rubric is dropped rather than stored -
              // the agency removed that criterion, and inventing a row for it would resurrect a
              // dimension they deliberately deleted.
              if (!criterion) return null
              return {
                evaluation_id: evaluation.id,
                rfp_criterion_key: key,
                criterion_name_snapshot: criterion.name,
                // ai_score is deliberately NOT sent: the writer leaves any column a caller
                // omits untouched, so a human save can never blank the AI's score.
                ...(() => {
                  const { ai_score: _aiScore, ...rest } = scalarsFor(s, existingByRfpKey.get(key), criterion.weight)
                  return rest
                })(),
              }
            })
            .filter((r): r is NonNullable<typeof r> => r != null)
        : []

      if (rfpRows.length > 0) {
        // S1: NOT .upsert({onConflict:"evaluation_id,rfp_criterion_key"}) - 075 backs that pair
        // with a PARTIAL unique index, which Postgres refuses as an ON CONFLICT arbiter unless
        // the statement repeats the predicate, and PostgREST emits none. Probed live: 42P10.
        // See writeRfpCriterionScores for the full evidence.
        const { error: rfpWriteErr } = await writeRfpCriterionScores(
          supabase,
          evaluation.id,
          rfpRows.map((r) => ({
            rfp_criterion_key: r.rfp_criterion_key,
            criterion_name_snapshot: r.criterion_name_snapshot,
            weight: r.weight,
            human_score: r.human_score,
            human_notes: r.human_notes,
            is_overridden: r.is_overridden,
          }))
        )
        if (rfpWriteErr) {
          console.error("[api] failure", { route, method: "PUT", message: rfpWriteErr, code: "rfp_scores_write" })
          return NextResponse.json({ error: "Failed to save scores" }, { status: 500 })
        }
      }

      const rows = scoresInput
        .filter((s): s is Required<Pick<ScoreInput, "criterion_id">> & ScoreInput => typeof s.criterion_id === "string")
        .filter((s) => parseSyntheticCriterionId(s.criterion_id as string) == null)
        .map((s) => {
          const criterionId = s.criterion_id as string
          const existing = existingByCriterion.get(criterionId)
          const humanScoreRaw = s.human_score
          const humanScore =
            humanScoreRaw === null || humanScoreRaw === undefined
              ? null
              : Math.min(10, Math.max(1, Number(humanScoreRaw)))
          const humanNotes = typeof s.human_notes === "string" ? s.human_notes.trim() || null : null
          const aiScore = (existing?.ai_score as number | null) ?? null
          const isOverridden = humanScore != null && humanScore !== aiScore
          // Per-evaluation weight customization: use the value sent by the client if
          // present and valid, otherwise keep whatever this row already has (or the
          // criterion's agency-wide default for a brand new row). This never touches
          // bid_scoring_criteria.default_weight itself.
          const requestedWeight = typeof s.weight === "number" ? s.weight : parseFloat(String(s.weight ?? ""))
          const weight =
            Number.isFinite(requestedWeight) && requestedWeight >= MIN_WEIGHT && requestedWeight <= MAX_WEIGHT
              ? requestedWeight
              : (existing?.weight as number | undefined) ?? defaultWeightByCriterion.get(criterionId) ?? 1.0
          return {
            evaluation_id: evaluation.id,
            criterion_id: criterionId,
            weight,
            ai_score: aiScore,
            human_score: humanScore,
            human_notes: humanNotes,
            is_overridden: isOverridden,
          }
        })

      if (rows.length > 0) {
        const { error: scoresUpsertErr } = await supabase
          .from("bid_evaluation_scores")
          .upsert(rows, { onConflict: "evaluation_id,criterion_id" })
        if (scoresUpsertErr) {
          console.error("[api] failure", { route, method: "PUT", message: scoresUpsertErr.message })
          return NextResponse.json({ error: "Failed to save scores" }, { status: 500 })
        }
      }
    }

    const { data: allScores, error: allScoresErr } = await supabase
      .from("bid_evaluation_scores")
      .select(scoreSelect(perRfpAvailable))
      .eq("evaluation_id", evaluation.id)
    if (allScoresErr) {
      console.error("[api] failure", { route, method: "PUT", message: allScoresErr.message })
      return NextResponse.json({ error: "Failed to load saved scores" }, { status: 500 })
    }

    // Composite is a weighted mean on a 0-100 scale regardless of which rubric produced it,
    // which is exactly why the vendor reliability index and the composite bid-to-delivery delta
    // keep computing correctly for per-RFP-scored bids with no change at all.
    const composite = computeCompositeScore(
      ((allScores || []) as unknown as Record<string, unknown>[]).map((s) => ({
        weight: s.weight as number,
        ai_score: s.ai_score as number | null,
        human_score: s.human_score as number | null,
        is_overridden: s.is_overridden as boolean,
      }))
    )

    let aiRecommendation: string | null = null
    if (status === "complete") {
      const ctx = await loadBidAnalysisContext(supabase, responseId, userId)
      if (ctx) {
        const bidContext = formatBidContextForPrompt(ctx)
        const scoreSummary =
          composite != null
            ? `Composite evaluation score: ${composite}/100.`
            : "No criteria were scored."
        // S1: the recommendation must know WHICH dimensions produced that composite. Without
        // this it reasons about a number with no rubric behind it.
        const rubricForPrompt = formatRubricForPrompt(rubric)
        const rubricBlock = rubricForPrompt
          ? `\n\nScored against this RFP's own criteria:\n${rubricForPrompt}`
          : ""
        const result = await callAnthropicAnalysis({
          systemPrompt:
            "You are a procurement analyst. Based on this bid and its evaluation composite score, write one sentence recommending whether to move forward with this vendor and why. Plain prose, no markdown.",
          userContent: `${bidContext}${rubricBlock}\n\n${scoreSummary}`,
          maxTokens: 200,
        })
        if (result.success) aiRecommendation = result.text.trim()
      }
    }

    const now = new Date().toISOString()
    const evalPatch: Record<string, unknown> = { composite_score: composite, updated_at: now }
    if (aiRecommendation) evalPatch.ai_recommendation = aiRecommendation

    const { data: updatedEvaluation, error: finalUpdateErr } = await supabase
      .from("bid_evaluations")
      .update(evalPatch)
      .eq("id", evaluation.id)
      .select("id, status, composite_score, ai_recommendation, ranked_recommendation, ranked_recommendation_group, template_id")
      .single()
    if (finalUpdateErr) {
      console.error("[api] failure", { route, method: "PUT", message: finalUpdateErr.message })
      return NextResponse.json({ error: "Failed to save evaluation" }, { status: 500 })
    }

    const { error: responseUpdateErr } = await supabase
      .from("partner_rfp_responses")
      .update({ composite_score: composite })
      .eq("id", responseId)
    if (responseUpdateErr) {
      console.error("[api] failure", { route, method: "PUT", message: responseUpdateErr.message, code: "sync_response_composite" })
    }

    return NextResponse.json({
      evaluation: {
        ...updatedEvaluation,
        scores: ((allScores || []) as unknown as Record<string, unknown>[]).map(toWireScore),
      },
      rfp_criteria: rubricToWireCriteria(rubric),
    })
  } catch (error) {
    console.error("[api] failure", {
      route: "/api/agency/bids/[responseId]/evaluation",
      method: "PUT",
      code: 500,
      message: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: "Failed to save evaluation" }, { status: 500 })
  }
}
