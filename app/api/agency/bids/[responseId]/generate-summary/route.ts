import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { generateAndSaveBidSummary } from "@/lib/bid-summary-generation"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 30

export async function POST(req: Request, { params }: { params: Promise<{ responseId: string }> }) {
  const route = "/api/agency/bids/[responseId]/generate-summary"
  try {
    const { responseId } = await params
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

    const result = await generateAndSaveBidSummary(supabase, responseId, user.id)
    if (!result.ok) {
      const status = result.reason === "not_found" ? 404 : 502
      const error = result.reason === "not_found" ? "Bid not found" : "Analysis unavailable"
      console.error("[api] failure", { route, method: "POST", responseId, reason: result.reason })
      return NextResponse.json({ error }, { status })
    }

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
