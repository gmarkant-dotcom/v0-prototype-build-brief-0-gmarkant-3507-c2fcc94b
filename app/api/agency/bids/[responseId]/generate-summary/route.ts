import { NextResponse } from "next/server"
import { generateAndSaveBidSummary } from "@/lib/bid-summary-generation"
import { requireAgencyRole } from "@/lib/api-auth"
import { incrementAiAnalysis } from "@/lib/usage-tracking"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 30

export async function POST(req: Request, { params }: { params: Promise<{ responseId: string }> }) {
  const route = "/api/agency/bids/[responseId]/generate-summary"
  try {
    const { responseId } = await params
    const auth = await requireAgencyRole()
    if (!auth.authorized) return auth.response
    const { user, supabase } = auth

    const result = await generateAndSaveBidSummary(supabase, responseId, user.id)
    if (!result.ok) {
      const status = result.reason === "not_found" ? 404 : 502
      const error = result.reason === "not_found" ? "Bid not found" : "Analysis unavailable"
      console.error("[api] failure", { route, method: "POST", responseId, reason: result.reason })
      return NextResponse.json({ error }, { status })
    }

    await incrementAiAnalysis(user.id, supabase)
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
