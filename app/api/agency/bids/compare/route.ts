import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { callAnthropicAnalysis } from "@/lib/ai-bid-analysis"
import { loadBidAnalysisContext, hashResponseIds } from "@/lib/bid-analysis-context"
import { checkUsageLimit, incrementAiAnalysis, usageLimitResponse } from "@/lib/usage-tracking"
import { agencyEntitlementId, resolveCallerOrgIds, resolveCallerWriteOrgId } from "@/lib/entitlements"
import { recordMilestone } from "@/lib/milestone-events"
export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

/**
 * THIS ROUTE EMITS ONE MILESTONE PER RUN, AND THE SHAPE OF THAT ROW IS THE WHOLE RULING.
 *
 * It used to say the opposite, and the history is kept because the reasoning still binds:
 * until ruling 7 this route emitted nothing, by ruling 5 (2026-09-14). A comparison is N bids
 * belonging to N vendors. N rows from one insert share one `created_at`, `groupMilestoneRows()`
 * in lib/activity-feed.ts groups on exactly that, and `vendorCount` renders as "to N vendors",
 * so THE SIZE OF THE COMPETITIVE FIELD WOULD REACH THE FEED LINE THROUGH THE GROUPING with an
 * empty payload and nothing to scrub. That is `rfp.broadcast.payload.recipient_count`
 * (docs/broadcast-payload-leak-fix.md) arriving by a road no payload rule watches.
 *
 * So the emit below is ONE row, with no vendor, no partnership and no response id: nothing for
 * the grouping to count, and nothing to resolve a vendor name from. The line reads
 * "compared bids on {scope}" and nothing more (docs/emitter-rulings-owed.md section 7).
 *
 * >>> THE PAYLOAD IS THE SCOPE NAME AND NOTHING ELSE, ENFORCED BY THE COMPILER. <<<
 * `comparisonPayload` is annotated `{ scope_item_name: string | null }`, so a second key is an
 * excess-property error at `npx tsc --noEmit`, not a review comment. WHY THAT MATTERS HERE:
 * `bid_comparisons` caches a narrative across a SET of responses (migration 064), so ANY field
 * drawn from the comparison - a rank, a score relative to others, a set size, a spread, a
 * winner - is a fact about the competitive field and is the recipient_count defect. The scope
 * name is the one thing every bid in the set shares by construction.
 *
 * AGENCY FEED ONLY. `bid.compare` is deliberately NOT on `vendor_visible_event_types()`, so
 * gate 2 fails on the type and no counterparty can read it. Putting it there is a migration and
 * a separate decision.
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

    // Milestone: bid.compare. ONE row per run that actually produced a comparison, after the
    // upsert and fire-and-forget: the narrative is already saved, recordMilestone() catches
    // everything and returns void, and a lost breadcrumb must never cost the agency a result
    // that took most of a minute to produce. A cache hit returns above and records nothing,
    // matching bid.analyze, which also records runs and not reads.
    //
    // vendorOrgId, partnershipId and subjectId are null ON PURPOSE. A set of bids has no single
    // vendor, partnership or response to be the subject, and any one of them would be an
    // arbitrary member of the set.
    try {
      // THE ENFORCEMENT. Annotated, so a second key is a compile error.
      const comparisonPayload: { scope_item_name: string | null } = {
        scope_item_name: firstCtx?.scopeItemName?.trim() || null,
      }
      await recordMilestone(supabase, {
        eventType: "bid.compare",
        // 079 PARAMETER CLASS: the acting organization, never user.id. Non-null here: the 403
        // above refuses a caller without one.
        orgId: writeOrgId,
        actorId: user.id,
        vendorOrgId: null,
        partnershipId: null,
        subjectType: "bid",
        subjectId: null,
        payload: comparisonPayload,
      })
    } catch (milestoneErr) {
      console.error("[api] compare: bid.compare milestone failed (non-fatal)", {
        route,
        message: milestoneErr instanceof Error ? milestoneErr.message : String(milestoneErr),
      })
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
