import { resolveCallerOrgIds } from "@/lib/entitlements"
import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { callAnthropicAnalysis } from "@/lib/ai-bid-analysis"
import { resolveResponseScope, hashScopeGroup } from "@/lib/bid-analysis-context"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 45

const RANKING_SYSTEM_PROMPT =
  "You are a procurement analyst ranking vendor bids for a creative/production agency. Given each vendor's composite evaluation score (0-100) and any prior AI recommendation, explain the ranking and recommend which vendor to select. Be concise (2-3 sentences) and cite the actual scores. Plain prose, no markdown."

export async function POST(req: Request) {
  const route = "/api/agency/bids/rank"
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    // 079: an organization column is not a user id. Reads scope to the caller's memberships.
    const callerOrgIds = await resolveCallerOrgIds(user.id, supabase)

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, active_role")
      .eq("id", user.id)
      .single()
    if (profile?.role !== "agency" && profile?.active_role !== "agency") {
      return NextResponse.json({ error: "Agency only" }, { status: 403 })
    }

    const body = await req.json().catch(() => ({}))
    const responseIds: string[] = Array.isArray(body?.response_ids)
      ? Array.from(
          new Set(
            (body.response_ids as unknown[]).filter((id): id is string => typeof id === "string" && id.length > 0)
          )
        )
      : []
    const force = body?.force === true

    if (responseIds.length < 2) {
      return NextResponse.json({ error: "At least 2 response_ids are required" }, { status: 400 })
    }

    const { data: owned, error: ownedErr } = await supabase
      .from("partner_rfp_responses")
      .select("id, partner_display_name, composite_score")
      .in("lead_org_id", callerOrgIds)
      .in("id", responseIds)
    if (ownedErr) {
      console.error("[api] failure", { route, method: "POST", message: ownedErr.message })
      return NextResponse.json({ error: "Failed to load bids" }, { status: 500 })
    }
    if ((owned || []).length !== responseIds.length) {
      return NextResponse.json({ error: "One or more bids were not found" }, { status: 404 })
    }

    const scope = await resolveResponseScope(supabase, responseIds[0], callerOrgIds)
    if (!scope?.projectId || !scope.scopeItemName) {
      return NextResponse.json({ error: "Could not resolve scope for ranking" }, { status: 400 })
    }
    const groupHash = hashScopeGroup(scope.projectId, scope.scopeItemName)

    if (!force) {
      const { data: cached } = await supabase
        .from("bid_evaluations")
        .select("ranked_recommendation")
        .in("response_id", responseIds)
        .eq("ranked_recommendation_group", groupHash)
        .not("ranked_recommendation", "is", null)
        .limit(1)
        .maybeSingle()
      if (cached?.ranked_recommendation) {
        return NextResponse.json({ narrative: cached.ranked_recommendation, cached: true })
      }
    }

    const ranked = [...(owned || [])].sort(
      (a, b) => ((b.composite_score as number | null) ?? 0) - ((a.composite_score as number | null) ?? 0)
    )
    const { data: evaluations } = await supabase
      .from("bid_evaluations")
      .select("response_id, ai_recommendation")
      .in("response_id", responseIds)
    const recommendationByResponseId = new Map(
      (evaluations || []).map((e) => [e.response_id as string, e.ai_recommendation as string | null])
    )

    const vendorSummary = ranked
      .map((r, i) => {
        const rec = recommendationByResponseId.get(r.id as string)
        const line = `#${i + 1} ${r.partner_display_name}: ${r.composite_score ?? "unscored"}/100`
        return rec ? `${line}. Prior note: ${rec}` : line
      })
      .join("\n")

    const result = await callAnthropicAnalysis({
      systemPrompt: RANKING_SYSTEM_PROMPT,
      userContent: `Scope: ${scope.scopeItemName}\n\n${vendorSummary}`,
      maxTokens: 400,
    })

    if (!result.success) {
      console.error("[api] failure", { route, method: "POST", message: result.error })
      return NextResponse.json({ error: "Analysis unavailable" }, { status: 502 })
    }

    const topRankedId = ranked[0]?.id as string
    const { error: saveErr } = await supabase
      .from("bid_evaluations")
      .update({
        ranked_recommendation: result.text.trim(),
        ranked_recommendation_group: groupHash,
        updated_at: new Date().toISOString(),
      })
      .eq("response_id", topRankedId)
      .in("org_id", callerOrgIds)
    if (saveErr) {
      console.error("[api] failure", { route, method: "POST", message: saveErr.message })
      return NextResponse.json({ error: "Failed to save ranking" }, { status: 500 })
    }

    return NextResponse.json({ narrative: result.text.trim(), cached: false })
  } catch (error) {
    console.error("[api] failure", {
      route: "/api/agency/bids/rank",
      method: "POST",
      code: 500,
      message: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: "Failed to generate ranking" }, { status: 500 })
  }
}
