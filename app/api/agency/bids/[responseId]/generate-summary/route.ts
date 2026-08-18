import { NextResponse } from "next/server"
import { generateAndSaveBidSummary } from "@/lib/bid-summary-generation"
import { requireAgencyRole } from "@/lib/api-auth"
import { checkUsageLimit, incrementAiAnalysis, usageLimitResponse } from "@/lib/usage-tracking"
import { agencyEntitlementId } from "@/lib/entitlements"

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

    const usageCheck = await checkUsageLimit(await agencyEntitlementId(user.id, supabase), supabase, "ai_analyses")
    if (!usageCheck.allowed) return usageLimitResponse(usageCheck)

    const result = await generateAndSaveBidSummary(supabase, responseId, user.id)
    if (!result.ok) {
      const status = result.reason === "not_found" ? 404 : 502
      const error = result.reason === "not_found" ? "Bid not found" : "Analysis unavailable"
      console.error("[api] failure", { route, method: "POST", responseId, reason: result.reason })
      return NextResponse.json({ error }, { status })
    }

    await incrementAiAnalysis(await agencyEntitlementId(user.id, supabase), supabase)
    return NextResponse.json(result)
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
