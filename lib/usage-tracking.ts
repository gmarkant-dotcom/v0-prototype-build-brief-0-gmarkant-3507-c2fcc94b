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
 * is_paid) - defaults every new monthly row to "starter" until a real
 * billing/Stripe-driven tier lookup exists. Tracking-only: never blocks the caller.
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

  const defaultTier: PlanTier = "starter"
  const { data: created, error } = await supabase
    .from("usage_tracking")
    .upsert(
      {
        agency_id: agencyId,
        month_start: monthStart,
        ai_analyses_count: 0,
        plan_tier: defaultTier,
        analyses_limit: getPlanLimits(defaultTier).analysesLimit,
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
  projects: { count: number; limit: number; percentage: number }
  analyses: { count: number; limit: number; percentage: number }
  nearProjectLimit: boolean
  nearAnalysisLimit: boolean
  atProjectLimit: boolean
  atAnalysisLimit: boolean
}

function percentageOf(count: number, limit: number): number {
  if (!Number.isFinite(limit) || limit <= 0) return 0
  return Math.round((count / limit) * 100)
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
    projects: { count: projectsCount, limit: projectsLimit, percentage: projectsPct },
    analyses: { count: analysesCount, limit: analysesLimit, percentage: analysesPct },
    nearProjectLimit: projectsPct > 80,
    nearAnalysisLimit: analysesPct > 80,
    atProjectLimit: Number.isFinite(projectsLimit) && projectsCount >= projectsLimit,
    atAnalysisLimit: Number.isFinite(analysesLimit) && analysesCount >= analysesLimit,
  }
}
