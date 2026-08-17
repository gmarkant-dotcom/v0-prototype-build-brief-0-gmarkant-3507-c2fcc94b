import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { callAnthropicAnalysis } from "@/lib/ai-bid-analysis"
import { loadBidAnalysisContext, hashResponseIds } from "@/lib/bid-analysis-context"
import { checkUsageLimit, incrementAiAnalysis, usageLimitResponse } from "@/lib/usage-tracking"
import { agencyEntitlementId } from "@/lib/entitlements"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000

type DecompositionLineItem = { category: string; amount: number; percentage_of_total: number; description: string }

function formatDecompositionForPrompt(vendorName: string, lineItems: DecompositionLineItem[]): string {
  if (lineItems.length === 0) return `${vendorName}: no itemized cost breakdown available.`
  const lines = lineItems.map(
    (li) => `  - ${li.category}: $${li.amount.toLocaleString("en-US")} (${li.percentage_of_total}% of total) - ${li.description || "no description"}`
  )
  return `${vendorName}:\n${lines.join("\n")}`
}

export async function POST(req: Request) {
  const route = "/api/agency/bids/compare"
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, active_role")
      .eq("id", user.id)
      .single()
    if (profile?.role !== "agency" && profile?.active_role !== "agency") {
      return NextResponse.json({ error: "Agency only" }, { status: 403 })
    }

    const body: { response_ids?: unknown; force?: unknown } = await req.json().catch(() => ({}))
    const rawIds: unknown[] = Array.isArray(body.response_ids) ? body.response_ids : []
    const stringIds: string[] = rawIds.filter((id): id is string => typeof id === "string" && id.length > 0)
    const responseIds: string[] = Array.from(new Set(stringIds))
    const force = body.force === true

    if (responseIds.length < 2) {
      return NextResponse.json({ error: "At least 2 response_ids are required" }, { status: 400 })
    }

    // Ownership check - every response_id must belong to this agency.
    const { data: owned, error: ownedErr } = await supabase
      .from("partner_rfp_responses")
      .select("id")
      .eq("agency_id", user.id)
      .in("id", responseIds)
    if (ownedErr) {
      console.error("[api] failure", { route, method: "POST", message: ownedErr.message })
      return NextResponse.json({ error: "Failed to load bids" }, { status: 500 })
    }
    if ((owned || []).length !== responseIds.length) {
      return NextResponse.json({ error: "One or more bids were not found" }, { status: 404 })
    }

    const hash = hashResponseIds(responseIds)

    if (!force) {
      const { data: cached } = await supabase
        .from("bid_comparisons")
        .select("narrative, response_ids, generated_at")
        .eq("agency_id", user.id)
        .eq("response_ids_hash", hash)
        .maybeSingle()
      if (cached) {
        const age = Date.now() - new Date(cached.generated_at as string).getTime()
        if (age < CACHE_MAX_AGE_MS) {
          return NextResponse.json({
            narrative: cached.narrative,
            response_ids: cached.response_ids,
            generated_at: cached.generated_at,
            cached: true,
          })
        }
      }
    }

    const { data: decompositions, error: decompErr } = await supabase
      .from("bid_decompositions")
      .select("response_id, line_items")
      .eq("agency_id", user.id)
      .in("response_id", responseIds)
    if (decompErr) {
      console.error("[api] failure", { route, method: "POST", message: decompErr.message })
      return NextResponse.json({ error: "Failed to load cost breakdowns" }, { status: 500 })
    }
    const decompByResponseId = new Map(
      (decompositions || []).map((d) => [d.response_id as string, (d.line_items as DecompositionLineItem[]) || []])
    )
    const missing = responseIds.filter((id) => !decompByResponseId.has(id))
    if (missing.length > 0) {
      return NextResponse.json(
        { error: "Cost breakdowns must be generated for all selected bids first", missing_response_ids: missing },
        { status: 400 }
      )
    }

    const usageCheck = await checkUsageLimit(agencyEntitlementId(user.id), supabase, "ai_analyses")
    if (!usageCheck.allowed) return usageLimitResponse(usageCheck)

    // Scope description is shared across all selected bids (compare is only offered for
    // bids on the same RFP scope item), so the first bid's context is representative.
    const firstCtx = await loadBidAnalysisContext(supabase, responseIds[0], user.id)
    const scopeLabel = firstCtx?.scopeItemName || "this scope"

    const vendorSections = await Promise.all(
      responseIds.map(async (id) => {
        const ctx = await loadBidAnalysisContext(supabase, id, user.id)
        const vendorName = ctx?.partnerDisplayName || "Vendor"
        return formatDecompositionForPrompt(vendorName, decompByResponseId.get(id) || [])
      })
    )

    const systemPrompt = `Compare these vendor bids for ${scopeLabel}. For each cost category where vendors differ significantly, explain the difference and what it implies. Highlight where any vendor may be underestimating or padding scope. Recommend which vendor offers the best value per category and overall. Be specific and cite numbers.`

    const result = await callAnthropicAnalysis({
      systemPrompt,
      userContent: vendorSections.join("\n\n"),
      maxTokens: 2048,
      timeoutMs: 55_000,
    })

    if (!result.success) {
      console.error("[api] failure", { route, method: "POST", message: result.error })
      return NextResponse.json({ error: "Analysis unavailable" }, { status: 502 })
    }

    const generatedAt = new Date().toISOString()
    const { data: saved, error: upsertErr } = await supabase
      .from("bid_comparisons")
      .upsert(
        {
          agency_id: user.id,
          response_ids_hash: hash,
          response_ids: responseIds,
          scope_description: scopeLabel,
          narrative: result.text.trim(),
          generated_at: generatedAt,
        },
        { onConflict: "agency_id,response_ids_hash" }
      )
      .select("narrative, response_ids, generated_at")
      .single()

    if (upsertErr) {
      console.error("[api] failure", { route, method: "POST", message: upsertErr.message })
      return NextResponse.json({ error: "Failed to save comparison" }, { status: 500 })
    }

    await incrementAiAnalysis(agencyEntitlementId(user.id), supabase)
    return NextResponse.json({
      narrative: saved.narrative,
      response_ids: saved.response_ids,
      generated_at: saved.generated_at,
      cached: false,
    })
  } catch (error) {
    console.error("[api] failure", {
      route: "/api/agency/bids/compare",
      method: "POST",
      code: 500,
      message: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: "Failed to compare bids" }, { status: 500 })
  }
}
