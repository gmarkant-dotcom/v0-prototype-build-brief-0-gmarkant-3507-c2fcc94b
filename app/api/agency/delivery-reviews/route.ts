import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { callAnthropicAnalysis } from "@/lib/ai-bid-analysis"
import { computeCompositeScore } from "@/lib/bid-scoring"
import { loadBidDeltaComparison } from "@/lib/delivery-review"
import { checkUsageLimit, incrementAiAnalysis } from "@/lib/usage-tracking"
import { agencyEntitlementId } from "@/lib/entitlements"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 45

const STATUS_VALUES = new Set(["draft", "in_progress", "complete"])
const ON_TIME_VALUES = new Set(["yes", "no", "partial"])
const ON_BUDGET_VALUES = new Set(["yes", "no", "over", "under"])
const WORK_AGAIN_VALUES = new Set(["yes", "likely", "unlikely", "no"])
const MIN_WEIGHT = 0.5
const MAX_WEIGHT = 3.0

const DELTA_SYSTEM_PROMPT =
  "Compare bid evaluation scores with actual delivery performance for this vendor engagement. For each criterion where scores differ by 2+ points, explain the gap. Highlight: did the vendor over-promise or under-deliver? Were there positive surprises? Summarize this vendor's reliability based on this project. Be specific, cite the score numbers."

async function requireAgency() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false as const, status: 401, error: "Unauthorized" }
  const { data: profile } = await supabase.from("profiles").select("role, active_role").eq("id", user.id).maybeSingle()
  if (profile?.role !== "agency" && profile?.active_role !== "agency") {
    return { ok: false as const, status: 403, error: "Agency only" }
  }
  return { ok: true as const, supabase, userId: user.id }
}

// GET - load the delivery review (if any) plus its per-criterion scores and, when the
// awarded bid was formally scored, the bid-vs-delivery delta table. Returns
// { review: null } rather than 404 - "no review yet" is an expected state.
export async function GET(req: NextRequest) {
  const route = "/api/agency/delivery-reviews"
  const auth = await requireAgency()
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const { supabase, userId } = auth

  const projectId = req.nextUrl.searchParams.get("project_id")?.trim() || ""
  const partnershipId = req.nextUrl.searchParams.get("partnership_id")?.trim() || ""
  if (!projectId) {
    return NextResponse.json({ error: "project_id is required" }, { status: 400 })
  }

  // List mode - no partnership_id: cheap existence/status map for every review on this
  // project, so the Delivery Performance page can label each engagement's button
  // ("Write Review" vs "Edit Review") without one fetch per row.
  if (!partnershipId) {
    const { data: reviews, error: listErr } = await supabase
      .from("delivery_reviews")
      .select("id, partnership_id, status, composite_score")
      .eq("project_id", projectId)
      .eq("agency_id", userId)
    if (listErr) {
      console.error("[api] failure", { route, method: "GET", message: listErr.message })
      return NextResponse.json({ error: "Failed to load delivery reviews" }, { status: 500 })
    }
    return NextResponse.json({ reviews: reviews || [] })
  }

  const { data: review, error: reviewErr } = await supabase
    .from("delivery_reviews")
    .select(
      "id, status, composite_score, on_time, on_time_notes, on_budget, budget_variance_pct, on_budget_notes, would_work_again, overall_satisfaction, client_feedback, ai_delta_summary, response_id, assignment_id, updated_at"
    )
    .eq("project_id", projectId)
    .eq("partnership_id", partnershipId)
    .eq("agency_id", userId)
    .maybeSingle()
  if (reviewErr) {
    console.error("[api] failure", { route, method: "GET", message: reviewErr.message })
    return NextResponse.json({ error: "Failed to load delivery review" }, { status: 500 })
  }
  if (!review) return NextResponse.json({ review: null, scores: [], comparison: null })

  const { data: scores, error: scoresErr } = await supabase
    .from("delivery_review_scores")
    .select("criterion_id, weight, score, notes")
    .eq("review_id", review.id)
  if (scoresErr) {
    console.error("[api] failure", { route, method: "GET", message: scoresErr.message })
    return NextResponse.json({ error: "Failed to load delivery review scores" }, { status: 500 })
  }

  const comparison = await loadBidDeltaComparison(
    supabase,
    userId,
    (review.response_id as string | null) ?? null,
    (scores || []).map((s) => ({ criterion_id: s.criterion_id as string, score: s.score as number | null }))
  )

  return NextResponse.json({ review, scores: scores || [], comparison })
}

type ScoreInput = { criterion_id?: unknown; score?: unknown; notes?: unknown; weight?: unknown }
type DeliverySummaryInput = {
  on_time?: unknown
  on_time_notes?: unknown
  on_budget?: unknown
  budget_variance_pct?: unknown
  on_budget_notes?: unknown
  would_work_again?: unknown
  overall_satisfaction?: unknown
  client_feedback?: unknown
}

function pickEnum(value: unknown, allowed: Set<string>): string | null {
  return typeof value === "string" && allowed.has(value) ? value : null
}

function pickText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function pickNumber(value: unknown, min: number, max: number): number | null {
  const n = typeof value === "number" ? value : parseFloat(String(value ?? ""))
  if (!Number.isFinite(n)) return null
  return Math.min(max, Math.max(min, n))
}

// POST - create or update a delivery review + its criterion scores. Body:
// { project_id, partnership_id, response_id?, scores, delivery_summary_fields, status }.
// On status "complete" with a response_id that resolves to a scored bid_evaluation,
// generates the bid-vs-delivery AI delta summary.
export async function POST(req: Request) {
  const route = "/api/agency/delivery-reviews"
  try {
    const auth = await requireAgency()
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
    const { supabase, userId } = auth

    const body = await req.json().catch(() => ({}))
    const projectId = typeof body?.project_id === "string" ? body.project_id : ""
    const partnershipId = typeof body?.partnership_id === "string" ? body.partnership_id : ""
    if (!projectId || !partnershipId) {
      return NextResponse.json({ error: "project_id and partnership_id are required" }, { status: 400 })
    }
    const status = pickEnum(body?.status, STATUS_VALUES) ?? "draft"
    const scoresInput: ScoreInput[] = Array.isArray(body?.scores) ? body.scores : []
    const summaryInput: DeliverySummaryInput =
      body?.delivery_summary_fields && typeof body.delivery_summary_fields === "object" ? body.delivery_summary_fields : {}
    const requestedResponseId = typeof body?.response_id === "string" && body.response_id.trim() ? body.response_id.trim() : null

    // Never trust client payload for ownership - verify project and partnership both
    // belong to this agency before writing anything keyed to them.
    const [{ data: project }, { data: partnership }] = await Promise.all([
      supabase.from("projects").select("id").eq("id", projectId).eq("agency_id", userId).maybeSingle(),
      supabase.from("partnerships").select("id").eq("id", partnershipId).eq("agency_id", userId).maybeSingle(),
    ])
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 })
    if (!partnership) return NextResponse.json({ error: "Partnership not found" }, { status: 404 })

    const { data: assignment } = await supabase
      .from("project_assignments")
      .select("id")
      .eq("project_id", projectId)
      .eq("partnership_id", partnershipId)
      .maybeSingle()

    let responseId: string | null = null
    if (requestedResponseId) {
      const { data: responseRow } = await supabase
        .from("partner_rfp_responses")
        .select("id")
        .eq("id", requestedResponseId)
        .eq("agency_id", userId)
        .maybeSingle()
      responseId = responseRow ? (responseRow.id as string) : null
    }

    const reviewPatch: Record<string, unknown> = {
      project_id: projectId,
      partnership_id: partnershipId,
      agency_id: userId,
      assignment_id: assignment?.id ?? null,
      status,
      on_time: pickEnum(summaryInput.on_time, ON_TIME_VALUES),
      on_time_notes: pickText(summaryInput.on_time_notes),
      on_budget: pickEnum(summaryInput.on_budget, ON_BUDGET_VALUES),
      budget_variance_pct: pickNumber(summaryInput.budget_variance_pct, -999, 999),
      on_budget_notes: pickText(summaryInput.on_budget_notes),
      would_work_again: pickEnum(summaryInput.would_work_again, WORK_AGAIN_VALUES),
      overall_satisfaction: pickNumber(summaryInput.overall_satisfaction, 1, 10),
      client_feedback: pickText(summaryInput.client_feedback),
      updated_at: new Date().toISOString(),
    }
    // response_id: only overwrite when the caller sent one this agency owns, or explicitly
    // cleared it - otherwise keep whatever the review already has (won't be set on brand
    // new rows, upsert leaves the column at its schema default of null).
    if (requestedResponseId !== null || body?.response_id === null) {
      reviewPatch.response_id = responseId
    }

    const { data: review, error: reviewUpsertErr } = await supabase
      .from("delivery_reviews")
      .upsert(reviewPatch, { onConflict: "project_id,partnership_id" })
      .select(
        "id, status, composite_score, on_time, on_time_notes, on_budget, budget_variance_pct, on_budget_notes, would_work_again, overall_satisfaction, client_feedback, ai_delta_summary, response_id, assignment_id"
      )
      .single()
    if (reviewUpsertErr) {
      console.error("[api] failure", { route, method: "POST", message: reviewUpsertErr.message })
      return NextResponse.json({ error: "Failed to save delivery review" }, { status: 500 })
    }

    if (scoresInput.length > 0) {
      const criterionIds = scoresInput
        .map((s) => (typeof s.criterion_id === "string" ? s.criterion_id : null))
        .filter((id): id is string => Boolean(id))

      const [{ data: existingScores }, { data: criteriaRows }] = await Promise.all([
        supabase.from("delivery_review_scores").select("criterion_id, weight").eq("review_id", review.id).in("criterion_id", criterionIds),
        supabase.from("bid_scoring_criteria").select("id, default_weight").eq("agency_id", userId).in("id", criterionIds),
      ])
      const existingWeightByCriterion = new Map((existingScores || []).map((s) => [s.criterion_id as string, s.weight as number]))
      const defaultWeightByCriterion = new Map((criteriaRows || []).map((c) => [c.id as string, c.default_weight as number]))

      const rows = scoresInput
        .filter((s): s is Required<Pick<ScoreInput, "criterion_id">> & ScoreInput => typeof s.criterion_id === "string")
        .map((s) => {
          const criterionId = s.criterion_id as string
          const score = pickNumber(s.score, 1, 10)
          const notes = pickText(s.notes)
          const requestedWeight = typeof s.weight === "number" ? s.weight : parseFloat(String(s.weight ?? ""))
          const weight =
            Number.isFinite(requestedWeight) && requestedWeight >= MIN_WEIGHT && requestedWeight <= MAX_WEIGHT
              ? requestedWeight
              : existingWeightByCriterion.get(criterionId) ?? defaultWeightByCriterion.get(criterionId) ?? 1.0
          return { review_id: review.id, criterion_id: criterionId, weight, score, notes }
        })

      if (rows.length > 0) {
        const { error: scoresUpsertErr } = await supabase
          .from("delivery_review_scores")
          .upsert(rows, { onConflict: "review_id,criterion_id" })
        if (scoresUpsertErr) {
          console.error("[api] failure", { route, method: "POST", message: scoresUpsertErr.message })
          return NextResponse.json({ error: "Failed to save delivery review scores" }, { status: 500 })
        }
      }
    }

    const { data: allScores, error: allScoresErr } = await supabase
      .from("delivery_review_scores")
      .select("criterion_id, weight, score, notes")
      .eq("review_id", review.id)
    if (allScoresErr) {
      console.error("[api] failure", { route, method: "POST", message: allScoresErr.message })
      return NextResponse.json({ error: "Failed to load saved delivery review scores" }, { status: 500 })
    }

    const composite = computeCompositeScore(
      (allScores || []).map((s) => ({
        weight: s.weight as number,
        ai_score: null,
        human_score: s.score as number | null,
        is_overridden: true,
      }))
    )

    let aiDeltaSummary: string | null = null
    let comparison = await loadBidDeltaComparison(
      supabase,
      userId,
      (review.response_id as string | null) ?? null,
      (allScores || []).map((s) => ({ criterion_id: s.criterion_id as string, score: s.score as number | null }))
    )

    // Unlike the other AI-gated endpoints, an exhausted usage limit here does not block the
    // request (this is a delivery-review save; the AI delta summary is an optional side
    // effect of it, not the thing the caller is asking for) - it just skips generating the
    // summary, same as any other best-effort failure of this block already does.
    const usageCheck = status === "complete" && comparison.hasEvaluation
      ? await checkUsageLimit(agencyEntitlementId(userId), supabase, "ai_analyses")
      : null
    if (status === "complete" && comparison.hasEvaluation && usageCheck?.allowed) {
      const { data: evalRow } = await supabase
        .from("bid_evaluations")
        .select("composite_score")
        .eq("response_id", review.response_id)
        .eq("agency_id", userId)
        .maybeSingle()
      const bidComposite = evalRow?.composite_score as number | null

      const tableLines = comparison.rows.map(
        (r) => `- ${r.criterion_name}: bid ${r.bid_score}/10, delivery ${r.delivery_score}/10, delta ${r.delta > 0 ? "+" : ""}${r.delta}`
      )
      const userContent = [
        bidComposite != null ? `Bid evaluation composite score: ${bidComposite}/100.` : "",
        composite != null ? `Delivery review composite score: ${composite}/100.` : "",
        "",
        "Per-criterion comparison (bid score at award time vs. actual delivery score):",
        tableLines.length > 0 ? tableLines.join("\n") : "No matching per-criterion scores on both sides.",
      ]
        .filter(Boolean)
        .join("\n")

      const result = await callAnthropicAnalysis({
        systemPrompt: DELTA_SYSTEM_PROMPT,
        userContent,
        maxTokens: 800,
      })
      if (result.success) {
        aiDeltaSummary = result.text.trim()
        await incrementAiAnalysis(agencyEntitlementId(userId), supabase)
      }
    }

    const reviewPatch2: Record<string, unknown> = { composite_score: composite, updated_at: new Date().toISOString() }
    if (aiDeltaSummary) reviewPatch2.ai_delta_summary = aiDeltaSummary

    const { data: updatedReview, error: finalUpdateErr } = await supabase
      .from("delivery_reviews")
      .update(reviewPatch2)
      .eq("id", review.id)
      .select(
        "id, status, composite_score, on_time, on_time_notes, on_budget, budget_variance_pct, on_budget_notes, would_work_again, overall_satisfaction, client_feedback, ai_delta_summary, response_id, assignment_id"
      )
      .single()
    if (finalUpdateErr) {
      console.error("[api] failure", { route, method: "POST", message: finalUpdateErr.message })
      return NextResponse.json({ error: "Failed to save delivery review" }, { status: 500 })
    }

    return NextResponse.json({ review: updatedReview, scores: allScores || [], comparison })
  } catch (error) {
    console.error("[api] failure", {
      route: "/api/agency/delivery-reviews",
      method: "POST",
      code: 500,
      message: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: "Failed to save delivery review" }, { status: 500 })
  }
}
