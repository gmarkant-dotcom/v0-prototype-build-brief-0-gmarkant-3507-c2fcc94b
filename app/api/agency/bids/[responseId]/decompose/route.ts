import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { callAnthropicAnalysis, tryParseJsonObject } from "@/lib/ai-bid-analysis"
import { loadBidAnalysisContext, formatBidContextForPrompt } from "@/lib/bid-analysis-context"
import { checkUsageLimit, incrementAiAnalysis, usageLimitResponse } from "@/lib/usage-tracking"
import { agencyEntitlementId, resolveCallerOrgIds, resolveCallerWriteOrgId } from "@/lib/entitlements"
import { recordMilestone } from "@/lib/milestone-events"
export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 45

const DECOMPOSE_SYSTEM_PROMPT =
  "You are analyzing a vendor bid for a creative/production agency. Extract a line-item cost breakdown from this proposal. Use categories appropriate to the scope type. For each line item, provide: category name, dollar amount (estimate if not explicit), percentage of total budget, and the vendor's description. Then provide a brief narrative summary of the overall cost structure, noting any categories that seem over or under-allocated relative to the scope. Return as JSON: { line_items: [{ category, amount, percentage_of_total, description }], narrative_summary: string }. Return ONLY the JSON object, no markdown, no preamble."

type LineItem = {
  category: string
  amount: number
  percentage_of_total: number
  description: string
}

type DecomposeAiResponse = {
  line_items?: unknown
  narrative_summary?: unknown
}

function normalizeLineItems(raw: unknown): LineItem[] {
  if (!Array.isArray(raw)) return []
  const out: LineItem[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue
    const o = entry as Record<string, unknown>
    const category = String(o.category ?? "").trim()
    if (!category) continue
    const amount = typeof o.amount === "number" ? o.amount : parseFloat(String(o.amount ?? ""))
    const percentage_of_total =
      typeof o.percentage_of_total === "number" ? o.percentage_of_total : parseFloat(String(o.percentage_of_total ?? ""))
    const description = String(o.description ?? "").trim()
    out.push({
      category,
      amount: Number.isFinite(amount) ? amount : 0,
      percentage_of_total: Number.isFinite(percentage_of_total) ? percentage_of_total : 0,
      description,
    })
  }
  return out
}

// Read-only existence check used by compare mode to find bids that still need a
// decomposition, without ever triggering an AI call as a side effect of checking.
export async function GET(_req: Request, { params }: { params: Promise<{ responseId: string }> }) {
  const route = "/api/agency/bids/[responseId]/decompose"
  try {
    const { responseId } = await params
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

    const { data: existing } = await supabase
      .from("bid_decompositions")
      .select("line_items, narrative_summary, generated_at")
      .eq("response_id", responseId)
      .in("org_id", callerOrgIds)
      .maybeSingle()

    if (!existing) return NextResponse.json({ exists: false }, { status: 404 })
    return NextResponse.json({
      exists: true,
      line_items: existing.line_items,
      narrative_summary: existing.narrative_summary,
      generated_at: existing.generated_at,
    })
  } catch (error) {
    console.error("[api] failure", {
      route,
      method: "GET",
      code: 500,
      message: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: "Failed to check cost breakdown" }, { status: 500 })
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ responseId: string }> }) {
  const route = "/api/agency/bids/[responseId]/decompose"
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

    const body = await req.json().catch(() => ({}))
    const force = body?.force === true

    /**
     * THE PRIOR ROW, READ BEFORE THE WRITE, AND IT NOW DOES TWO JOBS.
     *
     * Job one, unchanged: on a non-force run an existing decomposition is returned from
     * cache without an AI call.
     *
     * Job two, RULING 5: it is the discriminator between `bid.analyze` and
     * `bid.analyze_retry`. See the emit block below for why it is this row and NOT
     * `force`.
     *
     * THE QUERY MOVED OUT OF `if (!force)`, and that is the whole cost of job two: a force
     * run now makes this one extra `maybeSingle()` where it previously made none. A
     * non-force run makes exactly the same number of queries it always did. The predicate
     * is byte-for-byte what it was, `.in("org_id", callerOrgIds)` included, so this widens
     * no read: a caller who could not see this row a moment ago still cannot.
     */
    const { data: existing } = await supabase
      .from("bid_decompositions")
      .select("line_items, narrative_summary, generated_at")
      .eq("response_id", responseId)
      .in("org_id", callerOrgIds)
      .maybeSingle()

    if (!force && existing) {
      return NextResponse.json({
        line_items: existing.line_items,
        narrative_summary: existing.narrative_summary,
        generated_at: existing.generated_at,
        cached: true,
      })
    }

    const usageCheck = await checkUsageLimit(await agencyEntitlementId(user.id, supabase), supabase, "ai_analyses")
    if (!usageCheck.allowed) return usageLimitResponse(usageCheck)

    const ctx = await loadBidAnalysisContext(supabase, responseId, callerOrgIds)
    if (!ctx) return NextResponse.json({ error: "Bid not found" }, { status: 404 })

    const bidContext = formatBidContextForPrompt(ctx)
    const result = await callAnthropicAnalysis({
      systemPrompt: DECOMPOSE_SYSTEM_PROMPT,
      userContent: bidContext,
      maxTokens: 2048,
      timeoutMs: 40_000,
    })

    if (!result.success) {
      console.error("[api] failure", { route, method: "POST", responseId, message: result.error })
      return NextResponse.json({ error: "Analysis unavailable" }, { status: 502 })
    }

    const parsed = tryParseJsonObject<DecomposeAiResponse>(result.text)
    const lineItems = parsed ? normalizeLineItems(parsed.line_items) : []
    // Malformed AI output: store the raw text as the narrative rather than losing it,
    // with an empty line-item table instead of failing the request outright.
    const narrativeSummary = parsed
      ? typeof parsed.narrative_summary === "string"
        ? parsed.narrative_summary
        : ""
      : result.text.trim()

    const { data: saved, error: upsertErr } = await supabase
      .from("bid_decompositions")
      .upsert(
        {
          response_id: responseId,
          org_id: writeOrgId,
          line_items: lineItems,
          narrative_summary: narrativeSummary,
          generated_at: new Date().toISOString(),
        },
        { onConflict: "response_id" }
      )
      .select("line_items, narrative_summary, generated_at")
      .single()

    if (upsertErr) {
      console.error("[api] failure", { route, method: "POST", responseId, message: upsertErr.message })
      return NextResponse.json({ error: "Failed to save cost breakdown" }, { status: 500 })
    }

    /**
     * Milestone: bid.analyze / bid.analyze_retry. RULING 5, 2026-09-14.
     *
     * GREG'S RULING: EMIT, AGENCY FEED ONLY, OFF THE WHITELIST, AND FROM THIS ROUTE ONLY.
     * Neither type is added to `vendor_visible_event_types()`, so gate 2 fails on the event
     * type. This row ALSO carries `partnership_id = NULL`, so it fails gate 2's FIRST clause
     * as well - see below. Two independent failures, and the ruling depends on neither one
     * alone.
     *
     * >>> THE COMPARE ROUTE EMITS NOTHING, AND THAT IS PART OF THE RULING. <<<
     *
     * `app/api/agency/bids/compare/route.ts` is N bids across N vendors and caches a
     * narrative in `bid_comparisons` keyed on a hash of the response ids (migration 064). It
     * has no `recordMilestone` import today and must not acquire one. A clean payload would
     * not save it: `groupMilestoneRows()` in lib/activity-feed.ts groups on an exact shared
     * `created_at`, one insert is one transaction is one timestamp, and `vendorCount` is
     * rendered as "to N vendors" - so N rows from one comparison would put THE SIZE OF THE
     * COMPETITIVE FIELD into the feed line through the GROUPING, with nothing in the payload
     * at all. That is the `recipient_count` defect arriving by a different road
     * (docs/broadcast-payload-leak-fix.md). One bid, one vendor, one row: this route only.
     *
     * >>> THE TYPE IS SERVER-DETERMINED. `force` NAMES NEITHER EVENT. <<<
     *
     * A DELIBERATE DEPARTURE FROM THE LETTER OF THE RULING, WHICH CALLS `force: true` "the
     * retry variant". `force` is a flag from the browser, and ruling 4 (commit 2c2db0f)
     * refused exactly that for `rfp.generate`: a client may SUPPLY a value the server can
     * check and may never DECIDE one the server cannot. The refusal is worth more than the
     * spelling.
     *
     * And here the server has the better fact anyway. A retry is a run against a response
     * that ALREADY HAD a decomposition, which is `existing`, read above under the caller's
     * own `org_id` scope. The two disagree in a real case: `force: true` on a response with
     * no prior row is a FIRST analysis that the client flag would file as a retry. The row
     * is what happened; the flag is what was asked for.
     *
     * >>> THE PAYLOAD IS scope_item_name AND NOTHING ELSE, ENFORCED BY THE COMPILER. <<<
     *
     * Not a convention and not a comment asking the next author nicely. `analysisPayload` is
     * annotated `{ scope_item_name: string | null }`, so TypeScript's excess property check
     * on the object literal REFUSES any second key at compile time. `npx tsc --noEmit` is
     * the gate.
     *
     * WHY THAT MATTERS MORE HERE THAN ANYWHERE ELSE IN THIS RUN. Every field this feature
     * can reach for - a rank, a score relative to others, a set size, a spread - is drawn
     * from a COMPARISON and describes the competitive field rather than the reader. The
     * ruling names them one by one. `ctx` is in scope on the line below and carries
     * `proposalText`, `budgetProposal`, `budgetLines`, `paymentTerms` and
     * `partnerDisplayName`; `lineItems` and `narrativeSummary` are the agency's AI reading of
     * one vendor's money. None of them can reach the payload, because the type will not hold
     * them. The payload is unenforced by the database today - nobody outside the org can read
     * this row - and is written to the rule anyway, because a payload composed under an
     * off-whitelist ruling is precisely what a later decision to whitelist would expose
     * wholesale.
     *
     * >>> partnership_id IS NULL, AND lib/bid-analysis-context.ts IS LEFT ALONE. <<<
     *
     * docs/emitter-rulings-owed.md carries an amendment (2026-09-14) saying ruling 5 is
     * unbuildable because `loadBidAnalysisContext` omits `partnership_id`. VERIFIED, AND IT
     * DOES NOT BITE. The amendment is factually right about the projection - the inbox select
     * at lib/bid-analysis-context.ts:82 reads `scope_item_name, scope_item_description` and
     * `BidAnalysisContext` has no such field - and it is right that OPTION A needs the column,
     * because gate 2 opens with `partnership_id IS NOT NULL`. Greg ruled OPTION B. Gate 1 for
     * an agency-side write is `org_id IN current_user_org_ids()` and asks nothing about a
     * partnership, so this row is written with a null one and read by the agency. The
     * amendment's cost table is a prerequisite for a ruling that was not taken. Nothing in
     * lib/bid-analysis-context.ts is changed by this commit.
     *
     * `vendor_org_id` is null for the same reason and costs nothing: the feed line for both
     * types renders through `scopeOf()`, not `vendorOf()` (lib/activity-feed.ts).
     *
     * AFTER THE UPSERT AND FIRE-AND-FORGET. The breakdown is already saved.
     * `recordMilestone()` catches everything and returns void, and a lost breadcrumb must
     * never cost the agency an analysis that took 40 seconds to produce.
     */
    try {
      const isRetry = Boolean(existing)
      // THE ENFORCEMENT. Annotated, so a second key is a compile error, not a code review.
      const analysisPayload: { scope_item_name: string | null } = {
        scope_item_name: ctx.scopeItemName?.trim() || null,
      }
      await recordMilestone(supabase, {
        eventType: isRetry ? "bid.analyze_retry" : "bid.analyze",
        // 079 PARAMETER CLASS: the acting organization, never `user.id`. Guarded by the 403
        // above, so it is non-null here.
        orgId: writeOrgId,
        actorId: user.id,
        // See the block above. Not reachable from this route's context, not needed by the
        // line, and not worth widening a shared loader to obtain.
        vendorOrgId: null,
        partnershipId: null,
        // The response, matching the three bid-side emitters in
        // app/api/agency/rfp-responses/[id]/route.ts. Neither type is on
        // UNION_REPLACING_EVENT_TYPES, so `milestoneDedupeKey()` returns null and this row
        // cannot collide with the derived bid line.
        subjectType: "bid",
        subjectId: responseId,
        payload: analysisPayload,
      })
    } catch (milestoneErr) {
      // recordMilestone() never throws. A missing breadcrumb must never cost the agency the
      // cost breakdown it describes.
      console.error("[api] decompose: bid.analyze milestone failed (non-fatal)", {
        route,
        responseId,
        message: milestoneErr instanceof Error ? milestoneErr.message : String(milestoneErr),
      })
    }

    await incrementAiAnalysis(await agencyEntitlementId(user.id, supabase), supabase)
    return NextResponse.json({
      line_items: saved.line_items,
      narrative_summary: saved.narrative_summary,
      generated_at: saved.generated_at,
      cached: false,
    })
  } catch (error) {
    console.error("[api] failure", {
      route: "/api/agency/bids/[responseId]/decompose",
      method: "POST",
      code: 500,
      message: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: "Failed to analyze cost structure" }, { status: 500 })
  }
}
