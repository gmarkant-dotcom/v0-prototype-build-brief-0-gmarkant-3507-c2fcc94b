import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { callAnthropicAnalysis } from "@/lib/ai-bid-analysis"
import { loadBidAnalysisContext, hashResponseIds } from "@/lib/bid-analysis-context"
import { checkUsageLimit, incrementAiAnalysis, usageLimitResponse } from "@/lib/usage-tracking"
import { agencyEntitlementId, resolveCallerOrgIds, resolveCallerWriteOrgId } from "@/lib/entitlements"
export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

/**
 * THIS ROUTE EMITS NO MILESTONE, BY RULING, AND THE ABSENCE IS THE DECISION.
 *
 * RULING 5, 2026-09-14. `bid.analyze` and `bid.analyze_retry` are emitted from
 * app/api/agency/bids/[responseId]/decompose/route.ts and from nowhere else. There is no
 * `recordMilestone` import in this file and there must not be one. Written here because an
 * absence leaves no trace at the site it was decided for, and the next reader comparing the
 * two analysis routes will notice that one emits and this one does not.
 *
 * WHY. A comparison is N bids belonging to N vendors. One row could carry only one subject,
 * so the shape would be N rows - the `recordMilestones()` broadcast shape - written by one
 * insert. `groupMilestoneRows()` in lib/activity-feed.ts groups on an EXACT shared
 * `created_at`, and one insert is one transaction is one `now()`, so all N land in one group
 * and `vendorCount` renders as "to N vendors". THE SIZE OF THE COMPETITIVE FIELD WOULD REACH
 * THE FEED LINE THROUGH THE GROUPING, with an empty payload and nothing to scrub - which is
 * `rfp.broadcast.payload.recipient_count` (docs/broadcast-payload-leak-fix.md) arriving by a
 * road no payload rule watches.
 *
 * Off the whitelist that would be agency-internal today. It would not stay that way for
 * free: the comparison narrative, the ranking and the set size are the fields most likely to
 * be reached for the moment anybody proposes whitelisting these types.
 *
 * `bid.compare` is recorded as an OWED RULING in docs/emitter-rulings-owed.md. It is not
 * answered here and must not be answered by adding an emitter.
 */
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
      .in("lead_org_id", callerOrgIds)
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
        .in("org_id", callerOrgIds)
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
      .in("org_id", callerOrgIds)
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

    const usageCheck = await checkUsageLimit(await agencyEntitlementId(user.id, supabase), supabase, "ai_analyses")
    if (!usageCheck.allowed) return usageLimitResponse(usageCheck)

    // Scope description is shared across all selected bids (compare is only offered for
    // bids on the same RFP scope item), so the first bid's context is representative.
    const firstCtx = await loadBidAnalysisContext(supabase, responseIds[0], callerOrgIds)
    const scopeLabel = firstCtx?.scopeItemName || "this scope"

    const vendorSections = await Promise.all(
      responseIds.map(async (id) => {
        const ctx = await loadBidAnalysisContext(supabase, id, callerOrgIds)
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
          org_id: writeOrgId,
          response_ids_hash: hash,
          response_ids: responseIds,
          scope_description: scopeLabel,
          narrative: result.text.trim(),
          generated_at: generatedAt,
        },
        { onConflict: "org_id,response_ids_hash" }
      )
      .select("narrative, response_ids, generated_at")
      .single()

    if (upsertErr) {
      console.error("[api] failure", { route, method: "POST", message: upsertErr.message })
      return NextResponse.json({ error: "Failed to save comparison" }, { status: 500 })
    }

    await incrementAiAnalysis(await agencyEntitlementId(user.id, supabase), supabase)
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
