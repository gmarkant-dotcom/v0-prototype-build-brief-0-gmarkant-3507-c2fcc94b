import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

// Soft-delete only: is_active = false, never a hard DELETE - historical evaluations
// reference criterion_id via bid_evaluation_scores and must remain valid.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const route = "/api/agency/scoring/criteria/[id]"
  try {
    const { id } = await params
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, active_role")
      .eq("id", user.id)
      .maybeSingle()
    if (profile?.role !== "agency" && profile?.active_role !== "agency") {
      return NextResponse.json({ error: "Agency only" }, { status: 403 })
    }

    const { data: updated, error: updateErr } = await supabase
      .from("bid_scoring_criteria")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("agency_id", user.id)
      .select("id")
      .maybeSingle()
    if (updateErr) {
      console.error("[api] failure", { route, method: "DELETE", message: updateErr.message })
      return NextResponse.json({ error: "Failed to remove criterion" }, { status: 500 })
    }
    if (!updated) return NextResponse.json({ error: "Criterion not found" }, { status: 404 })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[api] failure", {
      route: "/api/agency/scoring/criteria/[id]",
      method: "DELETE",
      code: 500,
      message: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: "Failed to remove criterion" }, { status: 500 })
  }
}
