import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { callAnthropicAnalysis } from "@/lib/ai-bid-analysis"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 45

const RELIABILITY_SYSTEM_PROMPT =
  "Summarize this vendor's reliability based on their project history with this agency. Include: average performance, strongest and weakest criteria, bid-to-delivery accuracy, consistency trends. Keep it to 3-4 sentences. Be specific with numbers."

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

type DeliveryReviewRow = {
  id: string
  project_id: string
  status: string
  composite_score: number | null
  on_time: string | null
  on_budget: string | null
  overall_satisfaction: number | null
  would_work_again: string | null
  response_id: string | null
  updated_at: string
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ partnerId: string }> }) {
  const route = "/api/agency/pool/[partnerId]/performance"
  try {
    const { partnerId } = await params
    const auth = await requireAgency()
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
    const { supabase, userId } = auth
    const forceRegenerate = req.nextUrl.searchParams.get("force") === "1"

    const { data: partnership, error: partnershipErr } = await supabase
      .from("partnerships")
      .select("id, reliability_summary, reliability_summary_generated_at")
      .eq("agency_id", userId)
      .eq("partner_id", partnerId)
      .eq("status", "active")
      .maybeSingle()
    if (partnershipErr) {
      console.error("[api] failure", { route, method: "GET", message: partnershipErr.message })
      return NextResponse.json({ error: "Failed to load partnership" }, { status: 500 })
    }
    if (!partnership) return NextResponse.json({ error: "No active partnership with this partner" }, { status: 404 })

    // Performance History is a completed track record, not a drafting surface (drafts and
    // in-progress reviews are authored on the Delivery Performance page instead) - filtered
    // at the query itself so the review list and every aggregate below derive from the exact
    // same "complete" set. Previously the list rendered every status while the aggregates
    // silently filtered to "complete", which could show a fully-filled-in but not-yet-marked-
    // complete review card above a "Based on 0 completed reviews" / all-dashes stats row -
    // same class of bug as the milestone "paid" vs "payment_received" status mismatch, though
    // here the two sides disagreed on which STATUSES to include rather than on a wrong literal.
    const { data: reviewRows, error: reviewsErr } = await supabase
      .from("delivery_reviews")
      .select("id, project_id, status, composite_score, on_time, on_budget, overall_satisfaction, would_work_again, response_id, updated_at")
      .eq("agency_id", userId)
      .eq("partnership_id", partnership.id)
      .eq("status", "complete")
      .order("updated_at", { ascending: false })
    if (reviewsErr) {
      console.error("[api] failure", { route, method: "GET", message: reviewsErr.message })
      return NextResponse.json({ error: "Failed to load delivery reviews" }, { status: 500 })
    }
    const reviews = (reviewRows || []) as DeliveryReviewRow[]

    const projectIds = [...new Set(reviews.map((r) => r.project_id))]
    const projectNameById = new Map<string, string>()
    if (projectIds.length > 0) {
      const { data: projRows } = await supabase.from("projects").select("id, name").eq("agency_id", userId).in("id", projectIds)
      for (const p of projRows || []) projectNameById.set(p.id as string, (p.name as string) || "Project")
    }

    const responseIds = [...new Set(reviews.map((r) => r.response_id).filter((id): id is string => Boolean(id)))]
    const bidCompositeByResponse = new Map<string, number>()
    if (responseIds.length > 0) {
      const { data: evalRows } = await supabase
        .from("bid_evaluations")
        .select("response_id, composite_score")
        .eq("agency_id", userId)
        .in("response_id", responseIds)
      for (const e of evalRows || []) {
        const score = e.composite_score as number | null
        if (score != null) bidCompositeByResponse.set(e.response_id as string, score)
      }
    }

    const reviewsOut = reviews.map((r) => {
      const bidCompositeScore = r.response_id ? bidCompositeByResponse.get(r.response_id) ?? null : null
      const delta = bidCompositeScore != null && r.composite_score != null ? Math.round((r.composite_score - bidCompositeScore) * 10) / 10 : null
      return {
        id: r.id,
        project_id: r.project_id,
        project_name: projectNameById.get(r.project_id) || "Project",
        status: r.status,
        composite_score: r.composite_score,
        on_time: r.on_time,
        on_budget: r.on_budget,
        overall_satisfaction: r.overall_satisfaction,
        would_work_again: r.would_work_again,
        response_id: r.response_id,
        bid_composite_score: bidCompositeScore,
        delta,
        updated_at: r.updated_at,
      }
    })

    // reviews / reviewsOut are already status="complete" only (filtered at the query above),
    // so the list and every aggregate below derive from the exact same set - no second filter.
    const deliveryScores = reviews.map((r) => r.composite_score).filter((s): s is number => s != null)
    const avgDeliveryScore = deliveryScores.length > 0 ? Math.round((deliveryScores.reduce((a, b) => a + b, 0) / deliveryScores.length) * 10) / 10 : null

    const deltas = reviewsOut.map((r) => r.delta).filter((d): d is number => d != null)
    const avgDelta = deltas.length > 0 ? Math.round((deltas.reduce((a, b) => a + b, 0) / deltas.length) * 10) / 10 : null

    const onTimeCount = reviews.filter((r) => r.on_time === "yes").length
    const onTimeRate = reviews.length > 0 ? Math.round((onTimeCount / reviews.length) * 100) : null

    const wouldWorkAgainCount = reviews.filter((r) => r.would_work_again === "yes" || r.would_work_again === "likely").length
    const wouldWorkAgainRate = reviews.length > 0 ? Math.round((wouldWorkAgainCount / reviews.length) * 100) : null

    const stats = {
      total_projects_reviewed: reviews.length,
      avg_delivery_score: avgDeliveryScore,
      avg_bid_to_delivery_delta: avgDelta,
      on_time_rate: onTimeRate,
      would_work_again_rate: wouldWorkAgainRate,
    }

    let reliabilitySummary = (partnership.reliability_summary as string | null) ?? null
    let reliabilitySummaryGeneratedAt = (partnership.reliability_summary_generated_at as string | null) ?? null

    const latestCompletedAt = reviews.reduce<string | null>((max, r) => {
      if (!max || r.updated_at > max) return r.updated_at
      return max
    }, null)
    const isStale =
      latestCompletedAt != null && (!reliabilitySummaryGeneratedAt || reliabilitySummaryGeneratedAt < latestCompletedAt)

    if (reviews.length > 0 && (forceRegenerate || !reliabilitySummary || isStale)) {
      const reviewIds = reviews.map((r) => r.id)
      const { data: scoreRows } = await supabase
        .from("delivery_review_scores")
        .select("criterion_id, score")
        .in("review_id", reviewIds)
      const criterionIds = [...new Set((scoreRows || []).map((s) => s.criterion_id as string))]
      const nameByCriterion = new Map<string, string>()
      if (criterionIds.length > 0) {
        const { data: criteriaRows } = await supabase.from("bid_scoring_criteria").select("id, name").in("id", criterionIds)
        for (const c of criteriaRows || []) nameByCriterion.set(c.id as string, c.name as string)
      }
      const scoresByCriterion = new Map<string, number[]>()
      for (const s of scoreRows || []) {
        const score = s.score as number | null
        if (score == null) continue
        const key = s.criterion_id as string
        const list = scoresByCriterion.get(key) ?? []
        list.push(score)
        scoresByCriterion.set(key, list)
      }
      const criterionAverages = [...scoresByCriterion.entries()]
        .map(([criterionId, scores]) => ({
          name: nameByCriterion.get(criterionId) || "Criterion",
          avg: Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10,
          n: scores.length,
        }))
        .sort((a, b) => b.avg - a.avg)

      const userContentLines = [
        `Total projects reviewed: ${stats.total_projects_reviewed}`,
        stats.avg_delivery_score != null ? `Average delivery composite score: ${stats.avg_delivery_score}/100` : "",
        stats.avg_bid_to_delivery_delta != null
          ? `Average bid-to-delivery delta: ${stats.avg_bid_to_delivery_delta > 0 ? "+" : ""}${stats.avg_bid_to_delivery_delta} points`
          : "No bid evaluations to compare against actual delivery.",
        stats.on_time_rate != null ? `On-time rate: ${stats.on_time_rate}%` : "",
        stats.would_work_again_rate != null ? `Would work again rate: ${stats.would_work_again_rate}%` : "",
        "",
        "Per-criterion averages across all reviewed projects:",
        ...criterionAverages.map((c) => `- ${c.name}: ${c.avg}/10 (${c.n} review${c.n !== 1 ? "s" : ""})`),
        "",
        "Delivery composite score by project, most recent first:",
        ...reviewsOut.map((r) => `- ${r.project_name}: ${r.composite_score ?? "unscored"}/100`),
      ].filter(Boolean)

      const result = await callAnthropicAnalysis({
        systemPrompt: RELIABILITY_SYSTEM_PROMPT,
        userContent: userContentLines.join("\n"),
        maxTokens: 500,
      })
      if (result.success) {
        reliabilitySummary = result.text.trim()
        reliabilitySummaryGeneratedAt = new Date().toISOString()
        const { error: updateErr } = await supabase
          .from("partnerships")
          .update({ reliability_summary: reliabilitySummary, reliability_summary_generated_at: reliabilitySummaryGeneratedAt })
          .eq("id", partnership.id)
        if (updateErr) {
          console.error("[api] failure", { route, method: "GET", message: updateErr.message, code: "cache_reliability_summary" })
        }
      }
    }

    return NextResponse.json({
      reviews: reviewsOut,
      stats,
      reliability_summary: reliabilitySummary,
      reliability_summary_generated_at: reliabilitySummaryGeneratedAt,
    })
  } catch (error) {
    console.error("[api] failure", {
      route: "/api/agency/pool/[partnerId]/performance",
      method: "GET",
      code: 500,
      message: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: "Failed to load performance history" }, { status: 500 })
  }
}
