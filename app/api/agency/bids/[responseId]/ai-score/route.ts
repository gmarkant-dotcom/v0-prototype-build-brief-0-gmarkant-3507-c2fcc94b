import { NextResponse } from "next/server"
import { resolveRfpRubricForResponse, writeRfpCriterionScores } from "@/lib/rfp-evaluation-criteria-server"
import { parseSyntheticCriterionId, toSyntheticCriterionId } from "@/lib/rfp-evaluation-criteria"
import { createClient } from "@/lib/supabase/server"
import { callAnthropicAnalysis, tryParseJsonObject } from "@/lib/ai-bid-analysis"
import { loadBidAnalysisContext, formatBidContextForPrompt } from "@/lib/bid-analysis-context"
import { computeCompositeScore } from "@/lib/bid-scoring"
import { checkUsageLimit, incrementAiAnalysis, usageLimitResponse } from "@/lib/usage-tracking"
import { agencyEntitlementId, resolveCallerOrgIds, resolveCallerWriteOrgId } from "@/lib/entitlements"
export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

const SCORING_SYSTEM_PROMPT =
  "You are evaluating a vendor bid for a creative/production agency procurement decision. Score each criterion 1-10 with a specific, evidence-based rationale. Reference actual content from the bid when possible. If information is insufficient to score a criterion, score it 5 (neutral) and explain what's missing. Respond as JSON: { scores: [{ criterion_name, score, rationale }] }. Return ONLY the JSON object, no markdown, no preamble."

type Criterion = { id: string; name: string; description: string | null; default_weight: number }
type AiScoreEntry = { criterion_name?: unknown; score?: unknown; rationale?: unknown }
type AiScoreResponse = { scores?: unknown }

async function loadVendorTrackRecord(
  supabase: Awaited<ReturnType<typeof createClient>>,
  agencyId: string,
  partnerId: string | null,
  currentResponseId: string
): Promise<string> {
  if (!partnerId) {
    return "Vendor track record: this is a guest/unlinked submission with no vendor account, so no prior history is available."
  }

  const { data: partnerships } = await supabase
    .from("partnerships")
    .select("id")
    .eq("lead_org_id", agencyId)
    .eq("vendor_org_id", partnerId)
  const partnershipIds = (partnerships || []).map((p) => p.id as string)

  let assignmentCount = 0
  let awardedCount = 0
  if (partnershipIds.length > 0) {
    const [{ count: total }, { count: awarded }] = await Promise.all([
      supabase
        .from("project_assignments")
        .select("id", { count: "exact", head: true })
        .in("partnership_id", partnershipIds),
      supabase
        .from("project_assignments")
        .select("id", { count: "exact", head: true })
        .in("partnership_id", partnershipIds)
        .in("status", ["awarded", "completed"]),
    ])
    assignmentCount = total ?? 0
    awardedCount = awarded ?? 0
  }

  const { data: pastEvals } = await supabase
    .from("bid_evaluations")
    .select("composite_score, response_id, partner_rfp_responses!inner(vendor_org_id, lead_org_id)")
    .eq("partner_rfp_responses.lead_org_id", agencyId)
    .eq("partner_rfp_responses.vendor_org_id", partnerId)
    .neq("response_id", currentResponseId)
    .not("composite_score", "is", null)

  const pastScores = (pastEvals || [])
    .map((e) => e.composite_score as number | null)
    .filter((s): s is number => s != null)
  const avgPastScore =
    pastScores.length > 0 ? Math.round((pastScores.reduce((a, b) => a + b, 0) / pastScores.length) * 10) / 10 : null

  // Delivery Performance (Phase 3): actual post-project outcomes, not just prior bid
  // scores - lets the "Vendor Track Record" criterion reference real delivery history
  // (average delivery score, on-time rate, bid-vs-delivery accuracy) instead of only
  // predicted/scored bids.
  let deliveryText = ""
  if (partnershipIds.length > 0) {
    const { data: reviews } = await supabase
      .from("delivery_reviews")
      .select("composite_score, on_time, response_id")
      .in("partnership_id", partnershipIds)
      .eq("status", "complete")
      .neq("response_id", currentResponseId)
    const completedReviews = reviews || []

    const deliveryScores = completedReviews
      .map((r) => r.composite_score as number | null)
      .filter((s): s is number => s != null)
    const avgDeliveryScore =
      deliveryScores.length > 0 ? Math.round((deliveryScores.reduce((a, b) => a + b, 0) / deliveryScores.length) * 10) / 10 : null

    const onTimeCount = completedReviews.filter((r) => r.on_time === "yes").length
    const onTimeRate = completedReviews.length > 0 ? Math.round((onTimeCount / completedReviews.length) * 100) : null

    const deliveryResponseIds = completedReviews
      .map((r) => r.response_id as string | null)
      .filter((id): id is string => Boolean(id))
    let avgDelta: number | null = null
    if (deliveryResponseIds.length > 0) {
      const { data: evalRows } = await supabase
        .from("bid_evaluations")
        .select("response_id, composite_score")
        .in("response_id", deliveryResponseIds)
      const bidCompositeByResponse = new Map(
        (evalRows || []).map((e) => [e.response_id as string, e.composite_score as number | null])
      )
      const deltas: number[] = []
      for (const r of completedReviews) {
        const bidScore = r.response_id ? bidCompositeByResponse.get(r.response_id as string) : null
        if (bidScore != null && r.composite_score != null) deltas.push((r.composite_score as number) - bidScore)
      }
      avgDelta = deltas.length > 0 ? Math.round((deltas.reduce((a, b) => a + b, 0) / deltas.length) * 10) / 10 : null
    }

    if (deliveryScores.length > 0) {
      const deliveryParts = [`${deliveryScores.length} completed delivery review(s), average delivery score ${avgDeliveryScore}/100`]
      if (onTimeRate != null) deliveryParts.push(`on-time rate ${onTimeRate}%`)
      if (avgDelta != null) {
        deliveryParts.push(
          `bids have historically scored ${Math.abs(avgDelta)} points ${avgDelta >= 0 ? "below" : "above"} actual delivery performance on average`
        )
      }
      deliveryText = ` Delivery performance history: ${deliveryParts.join("; ")}.`
    }
  }

  if (assignmentCount === 0 && pastScores.length === 0 && !deliveryText) {
    return "Vendor track record: no prior project assignments or evaluations with this agency - this appears to be a new relationship."
  }

  const parts = [`${assignmentCount} past project assignment(s) with this agency (${awardedCount} awarded/completed)`]
  if (pastScores.length > 0) {
    parts.push(`${pastScores.length} prior evaluation(s), average composite score ${avgPastScore}/100`)
  }
  return `Vendor track record: ${parts.join("; ")}.${deliveryText}`
}

export async function POST(req: Request, { params }: { params: Promise<{ responseId: string }> }) {
  const route = "/api/agency/bids/[responseId]/ai-score"
  try {
    const { responseId } = await params
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    // 079: an organization column is not a user id. Reads scope to the caller's memberships.
    const callerOrgIds = await resolveCallerOrgIds(user.id, supabase)
    // 079: a write is attributed to the caller's OWN organization. Never a visibility set.
    const writeOrgId = await resolveCallerWriteOrgId(user.id, supabase)
    if (!writeOrgId) {
      return NextResponse.json({ error: "Your account is not linked to an organization yet" }, { status: 403 })
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, active_role")
      .eq("id", user.id)
      .single()
    if (profile?.role !== "agency" && profile?.active_role !== "agency") {
      return NextResponse.json({ error: "Agency only" }, { status: 403 })
    }

    const usageCheck = await checkUsageLimit(await agencyEntitlementId(user.id, supabase), supabase, "ai_analyses")
    if (!usageCheck.allowed) return usageLimitResponse(usageCheck)

    const { data: response, error: responseErr } = await supabase
      .from("partner_rfp_responses")
      .select("id, vendor_org_id")
      .eq("id", responseId)
      .in("lead_org_id", callerOrgIds)
      .maybeSingle()
    if (responseErr) {
      console.error("[api] failure", { route, method: "POST", message: responseErr.message })
      return NextResponse.json({ error: "Failed to load bid" }, { status: 500 })
    }
    if (!response) return NextResponse.json({ error: "Bid not found" }, { status: 404 })

    const { data: criteria, error: criteriaErr } = await supabase
      .from("bid_scoring_criteria")
      .select("id, name, description, default_weight")
      .in("org_id", callerOrgIds)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
    if (criteriaErr) {
      console.error("[api] failure", { route, method: "POST", message: criteriaErr.message })
      return NextResponse.json({ error: "Failed to load scoring criteria" }, { status: 500 })
    }
    // P2-3. The model must score against the rubric the agency actually wrote for this RFP,
    // not against the seven built-in dimensions. Empty rubric means the global criteria above,
    // which is every legacy RFP and every RFP before migration 075.
    const rubric = await resolveRfpRubricForResponse(supabase, responseId, user.id)
    const usingRfpRubric = rubric.length > 0
    const activeCriteria: Criterion[] = usingRfpRubric
      ? rubric.map((c) => ({
          id: toSyntheticCriterionId(c.key),
          name: c.name,
          description: c.description || null,
          default_weight: c.weight,
        }))
      : ((criteria || []) as Criterion[])
    if (activeCriteria.length === 0) {
      return NextResponse.json({ error: "No active scoring criteria - add criteria in Scoring Settings first" }, { status: 400 })
    }

    // Create the evaluation row up front (idempotent via upsert on response_id) so a
    // "Generate AI Scores" click always has somewhere to attach scores, even if the
    // agency skipped "Start Evaluation" (which does the same upsert with an empty body).
    const { data: evaluation, error: evalUpsertErr } = await supabase
      .from("bid_evaluations")
      .upsert(
        { response_id: responseId, org_id: writeOrgId, status: "in_progress", updated_at: new Date().toISOString() },
        { onConflict: "response_id", ignoreDuplicates: false }
      )
      .select("id, status")
      .single()
    if (evalUpsertErr) {
      console.error("[api] failure", { route, method: "POST", message: evalUpsertErr.message })
      return NextResponse.json({ error: "Failed to start evaluation" }, { status: 500 })
    }
    // Upsert above overwrites status unconditionally - restore it if the evaluation was
    // already further along (e.g. already 'complete') and this is just a rescore.
    if (evaluation.status !== "in_progress") {
      await supabase
        .from("bid_evaluations")
        .update({ status: evaluation.status })
        .eq("id", evaluation.id)
    }

    const ctx = await loadBidAnalysisContext(supabase, responseId, user.id)
    if (!ctx) return NextResponse.json({ error: "Bid not found" }, { status: 404 })
    const bidContext = formatBidContextForPrompt(ctx)

    const { data: decomposition } = await supabase
      .from("bid_decompositions")
      .select("narrative_summary, line_items")
      .eq("response_id", responseId)
      .in("org_id", callerOrgIds)
      .maybeSingle()

    const trackRecord = await loadVendorTrackRecord(supabase, user.id, (response.vendor_org_id as string) || null, responseId)

    const criteriaList = activeCriteria
      .map((c, i) => `${i + 1}. ${c.name}: ${c.description || "No description provided."}`)
      .join("\n")

    const userContent = [
      bidContext,
      "",
      trackRecord,
      decomposition?.narrative_summary ? `\nCost structure notes: ${decomposition.narrative_summary}` : "",
      "",
      "Score each of the following criteria. Use the exact criterion_name as given here:",
      criteriaList,
    ]
      .filter(Boolean)
      .join("\n")

    // No retry on malformed JSON: two 55s-timeout calls would not fit inside this route's
    // 60s maxDuration anyway, so fail fast and let the agency click "Regenerate AI Scores"
    // (components/bid-evaluation-tab.tsx) instead of burning the function budget on a
    // second attempt that could never complete in time.
    const result = await callAnthropicAnalysis({
      systemPrompt: SCORING_SYSTEM_PROMPT,
      userContent,
      maxTokens: 4000,
      timeoutMs: 55_000,
    })
    const parsed = result.success ? tryParseJsonObject<AiScoreResponse>(result.text) : null

    if (!result.success || !parsed || !Array.isArray(parsed.scores)) {
      console.error("[api] failure", { route, method: "POST", responseId, message: "AI scoring parse failed" })
      return NextResponse.json({ error: "AI scoring failed, please try again." }, { status: 502 })
    }

    // Preserve any weight the agency already customized for this evaluation - a
    // (re)generate must never silently reset a per-evaluation weight override back to
    // the criterion's agency-wide default.
    const { data: existingWeightRows } = await supabase
      .from("bid_evaluation_scores")
      .select(usingRfpRubric ? "rfp_criterion_key, weight" : "criterion_id, weight")
      .eq("evaluation_id", evaluation.id)
    // Keyed by the same synthetic id activeCriteria carries, so the "never reset a customized
    // weight" rule below works identically for both rubric kinds.
    const existingWeightByCriterion = new Map(
      ((existingWeightRows || []) as unknown as Record<string, unknown>[]).map((r) => [
        usingRfpRubric ? toSyntheticCriterionId(r.rfp_criterion_key as string) : (r.criterion_id as string),
        r.weight as number,
      ])
    )

    const criteriaByName = new Map(activeCriteria.map((c) => [c.name.trim().toLowerCase(), c]))
    const now = new Date().toISOString()
    const scoreRows: { criterion_id: string; weight: number; ai_score: number; ai_rationale: string }[] = []
    for (const entry of parsed.scores as AiScoreEntry[]) {
      if (!entry || typeof entry !== "object") continue
      const name = String(entry.criterion_name ?? "").trim().toLowerCase()
      const criterion = criteriaByName.get(name)
      if (!criterion) continue
      const scoreNum = typeof entry.score === "number" ? entry.score : parseFloat(String(entry.score ?? ""))
      if (!Number.isFinite(scoreNum)) continue
      const clamped = Math.min(10, Math.max(1, scoreNum))
      scoreRows.push({
        criterion_id: criterion.id,
        weight: existingWeightByCriterion.get(criterion.id) ?? criterion.default_weight,
        ai_score: clamped,
        ai_rationale: String(entry.rationale ?? "").trim(),
      })
    }

    if (scoreRows.length === 0) {
      console.error("[api] failure", { route, method: "POST", responseId, message: "no criterion names matched AI response" })
      return NextResponse.json({ error: "AI scoring failed, please try again." }, { status: 502 })
    }

    // A per-RFP score is stored under rfp_criterion_key, never under a bid_scoring_criteria
    // uuid - see migration 075's header for why borrowing one would corrupt cross-RFP math.
    const nameByKey = new Map(rubric.map((c) => [c.key, c.name]))
    // S1: the per-RFP half cannot use PostgREST's on_conflict - 075 backs it with a PARTIAL
    // unique index, which Postgres refuses as an ON CONFLICT arbiter without its predicate.
    // Probed live: 42P10. Only ai_score/ai_rationale are sent, so a rescore never blanks a
    // human score a reviewer already entered. See writeRfpCriterionScores.
    const { error: upsertErr } = usingRfpRubric
      ? await writeRfpCriterionScores(
          supabase,
          evaluation.id,
          scoreRows.map((s) => {
            const key = parseSyntheticCriterionId(s.criterion_id) as string
            return {
              rfp_criterion_key: key,
              criterion_name_snapshot: nameByKey.get(key) ?? null,
              weight: s.weight,
              ai_score: s.ai_score,
              ai_rationale: s.ai_rationale,
            }
          })
        ).then((r) => ({ error: r.error ? { message: r.error } : null }))
      : await supabase.from("bid_evaluation_scores").upsert(
          scoreRows.map((s) => ({
            evaluation_id: evaluation.id,
            criterion_id: s.criterion_id,
            weight: s.weight,
            ai_score: s.ai_score,
            ai_rationale: s.ai_rationale,
          })),
          { onConflict: "evaluation_id,criterion_id" }
        )
    if (upsertErr) {
      console.error("[api] failure", { route, method: "POST", responseId, message: upsertErr.message })
      return NextResponse.json({ error: "Failed to save AI scores" }, { status: 500 })
    }

    const { data: allScores, error: allScoresErr } = await supabase
      .from("bid_evaluation_scores")
      .select("criterion_id, weight, ai_score, ai_rationale, human_score, human_notes, is_overridden")
      .eq("evaluation_id", evaluation.id)
    if (allScoresErr) {
      console.error("[api] failure", { route, method: "POST", responseId, message: allScoresErr.message })
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

    await Promise.all([
      supabase.from("bid_evaluations").update({ composite_score: composite, updated_at: now }).eq("id", evaluation.id),
      supabase.from("partner_rfp_responses").update({ composite_score: composite }).eq("id", responseId),
    ])

    await incrementAiAnalysis(await agencyEntitlementId(user.id, supabase), supabase)
    return NextResponse.json({ scores: allScores || [], composite_score: composite })
  } catch (error) {
    console.error("[api] failure", {
      route: "/api/agency/bids/[responseId]/ai-score",
      method: "POST",
      code: 500,
      message: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: "AI scoring failed, please try again." }, { status: 500 })
  }
}
