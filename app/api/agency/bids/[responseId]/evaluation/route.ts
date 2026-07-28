import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { callAnthropicAnalysis } from "@/lib/ai-bid-analysis"
import { loadBidAnalysisContext, formatBidContextForPrompt } from "@/lib/bid-analysis-context"
import { computeCompositeScore } from "@/lib/bid-scoring"

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

// GET - load the evaluation (if any) plus its per-criterion scores. Returns
// { evaluation: null } rather than 404 - "no evaluation yet" is an expected state.
export async function GET(_req: Request, { params }: { params: Promise<{ responseId: string }> }) {
  const route = "/api/agency/bids/[responseId]/evaluation"
  const { responseId } = await params
  const auth = await requireAgency()
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const { supabase, userId } = auth

  const { data: evaluation, error: evalErr } = await supabase
    .from("bid_evaluations")
    .select("id, status, composite_score, ai_recommendation, ranked_recommendation, ranked_recommendation_group, template_id")
    .eq("response_id", responseId)
    .eq("agency_id", userId)
    .maybeSingle()
  if (evalErr) {
    console.error("[api] failure", { route, method: "GET", message: evalErr.message })
    return NextResponse.json({ error: "Failed to load evaluation" }, { status: 500 })
  }
  if (!evaluation) return NextResponse.json({ evaluation: null })

  const { data: scores, error: scoresErr } = await supabase
    .from("bid_evaluation_scores")
    .select("criterion_id, weight, ai_score, ai_rationale, human_score, human_notes, is_overridden")
    .eq("evaluation_id", evaluation.id)
  if (scoresErr) {
    console.error("[api] failure", { route, method: "GET", message: scoresErr.message })
    return NextResponse.json({ error: "Failed to load evaluation scores" }, { status: 500 })
  }

  return NextResponse.json({ evaluation: { ...evaluation, scores: scores || [] } })
}

type ScoreInput = { criterion_id?: unknown; human_score?: unknown; human_notes?: unknown }

// PUT - create the evaluation shell (first "Start Evaluation" click, scores: []) or save
// human scores/notes and recompute the composite. Body: { scores, status }.
export async function PUT(req: Request, { params }: { params: Promise<{ responseId: string }> }) {
  const route = "/api/agency/bids/[responseId]/evaluation"
  try {
    const { responseId } = await params
    const auth = await requireAgency()
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
    const { supabase, userId } = auth

    const body = await req.json().catch(() => ({}))
    const status = typeof body?.status === "string" && ALLOWED_STATUS.has(body.status) ? body.status : "draft"
    const scoresInput: ScoreInput[] = Array.isArray(body?.scores) ? body.scores : []

    const { data: response, error: responseErr } = await supabase
      .from("partner_rfp_responses")
      .select("id")
      .eq("id", responseId)
      .eq("agency_id", userId)
      .maybeSingle()
    if (responseErr) {
      console.error("[api] failure", { route, method: "PUT", message: responseErr.message })
      return NextResponse.json({ error: "Failed to load bid" }, { status: 500 })
    }
    if (!response) return NextResponse.json({ error: "Bid not found" }, { status: 404 })

    const { data: evaluation, error: evalUpsertErr } = await supabase
      .from("bid_evaluations")
      .upsert(
        { response_id: responseId, agency_id: userId, status, updated_at: new Date().toISOString() },
        { onConflict: "response_id" }
      )
      .select("id")
      .single()
    if (evalUpsertErr) {
      console.error("[api] failure", { route, method: "PUT", message: evalUpsertErr.message })
      return NextResponse.json({ error: "Failed to save evaluation" }, { status: 500 })
    }

    if (scoresInput.length > 0) {
      const criterionIds = scoresInput
        .map((s) => (typeof s.criterion_id === "string" ? s.criterion_id : null))
        .filter((id): id is string => Boolean(id))

      const [{ data: existingScores }, { data: criteriaRows }] = await Promise.all([
        supabase
          .from("bid_evaluation_scores")
          .select("criterion_id, weight, ai_score")
          .eq("evaluation_id", evaluation.id)
          .in("criterion_id", criterionIds),
        supabase.from("bid_scoring_criteria").select("id, default_weight").in("id", criterionIds),
      ])
      const existingByCriterion = new Map((existingScores || []).map((s) => [s.criterion_id as string, s]))
      const defaultWeightByCriterion = new Map((criteriaRows || []).map((c) => [c.id as string, c.default_weight as number]))

      const rows = scoresInput
        .filter((s): s is Required<Pick<ScoreInput, "criterion_id">> & ScoreInput => typeof s.criterion_id === "string")
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
          return {
            evaluation_id: evaluation.id,
            criterion_id: criterionId,
            weight: (existing?.weight as number | undefined) ?? defaultWeightByCriterion.get(criterionId) ?? 1.0,
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
      .select("criterion_id, weight, ai_score, ai_rationale, human_score, human_notes, is_overridden")
      .eq("evaluation_id", evaluation.id)
    if (allScoresErr) {
      console.error("[api] failure", { route, method: "PUT", message: allScoresErr.message })
      return NextResponse.json({ error: "Failed to load saved scores" }, { status: 500 })
    }

    const composite = computeCompositeScore(
      (allScores || []).map((s) => ({
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
        const result = await callAnthropicAnalysis({
          systemPrompt:
            "You are a procurement analyst. Based on this bid and its evaluation composite score, write one sentence recommending whether to move forward with this vendor and why. Plain prose, no markdown.",
          userContent: `${bidContext}\n\n${scoreSummary}`,
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

    return NextResponse.json({ evaluation: { ...updatedEvaluation, scores: allScores || [] } })
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
