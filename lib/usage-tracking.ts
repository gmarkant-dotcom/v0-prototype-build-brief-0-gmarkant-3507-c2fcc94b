import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

export type PlanTier = "starter" | "professional" | "enterprise"

export type PlanLimits = {
  projectsLimit: number
  analysesLimit: number
}

const PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
  starter: { projectsLimit: 5, analysesLimit: 50 },
  professional: { projectsLimit: 20, analysesLimit: 250 },
  enterprise: { projectsLimit: Infinity, analysesLimit: Infinity },
}

export function getPlanLimits(tier: string | null | undefined): PlanLimits {
  const key = (tier || "starter") as PlanTier
  return PLAN_LIMITS[key] ?? PLAN_LIMITS.starter
}

function currentMonthStart(): string {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10)
}

type UsageRow = {
  id: string
  agency_id: string
  month_start: string
  ai_analyses_count: number
  plan_tier: string
  analyses_limit: number
}

/**
 * There is no persisted plan-tier field anywhere yet (profiles only has a boolean
 * is_paid) - usage_tracking.plan_tier is it, until a real billing/Stripe-driven tier
 * lookup exists. Tracking-only: never blocks the caller.
 */
export async function getOrCreateMonthlyUsage(
  agencyId: string,
  supabase: SupabaseServerClient
): Promise<UsageRow> {
  const monthStart = currentMonthStart()

  const { data: existing } = await supabase
    .from("usage_tracking")
    .select("id, agency_id, month_start, ai_analyses_count, plan_tier, analyses_limit")
    .eq("agency_id", agencyId)
    .eq("month_start", monthStart)
    .maybeSingle()
  if (existing) return existing as UsageRow

  // Carry forward the agency's most recent prior tier rather than resetting to Starter
  // every month - without this, an agency ever moved onto a paid tier would silently drop
  // back to Starter limits the moment next month's row gets created. Only a brand new
  // agency with no usage_tracking history at all falls back to the Starter default.
  const { data: priorRow } = await supabase
    .from("usage_tracking")
    .select("plan_tier")
    .eq("agency_id", agencyId)
    .lt("month_start", monthStart)
    .order("month_start", { ascending: false })
    .limit(1)
    .maybeSingle()
  const tier: PlanTier = (priorRow?.plan_tier as PlanTier) || "starter"

  const { data: created, error } = await supabase
    .from("usage_tracking")
    .upsert(
      {
        agency_id: agencyId,
        month_start: monthStart,
        ai_analyses_count: 0,
        plan_tier: tier,
        analyses_limit: getPlanLimits(tier).analysesLimit,
      },
      { onConflict: "agency_id,month_start" }
    )
    .select("id, agency_id, month_start, ai_analyses_count, plan_tier, analyses_limit")
    .single()
  if (error || !created) {
    throw new Error(error?.message || "Failed to create monthly usage row")
  }
  return created as UsageRow
}

export async function incrementAiAnalysis(
  agencyId: string,
  supabase: SupabaseServerClient
): Promise<{ count: number; limit: number; remaining: number }> {
  const row = await getOrCreateMonthlyUsage(agencyId, supabase)
  const nextCount = row.ai_analyses_count + 1

  const { data: updated, error } = await supabase
    .from("usage_tracking")
    .update({ ai_analyses_count: nextCount, updated_at: new Date().toISOString() })
    .eq("id", row.id)
    .select("ai_analyses_count, analyses_limit")
    .single()
  if (error || !updated) {
    // Tracking-only: never throw back into an AI response path over a usage-counter write.
    console.error("[usage-tracking] failed to increment analysis count", { agencyId, message: error?.message })
    return { count: row.ai_analyses_count, limit: row.analyses_limit, remaining: Math.max(0, row.analyses_limit - row.ai_analyses_count) }
  }

  const limit = updated.analyses_limit as number
  const count = updated.ai_analyses_count as number
  return { count, limit, remaining: Number.isFinite(limit) ? Math.max(0, limit - count) : Infinity }
}

export async function getActiveProjectsCount(
  agencyId: string,
  supabase: SupabaseServerClient
): Promise<{ count: number; limit: number }> {
  const { count } = await supabase
    .from("projects")
    .select("id", { count: "exact", head: true })
    .eq("agency_id", agencyId)
    .not("status", "in", "(completed,archived)")

  const usage = await getOrCreateMonthlyUsage(agencyId, supabase)
  const limit = getPlanLimits(usage.plan_tier).projectsLimit
  return { count: count ?? 0, limit }
}

export type UsageLimitsSummary = {
  tier: PlanTier
  projects: { count: number; limit: number | null; percentage: number }
  analyses: { count: number; limit: number | null; percentage: number; resetDate: string }
  nearProjectLimit: boolean
  nearAnalysisLimit: boolean
  atProjectLimit: boolean
  atAnalysisLimit: boolean
}

function percentageOf(count: number, limit: number): number {
  if (!Number.isFinite(limit) || limit <= 0) return 0
  return Math.round((count / limit) * 100)
}

/** First of next calendar month (UTC) - usage_tracking rows are keyed by month_start, so
 *  this is when ai_analyses_count next resets to 0 for a fresh row. */
function nextMonthStartIso(): string {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString()
}

export async function checkUsageLimits(
  agencyId: string,
  supabase: SupabaseServerClient
): Promise<UsageLimitsSummary> {
  const usage = await getOrCreateMonthlyUsage(agencyId, supabase)
  const { count: projectsCount, limit: projectsLimit } = await getActiveProjectsCount(agencyId, supabase)

  const analysesCount = usage.ai_analyses_count
  const analysesLimit = usage.analyses_limit

  const projectsPct = percentageOf(projectsCount, projectsLimit)
  const analysesPct = percentageOf(analysesCount, analysesLimit)

  return {
    tier: (usage.plan_tier as PlanTier) || "starter",
    // NextResponse.json/JSON.stringify already turns Infinity into null on the wire, but
    // typing this as number meant TypeScript never caught a caller treating it as always
    // finite - number | null makes "unlimited" explicit end to end.
    projects: {
      count: projectsCount,
      limit: Number.isFinite(projectsLimit) ? projectsLimit : null,
      percentage: projectsPct,
    },
    analyses: {
      count: analysesCount,
      limit: Number.isFinite(analysesLimit) ? analysesLimit : null,
      percentage: analysesPct,
      resetDate: nextMonthStartIso(),
    },
    nearProjectLimit: projectsPct > 80,
    nearAnalysisLimit: analysesPct > 80,
    atProjectLimit: Number.isFinite(projectsLimit) && projectsCount >= projectsLimit,
    atAnalysisLimit: Number.isFinite(analysesLimit) && analysesCount >= analysesLimit,
  }
}

export type UsageMetric = "ai_analyses" | "projects"

export type UsageLimitCheck = {
  allowed: boolean
  metric: UsageMetric
  current: number
  limit: number | null
  percentage: number
  tier: PlanTier
}

/**
 * Single-metric check for gating a specific action (an AI call, a project create) before
 * it runs - distinct from checkUsageLimits' full dashboard summary. Enterprise's Infinity
 * limits make `allowed` always true and `percentage` always 0 here, so callers never need
 * a separate "is this agency on Enterprise" branch.
 *
 * Not atomic with the corresponding increment (incrementAiAnalysis / the project insert
 * that follows this check) - both are a plain check-then-write, same as the rest of this
 * file. Two concurrent requests can both pass the check and both proceed, so the true count
 * can overshoot the limit by (at most, in practice) the number of concurrent requests in
 * flight at the boundary. Accepted for now per explicit product decision - fixing this
 * would mean an atomic SQL increment-with-limit (e.g. an UPDATE ... WHERE count < limit
 * RETURNING, or a Postgres function), which is a real schema-adjacent change, not a
 * pre-check.
 */
export async function checkUsageLimit(
  agencyId: string,
  supabase: SupabaseServerClient,
  metric: UsageMetric
): Promise<UsageLimitCheck> {
  if (metric === "ai_analyses") {
    const usage = await getOrCreateMonthlyUsage(agencyId, supabase)
    return buildUsageLimitCheck(metric, usage.ai_analyses_count, usage.analyses_limit, (usage.plan_tier as PlanTier) || "starter")
  }
  const usage = await getOrCreateMonthlyUsage(agencyId, supabase)
  const { count, limit } = await getActiveProjectsCount(agencyId, supabase)
  return buildUsageLimitCheck(metric, count, limit, (usage.plan_tier as PlanTier) || "starter")
}

function buildUsageLimitCheck(metric: UsageMetric, current: number, limit: number, tier: PlanTier): UsageLimitCheck {
  const unlimited = !Number.isFinite(limit)
  return {
    allowed: unlimited || current < limit,
    metric,
    current,
    limit: unlimited ? null : limit,
    percentage: unlimited ? 0 : percentageOf(current, limit),
    tier,
  }
}

/** Shared 402 body shape for every route gated by checkUsageLimit - call with a check that
 *  already failed (allowed === false). One place for the exact response shape so all eight
 *  gated routes stay byte-for-byte identical. */
export function usageLimitResponse(check: UsageLimitCheck): NextResponse {
  return NextResponse.json(
    {
      error: "usage_limit_reached",
      metric: check.metric,
      current: check.current,
      limit: check.limit,
      tier: check.tier,
    },
    { status: 402 }
  )
}
