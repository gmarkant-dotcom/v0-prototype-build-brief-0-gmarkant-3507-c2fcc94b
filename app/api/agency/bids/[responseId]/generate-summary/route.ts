import { NextResponse } from "next/server"
import { generateAndSaveBidSummary, isBidSummaryComplete, readBidSummary } from "@/lib/bid-summary-generation"
import { requireAgencyRole } from "@/lib/api-auth"
import { checkUsageLimit, incrementAiAnalysis, usageLimitResponse } from "@/lib/usage-tracking"
import { agencyEntitlementId, resolveCallerOrgIds } from "@/lib/entitlements"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
// S1: raised from 30. The detailed analysis alone is now given 50s (see
// lib/bid-summary-generation.ts) because it was timing out against the shared 25s default and
// silently leaving ai_summary_detailed null while the short summary saved beside it.
export const maxDuration = 60

export async function POST(req: Request, { params }: { params: Promise<{ responseId: string }> }) {
  const route = "/api/agency/bids/[responseId]/generate-summary"
  try {
    const { responseId } = await params
    const auth = await requireAgencyRole()
    if (!auth.authorized) return auth.response
    const { user, supabase } = auth

    // 079: an organization column is not a user id. Reads scope to the caller's memberships.
    // Deliberately NOT agencyEntitlementId() below: that resolver falls back to the user id
    // when membership does not resolve, which is right for a quota row and wrong for a filter.
    const callerOrgIds = await resolveCallerOrgIds(user.id, supabase)

    // RULING S-A: this route is the ONLY place a bid summary is generated, and the bids page calls
    // it in the background for every pending bid (warm-up), so it is IDEMPOTENT: unless the body
    // says { force: true } (the explicit "Regenerate"), a bid that already has both halves of its
    // summary is answered from what is stored, with no AI call and no usage counted. The read is
    // the caller's own (109's private table, lead_org_id in the caller's organizations).
    const body = (await req.json().catch(() => null)) as { force?: unknown } | null
    const force = body?.force === true
    if (!force) {
      try {
        const stored = await readBidSummary(supabase, responseId, callerOrgIds)
        if (isBidSummaryComplete(stored)) {
          return NextResponse.json({
            ok: true,
            ai_summary_short: stored.ai_summary_short,
            ai_summary_detailed: stored.ai_summary_detailed,
            ai_summary_generated_at: stored.ai_summary_generated_at,
            short_failed: false,
            detailed_failed: false,
            skipped: true,
          })
        }
      } catch (readErr) {
        // Not fatal: generating is the fallback, exactly what this route did before S-A.
        console.error("[api] generate-summary: stored summary read failed, generating", {
          route,
          responseId,
          message: readErr instanceof Error ? readErr.message : String(readErr),
        })
      }
    }

    const usageCheck = await checkUsageLimit(await agencyEntitlementId(user.id, supabase), supabase, "ai_analyses")
    if (!usageCheck.allowed) return usageLimitResponse(usageCheck)

    // Step B: the agency's session, after G1 (requireAgencyRole), reads its own RFP record.
    const result = await generateAndSaveBidSummary(supabase, responseId, callerOrgIds, "session")
    if (!result.ok) {
      const status = result.reason === "not_found" ? 404 : 502
      const error = result.reason === "not_found" ? "Bid not found" : "Analysis unavailable"
      console.error("[api] failure", { route, method: "POST", responseId, reason: result.reason })
      return NextResponse.json({ error }, { status })
    }

    await incrementAiAnalysis(await agencyEntitlementId(user.id, supabase), supabase)
    return NextResponse.json({ ...result, skipped: false })
  } catch (error) {
    console.error("[api] failure", {
      route: "/api/agency/bids/[responseId]/generate-summary",
      method: "POST",
      code: 500,
      message: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: "Failed to generate summary" }, { status: 500 })
  }
}
